import os
import json
import hashlib
import logging
import redis


WEBHOOK_BASE_URL = os.getenv("NOTIFY_WEBHOOK_URL", "http://127.0.0.1:8001/api/alerts")
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://127.0.0.1:8001/transaction-details.html")
ALERTS_QUEUE = os.getenv("ALERTS_QUEUE", "alerts_queue")
DEDUP_TTL_SEC = int(os.getenv("WEBHOOK_DEDUP_TTL", "600"))
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=1, decode_responses=True)
logger = logging.getLogger("transactions.webhook")

ROUTES = {
    "low":      f"{WEBHOOK_BASE_URL}/low",
    "medium":   f"{WEBHOOK_BASE_URL}/medium",
    "high":     f"{WEBHOOK_BASE_URL}/high",
    "critical": f"{WEBHOOK_BASE_URL}/critical",
}


def _payload_hash(payload: dict) -> str:
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def send_alert_webhook(tx: dict, rules_triggered=None, criticality="medium"):
    if criticality not in ROUTES:
        criticality = "medium"

    correlation_id = tx.get("correlation_id") or "unknown"
    transaction_link = f"{FRONTEND_BASE_URL}?correlation_id={correlation_id}"

    ts = tx.get("timestamp")
    if ts is not None and hasattr(ts, "isoformat"):
        ts_value = ts.isoformat()
    elif isinstance(ts, str):
        ts_value = ts
    else:
        ts_value = None

    payload = {
        "transaction_id": tx.get("transaction_id"),
        "correlation_id": correlation_id,
        "sender_account": tx.get("sender_account"),
        "receiver_account": tx.get("receiver_account"),
        "amount": float(tx.get("amount") or 0.0),
        "timestamp": ts_value,
        "rules_triggered": rules_triggered or [],
        "ml_probability": None,
        "transaction_link": transaction_link,
        "criticality": criticality,
    }

    key_hash = _payload_hash(payload)
    dedup_key = f"alert:sent:{key_hash}"
    if r.exists(dedup_key):
        logger.info({"event": "alert_skipped_dedup", "tx": tx.get("transaction_id")})
        return

    try:
        r.lpush(ALERTS_QUEUE, json.dumps(payload))
        r.setex(dedup_key, DEDUP_TTL_SEC, "1")
        logger.info({
            "event": "alert_enqueued",
            "queue": ALERTS_QUEUE,
            "tx": payload["transaction_id"],
            "criticality": criticality
        })
    except Exception as e:
        logger.error({
            "event": "alert_enqueue_failed",
            "error": str(e)
        })
