import os
import time
import json
import redis
import django
import logging
from datetime import timedelta
from logging.handlers import RotatingFileHandler
from dotenv import load_dotenv
from django.db import connection
from django.db import transaction as db_tx
from django.db.models import Count, Sum, Max
from django.db.utils import OperationalError
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from transactions.models import (Transaction,ThresholdRule,CompositeRule,PatternRule,MLRule,)
from transactions.rules import (threshold as thr_eval,composite as comp_eval,pattern as patt_eval,ml_eval,)
from transactions.constrants import crit_to_level
from transactions.webhook import send_alert_webhook
from transactions.ml_engine import MLEngine


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()
load_dotenv()

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
STREAM     = os.getenv("TX_STREAM", "transactions_stream")
GROUP      = os.getenv("TX_GROUP", "1")
CONSUMER   = os.getenv("TX_CONSUMER", f"worker-{os.getpid()}")

READ_COUNT         = int(os.getenv("TX_READ_COUNT", "8000"))      
BLOCK_MS           = int(os.getenv("TX_BLOCK_MS", "5000"))
CLAIM_EVERY_SEC    = int(os.getenv("TX_CLAIM_INTERVAL", "10"))
MIN_IDLE_MS        = int(os.getenv("TX_MIN_IDLE_MS", "300000"))
BULK_INSERT_CHUNK  = int(os.getenv("TX_BULK_CHUNK", "5000"))     
RULES_TTL_SEC      = float(os.getenv("TX_RULES_TTL_SEC", "30")) 

_RULES_CACHE = {"items": [], "loaded_at": 0.0}
_RULES_NEEDS_RELOAD = False

STOP_MODE = os.getenv("TX_STOP_MODE")    
STOP_CRIT = os.getenv("TX_STOP_CRITICALITY") 
STOP_CRIT_L = crit_to_level(STOP_CRIT)

LOG_DIR  = os.getenv("LOG_DIR", "/app/logs")
LOG_FILE = os.getenv("LOG_FILE", os.path.join(LOG_DIR, "worker.log"))
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger("transactions.worker")
transaction_logger = logging.getLogger('transaction_audit')
logger.setLevel(logging.INFO)
logger.handlers.clear()
fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

sh = logging.StreamHandler()
sh.setFormatter(fmt)
logger.addHandler(sh)

fh = RotatingFileHandler(LOG_FILE, maxBytes=10_000_000, backupCount=5, encoding="utf-8")
fh.setFormatter(fmt)
logger.addHandler(fh)
if os.getenv("TX_DISABLE_FILE_LOG", "0") == "1":
    logger.removeHandler(fh)

logger.propagate = False
logger.warning({"event": "worker_starting", "log_file": LOG_FILE})
system_logger = logging.getLogger("system_events")
system_logger.setLevel(logging.INFO)
system_logger.propagate = False

