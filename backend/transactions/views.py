import csv
import os
import json
import hashlib
import redis
import logging
from typing import List, Tuple
from dotenv import load_dotenv
from datetime import datetime, timedelta
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework import status as http_status
from rest_framework.response import Response
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser
from rest_framework.pagination import PageNumberPagination
from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.db.models import Count, Avg, Max, Min, Sum
from django.shortcuts import get_object_or_404
from .models import Transaction, ThresholdRule, CompositeRule, PatternRule, MLRule
from .serializers import TransactionSerializer, sanitize_record, ThresholdRuleSerializer, CompositeRuleSerializer, PatternRuleSerializer, MLRuleSerializer
from transactions.rules import threshold as thr_eval, composite as comp_eval, pattern as patt_eval
from .ml_engine import MLEngine


load_dotenv()

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
STREAM     = os.getenv("TX_STREAM", "transactions_stream")
USE_DEDUP = os.getenv("TX_USE_DEDUP") == "1"
DEDUP_KEYS = [k.strip() for k in os.getenv("TX_DEDUP_KEYS", "correlation_id,transaction_id").split(",") if k.strip()]
DEDUP_SET = os.getenv("TX_DEDUP_SET", "tx_seen_tokens")   
DEDUP_TTL_SEC = int(os.getenv("TX_DEDUP_TTL", "86400"))
VAL_CHUNK    = int(os.getenv("TX_VALIDATE_CHUNK", "10000"))     
DEDUP_CHUNK  = int(os.getenv("TX_DEDUP_CHECK_CHUNK", "50000"))  
XADD_CHUNK   = int(os.getenv("TX_XADD_CHUNK", "5000"))          
MAX_BATCH    = int(os.getenv("TX_MAX_BATCH", "90000"))          
LOOKUP_CHUNK = int(os.getenv("TX_LOOKUP_CHUNK", "5000"))        
STREAM_MAXLEN = int(os.getenv("TX_STREAM_MAXLEN", "2000000"))  
TRIM_APPROX   = os.getenv("TX_TRIM_APPROX") == "1"        
IDEMP_TTL_SEC = int(os.getenv("TX_IDEMP_TTL", "86400"))        
IDEMP_NS      = os.getenv("TX_IDEMP_NS")             
FPG_NS       = os.getenv("TX_FPG_NS")
FPG_TTL_SEC  = int(os.getenv("TX_FPG_TTL", "604800"))          
FPG_SEEN_KEY = f"{FPG_NS}:seen"


@api_view(["GET"])
def ml_probability(request, tx_id):
    key = f"ml:{tx_id}"
    value = r.get(key)

    if value is None:
        return Response({"status": "pending", "probability": None}, status=200)
    
    try:
        prob = float(value)
    except ValueError:
        prob = None

    return Response({
        "status": "ok",
        "probability": prob
    }, status=200)


@extend_schema(tags=["Transactions"], summary="Получить список транзакций (с пагинацией)")
@api_view(["GET"])
def get_all_transactions(request):
    queryset = Transaction.objects.all().order_by('-id')
    status_ = request.GET.get('status')
    if status_:
        queryset = queryset.filter(status=status_)

    type_ = request.GET.get('type')
    if type_:
        queryset = queryset.filter(transaction_type=type_)

    search = request.GET.get('search')
    if search:
        queryset = queryset.filter(correlation_id__icontains=search)

    sort = request.GET.get('sort')
    if sort == 'date_asc':
        queryset = queryset.order_by('timestamp')
    elif sort == 'date_desc':
        queryset = queryset.order_by('-timestamp')
    elif sort == 'amt_asc':
        queryset = queryset.order_by('amount')
    elif sort == 'amt_desc':
        queryset = queryset.order_by('-amount')

    paginator = PageNumberPagination()
    result_page = paginator.paginate_queryset(queryset, request)
    serializer = TransactionSerializer(result_page, many=True)
    return paginator.get_paginated_response(serializer.data)


