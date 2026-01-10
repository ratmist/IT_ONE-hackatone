import os
import json
import redis
import operator
from datetime import datetime, timedelta
from django.db.models import Count, Sum, Max
from django.utils import timezone
from transactions.models import Transaction


def parse_datetime_safe(s: str):
    formats = [
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%d.%m.%Y %H:%M",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Не удалось распознать дату: {s}")


def threshold(data: dict, column: str, value: float, op: str):
    ops = {
        ">": operator.gt,
        ">=": operator.ge,
        "<": operator.lt,
        "<=": operator.le,
        "==": operator.eq,
        "!=": operator.ne,
    }
    if op not in ops:
        raise ValueError(f"Неизвестный оператор: {op}")
    try:
        left = float(data.get(column, 0))
    except (TypeError, ValueError):
        raise ValueError(f"Некорректное значение поля '{column}': {data.get(column)}")
    result = ops[op](left, value)
    reason = f"{column} {op} {value} → {left} → {'True' if result else 'False'}"
    return result, reason


def composite(tx: dict, rule_json: dict, depth: int = 0):
    ops = {
        ">": operator.gt,
        ">=": operator.ge,
        "<": operator.lt,
        "<=": operator.le,
        "==": operator.eq,
        "!=": operator.ne,
    }
    indent = "  " * depth
    if "column" in rule_json:
        col = rule_json["column"]
        op = rule_json["operator"]
        expected = rule_json["value"]

        if op not in ops:
            return False, f"{indent}⚠️ Неизвестный оператор '{op}' для {col}"

        actual = tx.get(col)
        if actual in (None, ""):
            return False, f"{indent}⚠️ Поле '{col}' пустое — пропуск"

        try:
            actual_val = float(actual)
            expected_val = float(expected)
        except (TypeError, ValueError):
            actual_val = str(actual)
            expected_val = str(expected)

        try:
            result = ops[op](actual_val, expected_val)
            reason = f"{col} {op} {expected_val} → {actual_val} → {result}"
            return result, reason
        except Exception as e:
            return False, f"{indent}⚠️ Ошибка при сравнении '{col}': {e}"

    logic = rule_json.get("logic", "AND").upper()
    subrules = rule_json.get("conditions", [])
    if not isinstance(subrules, list) or not subrules:
        return False, f"{indent}⚠️ Нет подусловий в блоке {logic}"

    results = []
    reasons = []

    for sub in subrules:
        sub_res, sub_reason = composite(tx, sub, depth + 1)
        results.append(sub_res)
        reasons.append(sub_reason)

    if logic == "AND":
        result = all(results)
    elif logic == "OR":
        result = any(results)
    elif logic == "NOT":
        if len(results) != 1:
            return False, f"{indent}⚠️ 'NOT' должен иметь одно подусловие"
        result = not results[0]
    else:
        return False, f"{indent}⚠️ Недопустимый логический оператор {logic}"

    reason = f"{logic}({'; '.join(reasons)}) → {result}"
    return result, reason


def pattern(tx: dict, rule):
    now = tx.get("timestamp")
    if not now or not hasattr(now, "tzinfo"):
        now = timezone.now()

    window_seconds = getattr(rule, "window_seconds", None)
    if window_seconds is None:
        wm = getattr(rule, "window_minutes", 10)
        try:
            window_seconds = int(wm) * 60
        except Exception:
            window_seconds = 600

    window_start = now - timedelta(seconds=window_seconds)

    sender = tx.get("sender_account")
    receiver = tx.get("receiver_account")

    if rule.group_mode == "sender":
        if not sender:
            return False, "Нет sender_account"
        filt = {"sender_account": sender}
        group_label = f"sender={sender}"

    elif rule.group_mode == "receiver":
        if not receiver:
            return False, "Нет receiver_account"
        filt = {"receiver_account": receiver}
        group_label = f"receiver={receiver}"

    elif rule.group_mode == "pair":
        if not sender or not receiver:
            return False, "Нет sender_account или receiver_account"
        filt = {"sender_account": sender, "receiver_account": receiver}
        group_label = f"pair={sender}->{receiver}"

    else:
        return False, f"Неизвестный group_mode={rule.group_mode}"

    qs = Transaction.objects.filter(timestamp__gte=window_start, **filt)
    agg = qs.aggregate(
        cnt=Count("id"),
        total=Sum("amount"),
        max_amount=Max("amount"),
    )

    count_ops_db = int(agg["cnt"] or 0)
    total_amount_db = float(agg["total"] or 0.0)
    max_amount_db = float(agg["max_amount"] or 0.0)
    amount_cur = float(tx.get("amount") or 0.0)
    count_ops = count_ops_db + 1
    total_amount = total_amount_db + amount_cur
    max_amount = max(max_amount_db, amount_cur)
    min_count = int(getattr(rule, "min_count", 1) or 1)
    triggered = count_ops >= min_count

    total_limit = getattr(rule, "total_amount_limit", None)
    if total_limit is not None:
        triggered = triggered and (total_amount <= float(total_limit))

    per_tx_max_limit = getattr(rule, "min_amount_limit", None)
    if per_tx_max_limit is not None:
        triggered = triggered and (max_amount <= float(per_tx_max_limit))

    per_tx_min_limit = getattr(rule, "per_tx_min_limit", None)
    if per_tx_min_limit is not None:
        triggered = triggered and (amount_cur >= float(per_tx_min_limit))

    mm = window_seconds / 60
    mm_txt = int(mm) if window_seconds % 60 == 0 else round(mm, 1)

    reason = (
        f"{count_ops} операций за {mm_txt} мин, сумма={total_amount:.2f}, "
        f"max_amount={max_amount:.2f} ({group_label})"
    )

    return triggered, reason


r = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", "6480")),
    decode_responses=True,
)


def _safe_json(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _safe_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_safe_json(v) for v in obj]
    return obj


def ml_eval(transaction_data, ml_rule, advisory_only=True):
    txid = transaction_data.get("transaction_id")
    model_name = ml_rule.model_name
    key = f"ml:{txid}"

    cached = r.get(key)
    if cached:
        prob = float(cached)
        reason = f"ML {model_name}: вероятность={prob:.4f}"
        triggered = prob >= ml_rule.threshold if not advisory_only else False
        return triggered, reason

    payload = {
        "transaction_id": txid,
        "model": model_name,
        "template": ml_rule.input_template,
        "threshold": ml_rule.threshold,
        "data": _safe_json(transaction_data),
    }

    try:
        r.xadd(
            "ml_eval_queue",
            {"payload": json.dumps(payload)},
            maxlen=5000,
        )
    except Exception as e:
        return False, f"Ошибка постановки ML задачи: {e}"

    return False, f"ML {model_name}: задача поставлена в очередь"