sys_log_path = os.path.join(LOG_DIR, "system.log")
sh_sys = logging.StreamHandler()
fh_sys = RotatingFileHandler(sys_log_path, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
fmt_sys = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

sh_sys.setFormatter(fmt_sys)
fh_sys.setFormatter(fmt_sys)
system_logger.addHandler(sh_sys)
system_logger.addHandler(fh_sys)

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
try:
    r.ping()
    logger.warning({"event": "redis_connect_ok", "host": REDIS_HOST, "port": REDIS_PORT, "stream": STREAM, "group": GROUP})
except Exception as e:
    logger.error({"event": "redis_connect_fail", "error": str(e)})
    raise

try:
    r.xgroup_create(STREAM, GROUP, mkstream=True)
    logger.info({"event": "xgroup_create", "stream": STREAM, "group": GROUP})
except redis.ResponseError as e:
    if "BUSYGROUP" in str(e):
        logger.info({"event": "xgroup_exists", "stream": STREAM, "group": GROUP})
    else:
        logger.error({"event": "xgroup_error", "error": str(e)})
        raise


def _aware(dt):
    if dt is None:
        return timezone.now()
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def _warm_ml_models(rules_merged):
    engine = MLEngine.get_instance()
    model_names = []

    for kind, _c, _u, _id, _crit, rule in rules_merged:
        if kind == "ml":
            mn = getattr(rule, "model_name", None)
            if mn:
                model_names.append(mn)

    for model_name in set(model_names):
        try:
            engine.load_model(model_name)
            logger.info({
                "event": "ml_model_warm",
                "model_name": model_name,
                "status": "ok"
            })
        except Exception as e:
            logger.error({
                "event": "ml_model_warm_fail",
                "model_name": model_name,
                "error": str(e)
            })


def _load_all_active_rules_from_db() -> list:
    thr = ThresholdRule.objects.filter(is_active=True).only(
        "id","title","column_name","operator","value","criticality","created_at","updated_at"
    )
    comp = CompositeRule.objects.filter(is_active=True).only(
        "id","title","rule","criticality","created_at","updated_at"
    )
    patt = PatternRule.objects.filter(is_active=True).only(
        "id","title","window_seconds","min_count",
        "total_amount_limit","min_amount_limit","group_mode","criticality",
        "created_at","updated_at"
    )
    ml = MLRule.objects.filter(is_active=True).only(
        "id","title","threshold","model_name","input_template","criticality","created_at","updated_at"
    )

    merged = []
    for r in thr:  merged.append(("threshold", r.created_at, r.updated_at, r.id, r.criticality, r))
    for r in comp: merged.append(("composite", r.created_at, r.updated_at, r.id, r.criticality, r))
    for r in patt: merged.append(("pattern",   r.created_at, r.updated_at, r.id, r.criticality, r))
    for r in ml:   merged.append(("ml",        r.created_at, r.updated_at, r.id, r.criticality, r))  # 👈
    merged.sort(key=lambda x: (_aware(x[2]), x[3]))
    return merged


def _pubsub_listener():
    global _RULES_NEEDS_RELOAD
    ps = r.pubsub()
    ps.subscribe("rules_reload")
    system_logger.warning("👂 Подписались на канал обновления правил (rules_reload)")
    for msg in ps.listen():
        if msg.get("type") == "message":
            _RULES_NEEDS_RELOAD = True
            system_logger.warning("📢 Получен сигнал обновления правил — кэш помечен на перезагрузку")


def _maybe_refresh_rules_cache():
    global _RULES_NEEDS_RELOAD
    now = time.monotonic()
    need_reload = (
        _RULES_NEEDS_RELOAD
        or (now - _RULES_CACHE["loaded_at"] > RULES_TTL_SEC)
        or not _RULES_CACHE["items"]
    )

    if need_reload:
        old_count = len(_RULES_CACHE["items"])

        system_logger.warning("══════════════════════════════════════════════════════════════")
        system_logger.warning("RULES CACHE RELOADING...")

        merged = _load_all_active_rules_from_db()
        _RULES_CACHE["items"] = merged
        _RULES_CACHE["loaded_at"] = now

        system_logger.warning({
            "event": "rules_cache_refresh",
            "before": old_count,
            "after": len(merged),
            "msg": "=== Правила перезагружены ==="
        })

        try:
            _warm_ml_models(merged)
            system_logger.info("ML модели прогреты")
        except Exception as e:
            system_logger.warning({
                "event": "ml_warm_error",
                "error": str(e)
            })

        _RULES_NEEDS_RELOAD = False
        system_logger.warning("══════════════════════════════════════════════════════════════")

    try:
        MLEngine.get_instance()
        system_logger.info({"event": "ml_engine_ready"})
    except Exception as e:
        system_logger.warning({"event": "ml_engine_init_fail", "error": str(e)})


def load_rules_snapshot(batch_cutoff) -> list:
    _maybe_refresh_rules_cache()
    cutoff = _aware(batch_cutoff)
    out = []
    for t in _RULES_CACHE["items"]:
        updated = _aware(t[2])  
        if updated <= cutoff:
            out.append(t)
    return out


def read_batch():
    msgs = r.xreadgroup(GROUP, CONSUMER, {STREAM: ">"}, count=READ_COUNT, block=BLOCK_MS)
    if not msgs:
        return []
    _, batch = msgs[0]
    return batch


def _coerce_types(d: dict) -> dict:
    out = dict(d)
    ts = out.get("timestamp")
    if isinstance(ts, str):
        dt = parse_datetime(ts)
        if dt:
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt)
            out["timestamp"] = dt
    return out