@extend_schema(tags=["Transactions"], summary="Получение транзакции по ID")
@api_view(["GET"])
def get_transaction_by_id(request, correlation_id): 
    try:
        tx = Transaction.objects.get(correlation_id=correlation_id)
    except Transaction.DoesNotExist:
        return Response(
            {"error": f"Транзакция с ID '{correlation_id}' не найдена."},
            status=status.HTTP_404_NOT_FOUND,
        )
    serializer = TransactionSerializer(tx)
    return Response(serializer.data, status=status.HTTP_200_OK)


def _get_model_and_serializer(rule_type: str):
    mapping = {
        "threshold": (ThresholdRule, ThresholdRuleSerializer),
        "composite": (CompositeRule, CompositeRuleSerializer),
        "pattern": (PatternRule, PatternRuleSerializer),
        "ml": (MLRule, MLRuleSerializer),
    }
    return mapping.get(rule_type, (None, None))


@extend_schema(tags=["Transactions"], summary="Обновление транзакции")
@api_view(['PUT'])
def update_transaction_status(request, correlation_id):
    try:
        transaction = Transaction.objects.get(correlation_id=correlation_id)
        data = request.data
        if 'is_fraud' in data:
            transaction.is_fraud = bool(data['is_fraud'])
        if 'is_reviewed' in data:
            transaction.is_reviewed = bool(data['is_reviewed'])
        
        transaction.save()
        
        return Response({
            'success': True,
            'message': 'Статус обновлен',
            'transaction': {
                'correlation_id': transaction.correlation_id,
                'is_fraud': transaction.is_fraud,
                'is_reviewed': transaction.is_reviewed,
            }
        }) 
    except Transaction.DoesNotExist:
        return Response({'error': 'Транзакция не найдена'}, status=404)
    except Exception as e:
        print(f"Ошибка: {str(e)}")
        return Response({'error': str(e)}, status=400)


@extend_schema(tags=["Transactions"], summary="Экспорт транзакций")
@api_view(["GET"])
def export_transactions(request):
    queryset = Transaction.objects.all()
    start_date = request.GET.get('start_date')
    end_date = request.GET.get('end_date')
    if start_date:
        queryset = queryset.filter(timestamp__gte=start_date)
    if end_date:
        end_date_obj = datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)
        queryset = queryset.filter(timestamp__lt=end_date_obj)
    type_ = request.GET.get('type')
    if type_:
        queryset = queryset.filter(transaction_type=type_)
    
    status_ = request.GET.get('status')
    if status_:
        queryset = queryset.filter(status=status_)
    response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
    response['Content-Disposition'] = 'attachment; filename="transactions_export.csv"'
    writer = csv.writer(response, delimiter=';')
    writer.writerow([
        'ID транзакции',
        'Correlation ID',
        'Дата и время',
        'Счет отправителя',
        'Счет получателя',
        'Сумма',
        'Тип транзакции',
        'Категория мерчанта',
        'Локация',
        'Устройство',
        'Время с последней транзакции (сек)',
        'Показатель отклонения расходов',
        'Скорость транзакций (velocity)',
        'Показатель гео-аномалий',
        'Канал оплаты',
        'IP адрес',
        'Хэш устройства',
        'Статус',
        'Статус мошенничества',
        'Просмотрено',
        'Статус блокировки'
    ])

    for tx in queryset:
        timestamp_str = tx.timestamp.strftime('%Y-%m-%d %H:%M:%S') if tx.timestamp else ''
        status_display = 'Успешная' if tx.status == Transaction.STATUS_PROCESSED else 'Подозрительная' if tx.status == Transaction.STATUS_ALERTED else ''
        fraud_status = 'Мошенническая' if tx.is_fraud else 'Легитимная'
        reviewed_status = 'Да' if tx.is_reviewed else 'Нет'
        blocked_status = 'Заблокирована' if tx.is_fraud else 'Активна' 
        writer.writerow([
            tx.transaction_id or '',
            tx.correlation_id or '',
            timestamp_str,
            tx.sender_account or '',
            tx.receiver_account or '',
            str(tx.amount) if tx.amount else '0.00',
            tx.transaction_type or '',
            tx.merchant_category or '',
            tx.location or '',
            tx.device_used or '',
            str(tx.time_since_last_transaction) if tx.time_since_last_transaction is not None else '0.0',
            str(tx.spending_deviation_score) if tx.spending_deviation_score is not None else '',
            str(tx.velocity_score) if tx.velocity_score is not None else '',
            str(tx.geo_anomaly_score) if tx.geo_anomaly_score is not None else '',
            tx.payment_channel or '',
            tx.ip_address or '',
            tx.device_hash or '',
            status_display,
            fraud_status,
            reviewed_status,
            blocked_status
        ])
    return response