def _build_pattern_stats(batch, pattern_rules):
    if not pattern_rules or not batch:
        return {"sender": {}, "receiver": {}, "pair": {}, "max_window_seconds": 0}

    need_sender = any(r.group_mode == "sender" for r in pattern_rules)
    need_receiver = any(r.group_mode == "receiver" for r in pattern_rules)
    need_pair = any(r.group_mode == "pair" for r in pattern_rules)

    max_window = 0
    for r in pattern_rules:
        ws = getattr(r, "window_seconds", None)
        if ws is None:
            wm = getattr(r, "window_minutes", 10)
            try:
                ws = int(wm) * 60
            except Exception:
                ws = 600
        max_window = max(max_window, int(ws))

    senders, receivers, pairs = set(), set(), set()
    for _mid, d in batch:
        s = d.get("sender_account"); rcv = d.get("receiver_account")
        if need_sender and s: senders.add(s)
        if need_receiver and rcv: receivers.add(rcv)
        if need_pair and s and rcv: pairs.add((s, rcv))

    if max_window <= 0:
        return {"sender": {}, "receiver": {}, "pair": {}, "max_window_seconds": 0}

    window_start = timezone.now() - timedelta(seconds=max_window)

    sender_stats = {}
    if senders:
        qs = (Transaction.objects
              .filter(sender_account__in=list(senders), timestamp__gte=window_start)
              .values("sender_account")
              .annotate(cnt=Count("id"), total=Sum("amount"), mx=Max("amount")))
        sender_stats = {
            row["sender_account"]: (int(row["cnt"] or 0), float(row["total"] or 0.0), float(row["mx"] or 0.0))
            for row in qs
        }

    receiver_stats = {}
    if receivers:
        qs = (Transaction.objects
              .filter(receiver_account__in=list(receivers), timestamp__gte=window_start)
              .values("receiver_account")
              .annotate(cnt=Count("id"), total=Sum("amount"), mx=Max("amount")))
        receiver_stats = {
            row["receiver_account"]: (int(row["cnt"] or 0), float(row["total"] or 0.0), float(row["mx"] or 0.0))
            for row in qs
        }

    pair_stats = {}
    if pairs:
        s_list = list({s for s, _ in pairs})
        r_list = list({r for _, r in pairs})
        qs = (Transaction.objects
              .filter(timestamp__gte=window_start,
                      sender_account__in=s_list,
                      receiver_account__in=r_list)
              .values("sender_account", "receiver_account")
              .annotate(cnt=Count("id"), total=Sum("amount"), mx=Max("amount")))
        for row in qs:
            pair_stats[(row["sender_account"], row["receiver_account"])] = (
                int(row["cnt"] or 0), float(row["total"] or 0.0), float(row["mx"] or 0.0)
            )

    return {
        "sender": sender_stats,
        "receiver": receiver_stats,
        "pair": pair_stats,
        "max_window_seconds": max_window,
    }


def _pattern_batched(tx: dict, rule, stats) -> tuple[bool, str]:
    s = tx.get("sender_account"); rcv = tx.get("receiver_account")
    amount_cur = float(tx.get("amount") or 0.0)

    if rule.group_mode == "sender":
        cnt, total, mx = stats["sender"].get(s, (0, 0.0, 0.0))
        group_label = f"sender={s}"
    elif rule.group_mode == "receiver":
        cnt, total, mx = stats["receiver"].get(rcv, (0, 0.0, 0.0))
        group_label = f"receiver={rcv}"
    elif rule.group_mode == "pair":
        cnt, total, mx = stats["pair"].get((s, rcv), (0, 0.0, 0.0))
        group_label = f"pair={s}->{rcv}"
    else:
        return False, f"Неизвестный group_mode={rule.group_mode}"

    cnt += 1
    total += amount_cur
    mx = max(mx, amount_cur)

    min_count = int(getattr(rule, "min_count", 1) or 1)
    triggered = cnt >= min_count

    total_limit = getattr(rule, "total_amount_limit", None)
    if total_limit is not None:
        triggered = triggered and (total <= float(total_limit))

    per_tx_max_limit = getattr(rule, "min_amount_limit", None)  
    if per_tx_max_limit is not None:
        triggered = triggered and (mx <= float(per_tx_max_limit))

    mm = stats["max_window_seconds"] / 60 if stats["max_window_seconds"] else 0
    mm_txt = int(mm) if stats["max_window_seconds"] % 60 == 0 else round(mm, 1)
    reason = f"{cnt} операций за {mm_txt} мин, сумма={total:.2f}, max_amount={mx:.2f} ({group_label})"
    return triggered, reason