@extend_schema(tags=["Rules"], summary="Получить список правил или одно правило")
@api_view(["GET"])
def get_rules(request, id=None, rule=None):
    if id and rule:
        Model, Serializer = _get_model_and_serializer(rule)
        if not Model:
            return Response({"error": "Неизвестный тип правила"}, status=status.HTTP_400_BAD_REQUEST)
        obj = get_object_or_404(Model, id=id)
        return Response(Serializer(obj).data)
    if rule:
        Model, Serializer = _get_model_and_serializer(rule)
        if not Model:
            return Response({"error": "Неизвестный тип правила"}, status=status.HTTP_400_BAD_REQUEST)
        rules = Model.objects.all().order_by("-updated_at")
        return Response(Serializer(rules, many=True).data)
    rules = {
        "threshold_rules": ThresholdRuleSerializer(ThresholdRule.objects.all().order_by("-updated_at"), many=True).data,
        "composite_rules": CompositeRuleSerializer(CompositeRule.objects.all().order_by("-updated_at"), many=True).data,
        "pattern_rules": PatternRuleSerializer(PatternRule.objects.all().order_by("-updated_at"), many=True).data,
        "ml_rules": MLRuleSerializer(MLRule.objects.all().order_by("-updated_at"), many=True).data,
    }
    return Response(rules)
    