def apply_rules(tx, rules_snapshot, pattern_stats=None):
    fired_rules = []
    fired = False
    max_crit = 0

    ml_rules = [r for r in rules_snapshot if r[0] == "ml"]

    for kind, _created, _updated, _id, crit, rule in rules_snapshot:
        try:
            if kind == "threshold":
                res = thr_eval(tx, rule.column_name, rule.value, rule.operator)
            elif kind == "composite":
                res = comp_eval(tx, rule.rule)
            elif kind == "pattern":
                res = (_pattern_batched(tx, rule, pattern_stats)
                       if pattern_stats else patt_eval(tx, rule))
            elif kind == "ml":
                continue
            else:
                continue

            triggered = res[0] if isinstance(res, tuple) else bool(res)
            reason = res[1] if isinstance(res, tuple) and len(res) > 1 else ""

            if not triggered:
                continue

            fired = True
            fired_rules.append({
                "id": _id,
                "type": kind,
                "title": getattr(rule, "title", ""),
                "criticality": crit,
                "reason": reason
            })

            lvl = crit_to_level(crit)
            if lvl > max_crit:
                max_crit = lvl

            logger.info({
                "event": "rule_triggered",
                "rule_id": _id,
                "rule_type": kind,
                "rule_title": getattr(rule, "title", ""),
                "criticality": crit,
                "reason": reason,
                "tx_id": tx.get("transaction_id")
            })

            if STOP_MODE == "critical" and lvl >= STOP_CRIT_L:
                break

        except Exception as e:
            logger.warning({
                "event": "rule_error",
                "kind": kind,
                "rule_id": _id,
                "title": getattr(rule, "title", ""),
                "error": str(e)
            })

    for kind, _created, _updated, _id, crit, rule in ml_rules:
        try:
            res = ml_eval(tx, rule, advisory_only=True)
            logger.debug({
                "event": "ml_prob",
                "tx_id": tx.get("transaction_id"),
                "model": rule.model_name,
                "result": res[1]  
            })
        except Exception as e:
            logger.warning({
                "event": "ml_error",
                "rule_id": _id,
                "error": str(e)
            })

    return fired, fired_rules, max_crit


def process_batch(batch, rules_snapshot):
    rules_memory = {}
    if not batch:
        return 0

    pattern_rules = [t[5] for t in rules_snapshot if t[0] == "pattern"]
    patt_stats = _build_pattern_stats(batch, pattern_rules)
    t_build = time.perf_counter()
    to_insert, msg_ids_to_ack = [], []
    want_alerted_txids, reprocess_alert_txids = set(), set()
    recalc_candidates = []  

    for msg_id, data in batch:
        data = _coerce_types(data)
        data.pop("is_fraud", None)
        data.pop("is_reviewed", None)
        is_recalc = str(data.get("recalc", "0")) == "1"
        triggered, fired_rules, max_crit = apply_rules(data, rules_snapshot, patt_stats)
        data["_fired_rules"] = fired_rules
        txid = data.get("transaction_id")
        if txid:
            rules_memory[txid] = fired_rules 

        if is_recalc:
            if txid:
                recalc_candidates.append((msg_id, data, triggered))
            else:
                msg_ids_to_ack.append(msg_id)
            continue

        desired_status = Transaction.STATUS_ALERTED if triggered else Transaction.STATUS_PROCESSED
        data["status"] = desired_status

        if txid and desired_status == Transaction.STATUS_ALERTED:
            want_alerted_txids.add(txid)

        transaction_log = {
            "event": "transaction_log",
            "transaction_id": data.get("transaction_id"),
            "sender": data.get("sender_account"),
            "receiver": data.get("receiver_account"),
            "amount": data.get("amount"),
            "status": data.get("status"),
            "timestamp": (
                data.get("timestamp").isoformat() if hasattr(data.get("timestamp"), "isoformat") else str(data.get("timestamp"))
            ),
            "correlation_id": data.get("correlation_id"),
            "type": data.get("transaction_type"),
            "additional": {k: v for k, v in data.items() if k not in [
                "transaction_id", "sender_account", "receiver_account", "amount", "status", "timestamp",
                "correlation_id", "transaction_type"
            ]}
        }
        transaction_logger.info(transaction_log)

        data.pop("_fired_rules", None)
        to_insert.append(Transaction(**data))
        msg_ids_to_ack.append(msg_id)

    recalc_txids = [d.get("transaction_id") for _, d, _ in recalc_candidates if d.get("transaction_id")]
    existing = set()

    if recalc_txids:
        for i in range(0, len(recalc_txids), 5000):
            part = recalc_txids[i:i+5000]
            existing.update(
                Transaction.objects.filter(transaction_id__in=part).values_list("transaction_id", flat=True)
            )

    for msg_id, data, triggered in recalc_candidates:
        txid = data.get("transaction_id")
        if txid in existing:
            if triggered:
                reprocess_alert_txids.add(txid)
            msg_ids_to_ack.append(msg_id)
        else:
            desired_status = Transaction.STATUS_ALERTED if triggered else Transaction.STATUS_PROCESSED
            data.pop("recalc", None)
            data["status"] = desired_status
            if txid and desired_status == Transaction.STATUS_ALERTED:
                want_alerted_txids.add(txid)
            transaction_log = {
                "event": "transaction_log",
                "transaction_id": data.get("transaction_id"),
                "sender": data.get("sender_account"),
                "receiver": data.get("receiver_account"),
                "amount": data.get("amount"),
                "status": data.get("status"),
                "timestamp": (
                    data.get("timestamp").isoformat() if hasattr(data.get("timestamp"), "isoformat") else str(data.get("timestamp"))
                ),
                "correlation_id": data.get("correlation_id"),
                "type": data.get("transaction_type"),
                "additional": {k: v for k, v in data.items() if k not in [
                    "transaction_id", "sender_account", "receiver_account", "amount", "status", "timestamp",
                    "correlation_id", "transaction_type"
                ]}
            }
            transaction_logger.info(transaction_log)
            to_insert.append(Transaction(**data))
            msg_ids_to_ack.append(msg_id)
    
    to_insert.sort(key=lambda o: o.transaction_id or "") 
    build_ms = (time.perf_counter() - t_build) * 1000.0
    t_db = time.perf_counter()
    for i in range(0, len(to_insert), BULK_INSERT_CHUNK):
        chunk = to_insert[i:i+BULK_INSERT_CHUNK]
        try:
            with db_tx.atomic():
                with connection.cursor() as c:
                    c.execute("SET LOCAL lock_timeout = '5s'")
                    c.execute("SET LOCAL statement_timeout = '30s'")

                Transaction.objects.bulk_create(
                    chunk,
                    ignore_conflicts=True,
                )

        except OperationalError as e:
            logger.error({
                "event": "bulk_insert_failed",
                "chunk_start": i,
            "chunk_size": len(chunk),
            "error": str(e),
        })
        continue

    with db_tx.atomic():
        if want_alerted_txids:
            Transaction.objects.filter(
                transaction_id__in=list(want_alerted_txids)
            ).exclude(status=Transaction.STATUS_ALERTED).update(
                status=Transaction.STATUS_ALERTED
            )

        if reprocess_alert_txids:
            Transaction.objects.filter(
                transaction_id__in=list(reprocess_alert_txids)
            ).exclude(status=Transaction.STATUS_ALERTED).update(
                status=Transaction.STATUS_ALERTED
            )
    db_ms = (time.perf_counter() - t_db) * 1000.0
    t_ack = time.perf_counter()
    pipe = r.pipeline(transaction=False)
    for mid in msg_ids_to_ack:
        pipe.xack(STREAM, GROUP, mid)
    pipe.execute()
    ack_ms = (time.perf_counter() - t_ack) * 1000.0
    logger.info({
        "event": "process_batch_timings_ms",
        "build_ms": round(build_ms, 1),
        "db_ms": round(db_ms, 1),
        "ack_ms": round(ack_ms, 1),
        "batch_size": len(batch),
        "inserted": len(to_insert),
        "reprocess_upgraded": len(reprocess_alert_txids),
    })
    if want_alerted_txids:
        rules_by_tx = {
            txid: fired
            for txid, fired in rules_memory.items()
            if fired
        }

        for txid, rules_list in rules_by_tx.items():
            if not rules_list:
                continue

            tx_data = next((d for _, d in batch if d.get("transaction_id") == txid), None)
            if not tx_data:
                continue

            rule_titles = [r["title"] for r in rules_list]
            rule_reasons = [r.get("reason", "") for r in rules_list if r.get("reason")]

            max_rule = max(
                rules_list,
                key=lambda r: crit_to_level(r["criticality"]),
                default={"criticality": "medium"},
            )
            crit = max_rule["criticality"]

            reason_text = "; ".join(rule_reasons) if rule_reasons else "—"

            send_alert_webhook(
                tx_data,
                rules_triggered=[f"{t} ({reason_text})" for t in rule_titles],
                criticality=crit
            )
            
            try:
                alert_payload = {
                    "txid": tx_data.get("transaction_id"),
                    "amount": tx_data.get("amount"),
                    "sender": tx_data.get("sender_account"),
                    "receiver": tx_data.get("receiver_account"),
                    "criticality": crit,
                    "reason": reason_text,
                }
                r.xadd("tg_alert_queue", {"payload": json.dumps(alert_payload)}, maxlen=2000)
                logger.info(f"[TG enqueue] tx={tx_data.get('transaction_id')} ({crit})")
            except Exception as e:
                logger.warning(f"[TG enqueue error] {e}")
      
    return len(to_insert)