@extend_schema(tags=["Rules"], summary="Создать новое правило")
@api_view(["POST"])
def create_rule(request):
    rule_type = request.data.get("type")
    if not rule_type:
        return Response(
            {"error": "Поле 'type' обязательно (threshold/composite/ml)"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    Model, Serializer = _get_model_and_serializer(rule_type)
    if not Model:
        return Response({"error": f"Неизвестный тип правила '{rule_type}'"}, status=400)

    serializer = Serializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@extend_schema(tags=["Rules"], summary="Обновить правило")
@api_view(["PUT"])
def update_rule(request, rule, id):
    Model, Serializer = _get_model_and_serializer(rule)
    if not Model:
        return Response({"error": "Неизвестный тип правила"}, status=400)

    try:
        instance = Model.objects.get(id=id)
    except Model.DoesNotExist:
        return Response({"error": "Правило не найдено"}, status=404)

    serializer = Serializer(instance, data=request.data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=400)


@extend_schema(tags=["Rules"], summary="Удалить правило")
@api_view(["DELETE"])
def delete_rule(request, rule, id):
    Model, Serializer = _get_model_and_serializer(rule)
    if not Model:
        return Response({"error": "Неизвестный тип правила"}, status=400)

    try:
        instance = Model.objects.get(id=id)
    except Model.DoesNotExist:
        return Response({"error": "Правило не найдено"}, status=404)

    instance.delete()
    return Response({"message": "Правило удалено"}, status=200)


@extend_schema(tags=["Rules"], summary="Тестирование правила на тестовом JSON-файле")
@api_view(["GET"])
def test_rule(request):
    rule_type = request.query_params.get("type")
    rule_id = request.query_params.get("id")
    if not rule_type or not rule_id:
        return Response(
            {"error": "Нужно указать параметры type и id, например ?type=threshold&id=3"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    rule_map = {
        "threshold": ThresholdRule,
        "composite": CompositeRule,
        "pattern": PatternRule,
    }
    if rule_type not in rule_map:
        return Response({"error": f"Неизвестный тип правила '{rule_type}'"}, status=400)
    Model = rule_map[rule_type]
    try:
        rule = Model.objects.get(id=rule_id)
    except Model.DoesNotExist:
        return Response({"error": f"Правило {rule_type} id={rule_id} не найдено"}, status=404)

    test_file = os.path.join(settings.BASE_DIR, "transactions", "test.json")
    if not os.path.exists(test_file):
        return Response({"error": f"Файл с тестовыми данными не найден: {test_file}"}, status=404)

    try:
        with open(test_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return Response({"error": f"Ошибка чтения JSON: {e}"}, status=500)

    items = data.get("transactions") if isinstance(data, dict) else data
    if not items or not isinstance(items, list):
        return Response({"error": "Файл не содержит массива транзакций"}, status=400)

    results = []
    for tx in items:
        try:
            if rule_type == "threshold":
                triggered, reason = thr_eval(tx, rule.column_name, rule.value, rule.operator)
            elif rule_type == "composite":
                triggered, reason = comp_eval(tx, rule.rule)
            else:
                triggered, reason = patt_eval(tx, rule)
        except Exception as e:
            triggered, reason = False, f"Ошибка при проверке: {e}"

        results.append({
            "transaction_id": tx.get("transaction_id"),
            "triggered": triggered,
            "reason": reason,
        })

    total_triggered = sum(1 for r in results if r["triggered"])
    summary = {
        "rule_type": rule_type,
        "rule_id": rule_id,
        "tested": len(results),
        "triggered_count": total_triggered,
        "triggered_pct": round(total_triggered / len(results) * 100, 2) if results else 0,
    }

    return Response({"summary": summary, "results": results}, status=200)


r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
logger = logging.getLogger(__name__)

def _ensure_list(payload):
    if isinstance(payload, dict) and "transactions" in payload:
        return payload["transactions"]
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return [payload]
    return []


def _make_fingerprint(items: List[dict]) -> str:
    keys = []
    for it in items:
        tid = str(it.get("transaction_id", "")).strip()
        cid = str(it.get("correlation_id", "")).strip()
        keys.append(f"{tid}|{cid}")
    keys.sort()
    raw = ",".join(keys).encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


def _dedup_tokens(obj: dict) -> List[str]:
    tokens = []
    for key in DEDUP_KEYS:
        val = obj.get(key)
        if val is None:
            continue
        s = str(val).strip()
        if s:
            tokens.append(f"{key}:{s}")
    return tokens


def _dedup_partition(cleaned: List[dict]) -> Tuple[List[dict], int]:
    if not USE_DEDUP or not cleaned:
        return cleaned, 0

    items_tokens = [_dedup_tokens(o) for o in cleaned]
    flat_tokens = [t for ts in items_tokens for t in ts]
    existing = set()
    
    for i in range(0, len(flat_tokens), DEDUP_CHUNK):
        part = flat_tokens[i:i + DEDUP_CHUNK]
        if not part:
            continue
        try:
            flags = r.execute_command("SMISMEMBER", DEDUP_SET, *part)
        except redis.ResponseError:
            pipe = r.pipeline(transaction=False)
            for tok in part:
                pipe.sismember(DEDUP_SET, tok)
            flags = pipe.execute()
        existing.update(tok for tok, f in zip(part, flags) if bool(f))

    new_items, new_tokens, dropped = [], [], 0
    for obj, toks in zip(cleaned, items_tokens):
        if any(t in existing for t in toks):
            dropped += 1
            continue
        new_items.append(obj)
        new_tokens.extend(toks)
    
    for i in range(0, len(new_tokens), DEDUP_CHUNK):
        part = new_tokens[i:i + DEDUP_CHUNK]
        if part:
            r.sadd(DEDUP_SET, *part)
    if new_tokens:
        r.expire(DEDUP_SET, DEDUP_TTL_SEC)

    return new_items, dropped


def _xadd_partition(to_send: List[dict]) -> int:
    queued = 0
    for o in to_send:
        ts = o.get("timestamp")
        if hasattr(ts, "isoformat"):
            o["timestamp"] = ts.isoformat() if ts is not None else None

    for i in range(0, len(to_send), XADD_CHUNK):
        chunk = to_send[i:i + XADD_CHUNK]
        pipe = r.pipeline(transaction=False)
        for obj in chunk:
            clean = {k: (v.isoformat() if hasattr(v, "isoformat") else str(v)) for k, v in obj.items()}
            pipe.xadd(STREAM, clean, maxlen=STREAM_MAXLEN, approximate=TRIM_APPROX)
        pipe.execute()
        queued += len(chunk)
    return queued


def _reprocess_flag(request) -> tuple[bool, bool]:
    def _to_val(v: str) -> str:
        return (v or "").strip().lower()
    q = _to_val(request.query_params.get("reprocess"))
    h = _to_val(request.headers.get("X-Reprocess"))
    auto = (q == "auto") or (h == "auto")
    yes  = (q in ("1", "true", "yes")) or (h in ("1", "true", "yes"))
    return yes, auto


@extend_schema(tags=["Main"], summary="Главный POST запрос")
@api_view(["POST"])
@parser_classes([JSONParser])  
def stream_transaction(request):
    if not (request.content_type or "").lower().startswith("application/json"):
        return Response({"error": "Поддерживается только application/json"}, status=http_status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)
    items = _ensure_list(request.data)
    if not items:
        return Response({"error": "Нет транзакций для обработки"}, status=http_status.HTTP_400_BAD_REQUEST)
    if isinstance(items, list) and len(items) > MAX_BATCH:
        return Response(
            {"error": f"Слишком большой батч JSON: {len(items)} > {MAX_BATCH}. Отправьте несколькими запросами."},
            status=413
        )
    total_received = len(items)
    total_queued = 0
    total_invalid = 0
    total_dedup_dropped = 0
    errors_preview: List[dict] = []
    reprocess_yes, reprocess_auto = _reprocess_flag(request)

    batch_fingerprint = _make_fingerprint(items if isinstance(items, list) else [items])

    try:
        if r.sismember(FPG_SEEN_KEY, batch_fingerprint) and not reprocess_yes:
            reprocess_auto = True  
    except Exception:
        pass

    mode_ns = "auto" if reprocess_auto else ("reprocess" if reprocess_yes else "normal")
    idem_key = request.headers.get("Idempotency-Key") or request.query_params.get("idempotency_key")
    idem_redis_key = f"{IDEMP_NS}:{mode_ns}:{idem_key}" if idem_key else None

    if idem_redis_key:
        cached = r.get(idem_redis_key)
        if cached:
            try:
                payload = json.loads(cached)
            except Exception:
                payload = None
            if payload:
                payload.setdefault("idempotency", {})
                payload["idempotency"].update({
                    "duplicate_of": idem_key,
                    "cached": True,
                    "mode": mode_ns,
                    "batch_fingerprint": batch_fingerprint,
                })
                return Response(payload, status=http_status.HTTP_200_OK)

    for start in range(0, total_received, VAL_CHUNK):
        part = items[start:start + VAL_CHUNK]

        for it in part:
            if it.get("time_since_last_transaction") in ("", None):
                it["time_since_last_transaction"] = 0.0

        ser = TransactionSerializer(data=part, many=True)
        ok = ser.is_valid(raise_exception=False)

        valid_objs: List[dict] = []
        if ok:
            valid_objs = list(ser.validated_data)
        else:
            
            chunk_errors = [{"index": start + i, "error": e} for i, e in enumerate(ser.errors) if e]
            take = min(100 - len(errors_preview), len(chunk_errors))
            if take > 0:
                errors_preview.extend(chunk_errors[:take])
            total_invalid += sum(1 for e in ser.errors if e)

            vd = list(ser.validated_data)  
            j = 0
            for err in ser.errors:
                if not err and j < len(vd):
                    valid_objs.append(vd[j])
                    j += 1

        if not valid_objs:
            continue

        cleaned = [sanitize_record(o) for o in valid_objs]

        if reprocess_auto:
            
            txids = [str(o.get("transaction_id") or "").strip() for o in cleaned if o.get("transaction_id")]
            existing = set()
            if txids:
                for i in range(0, len(txids), LOOKUP_CHUNK):
                    part_ids = txids[i:i + LOOKUP_CHUNK]
                    if part_ids:
                        existing.update(
                            Transaction.objects
                            .filter(transaction_id__in=part_ids)
                            .values_list("transaction_id", flat=True)
                        )

            old_side, new_side = [], []
            for o in cleaned:
                if str(o.get("transaction_id") or "").strip() in existing:
                    o["recalc"] = "1"  
                    old_side.append(o)
                else:
                    new_side.append(o)

            
            def _tokens_for(obj: dict) -> List[str]:
                toks = []
                for key in DEDUP_KEYS:
                    v = obj.get(key)
                    if v is None:
                        continue
                    s = str(v).strip()
                    if s:
                        toks.append(f"{key}:{s}")
                return toks

            seen_by_dedup_idxs = set()
            flat_tokens: List[str] = []
            idx_of_token: List[int] = []
            for idx, o in enumerate(new_side):
                for t in _tokens_for(o):
                    flat_tokens.append(t)
                    idx_of_token.append(idx)

            for i in range(0, len(flat_tokens), DEDUP_CHUNK):
                part_tokens = flat_tokens[i:i + DEDUP_CHUNK]
                if not part_tokens:
                    continue
                try:
                    flags = r.execute_command("SMISMEMBER", DEDUP_SET, *part_tokens)
                except redis.ResponseError:
                    pipe = r.pipeline(transaction=False)
                    for t in part_tokens:
                        pipe.sismember(DEDUP_SET, t)
                    flags = pipe.execute()
                for tok_idx, f in zip(range(i, i + len(part_tokens)), flags):
                    if bool(f):
                        seen_by_dedup_idxs.add(idx_of_token[tok_idx])

            really_new, also_old = [], []
            for idx, o in enumerate(new_side):
                if idx in seen_by_dedup_idxs:
                    x = dict(o)
                    x["recalc"] = "1"
                    also_old.append(x)
                else:
                    really_new.append(o)

            old_side.extend(also_old)

            if old_side:
                total_queued += _xadd_partition(old_side)

            if really_new:
                really_new, dropped = _dedup_partition(really_new)
                total_dedup_dropped += dropped
                if really_new:
                    total_queued += _xadd_partition(really_new)
        else:
            if reprocess_yes:
                
                for o in cleaned:
                    o["recalc"] = "1"
                total_queued += _xadd_partition(cleaned)
            else:
                cleaned, dropped = _dedup_partition(cleaned)
                total_dedup_dropped += dropped
                if cleaned:
                    total_queued += _xadd_partition(cleaned)
    try:
        r.xtrim(STREAM, STREAM_MAXLEN, approximate=TRIM_APPROX)
    except Exception as e:
        logger.warning({"event": "xtrim_failed", "error": str(e)})

    logger.info({
        "component": "ingest",
        "event": "queued_to_stream",
        "received": total_received,
        "queued": total_queued,
        "invalid": total_invalid,
        "dedup": "on" if USE_DEDUP else "off",
        "dedup_dropped": total_dedup_dropped,
        "stream_maxlen": STREAM_MAXLEN,
        "mode": mode_ns,
    })

    payload = {
        "summary": {
            "received": total_received,
            "queued": total_queued,
            "invalid": total_invalid,
            "dedup_dropped": total_dedup_dropped
        },
        "idempotency": {
            "key_used": bool(idem_key),
            "mode": mode_ns,
            "batch_fingerprint": batch_fingerprint
        }
    }
    if errors_preview:
        payload["errors"] = errors_preview  
    
    if idem_redis_key:
        try:
            r.setex(idem_redis_key, IDEMP_TTL_SEC, json.dumps(payload, ensure_ascii=False))
        except Exception as e:
            logger.warning({"event": "idempotency_cache_set_failed", "error": str(e)})

    try:
        r.sadd(FPG_SEEN_KEY, batch_fingerprint)
        if FPG_TTL_SEC > 0:
            r.expire(FPG_SEEN_KEY, FPG_TTL_SEC)
    except Exception:
        pass

    return Response(payload, status=http_status.HTTP_202_ACCEPTED)


@extend_schema(tags=["Analytics"], summary="Получить общую статистику по транзакциям")
@api_view(["GET"])
def analytics_stats(request):
    try:
        transactions = Transaction.objects.all()
        total_transactions = transactions.count()

        fraud_transactions = transactions.filter(status=Transaction.STATUS_ALERTED).count()
        processed_transactions = transactions.filter(status=Transaction.STATUS_PROCESSED).count()
        reviewed_transactions = transactions.filter(is_reviewed=True).count()

        fraud_rate = (fraud_transactions / total_transactions * 100) if total_transactions > 0 else 0

        return JsonResponse({
            'total_transactions': total_transactions,
            'processed_transactions': processed_transactions,
            'fraud_transactions': fraud_transactions,
            'reviewed_transactions': reviewed_transactions,
            'fraud_rate': round(fraud_rate, 1),
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@extend_schema(tags=["Analytics"], summary="Статистика по типам транзакций")
@api_view(["GET"])
def analytics_types(request):
    try:
        type_stats = Transaction.objects.values('transaction_type').annotate(count=Count('id')).order_by('-count')
        result = {}
        for stat in type_stats:
            result[stat['transaction_type']] = stat['count']
        return JsonResponse(result)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@extend_schema(tags=["Analytics"], summary="Статистика по типам оплат")
@api_view(["GET"])
def analytics_channels(request):
    try:
        channel_stats = Transaction.objects.exclude(payment_channel__isnull=True).exclude(payment_channel='').values('payment_channel').annotate(count=Count('id')).order_by('-count')[:10]
        result = {}
        for stat in channel_stats:
            result[stat['payment_channel']] = stat['count']
        return JsonResponse(result)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
    

@extend_schema(tags=["Analytics"], summary="Статистика по статусам транзакций")
@api_view(["GET"])
def analytics_status_distribution(request):
    try:
        transactions = Transaction.objects.all()

     
        status_stats = {
            'alerted': transactions.filter(status=Transaction.STATUS_ALERTED).count(),
            'processed': transactions.filter(status=Transaction.STATUS_PROCESSED).count(),
            'reviewed': transactions.filter(is_reviewed=True).count(),
            'not_reviewed': transactions.filter(is_reviewed=False).count(),
        }

        return JsonResponse(status_stats)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@extend_schema(tags=["Analytics"], summary="Расширенная статистика")
@api_view(["GET"])
def analytics_detailed_stats(request):
    try:
        transactions = Transaction.objects.all()

        amount_stats = transactions.aggregate(
            avg_amount=Avg('amount'),
            max_amount=Max('amount'),
            min_amount=Min('amount'),
            total_amount=Sum('amount')
        )
      
        total_reviewed = transactions.filter(is_reviewed=True).count()
        pending_review = transactions.filter(is_reviewed=False).count()

        success_count = transactions.filter(status=Transaction.STATUS_PROCESSED).count()
        fraud_count = transactions.filter(status=Transaction.STATUS_ALERTED).count()

        top_devices = (
            transactions.exclude(device_used__isnull=True)
            .exclude(device_used='')
            .values('device_used')
            .annotate(count=Count('id'))
            .order_by('-count')[:5]
        )

        return JsonResponse({
            'amount_stats': {
                'avg_amount': float(amount_stats['avg_amount'] or 0),
                'max_amount': float(amount_stats['max_amount'] or 0),
                'min_amount': float(amount_stats['min_amount'] or 0),
                'total_amount': float(amount_stats['total_amount'] or 0),
            },
            'review_stats': {
                'total_reviewed': total_reviewed,
                'pending_review': pending_review,
                'success_count': success_count,
                'fraud_count': fraud_count,
            },
            'top_devices': list(top_devices),
        })
    
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
    

@extend_schema(tags=["Rules"], summary="Создать ML правило")
@api_view(["POST"])
def create_ml_rule(request):
    serializer = MLRuleSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@extend_schema(tags=["Rules"], summary="Тестирование ML правила")
@api_view(["POST"])
def test_ml_rule(request, id):
    try:
        ml_rule = MLRule.objects.get(id=id)
        test_transactions = request.data.get('transactions', [])
        
        ml_engine = MLEngine.get_instance()
        results = []
        
        for tx_data in test_transactions:
            is_fraud, probability, conditions = ml_engine.evaluate_transaction(ml_rule, tx_data)
            results.append({
                'transaction_id': tx_data.get('transaction_id', 'unknown'),
                'triggered': is_fraud,
                'probability': probability,
                'reason': f"ML вероятность: {probability:.4f}",
                'conditions': conditions
            })
        
        return Response({
            'rule_id': id,
            'rule_name': ml_rule.title,
            'results': results
        })
        
    except MLRule.DoesNotExist:
        return Response({"error": "ML правило не найдено"}, status=404)