def main():
    last_claim = time.monotonic()
    total, t0 = 0, time.perf_counter()
    logger.warning({"event": "worker_loop_start"})

    try:
        while True:
            now_mono = time.monotonic()
            if now_mono - last_claim >= CLAIM_EVERY_SEC:
                try:
                    next_id, claimed_total = "0-0", 0
                    while True:
                        res = r.xautoclaim(STREAM, GROUP, CONSUMER, MIN_IDLE_MS, next_id, count=READ_COUNT)
                        if not res or not res[1]:
                            break
                        next_id = res[0]; claimed_total += len(res[1])
                    if claimed_total:
                        logger.info({"event":"xautoclaim_claimed","count":claimed_total})
                except redis.ResponseError as e:
                    if "unknown command" in str(e).lower():
                        logger.warning("xautoclaim not supported, consider Redis >= 6.2")
                    else:
                        logger.error({"event":"xautoclaim_error","error": str(e)})
                last_claim = now_mono

            batch = read_batch()
            if not batch:
                continue

            batch_cutoff = timezone.now()
            rules_snapshot = load_rules_snapshot(batch_cutoff)

            t_batch = time.perf_counter()
            n = process_batch(batch, rules_snapshot)
            dt = time.perf_counter() - t_batch
            tps = (n / dt) if dt > 0 else 0.0

            total += n
            logger.info({"event": "batch_done", "n": n, "dt_ms": round(dt*1000, 1), "tps": round(tps, 1), "total": total})

            if total and total % 10000 == 0:
                dt_total = time.perf_counter() - t0
                tps_total = total / dt_total if dt_total > 0 else 0.0
                logger.info({"event": "progress", "processed": total, "avg_tps": round(tps_total, 2)})

    except KeyboardInterrupt:
        dt_total = time.perf_counter() - t0
        tps_total = total / dt_total if dt_total > 0 else 0.0
        logger.warning({"event": "final_summary", "processed": total, "seconds": round(dt_total, 3), "avg_tps": round(tps_total, 2)})
        logger.warning({"event": "worker_stopped"})

if __name__ == "__main__":
    main()
