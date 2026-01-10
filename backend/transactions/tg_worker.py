import os, json, redis, requests, logging

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
QUEUE = "tg_alert_queue"
GROUP = "tg_group"
CONSUMER = f"tg-worker-{os.getpid()}"
BOT_ENDPOINT = os.getenv("TG_ALERT_ENDPOINT", "http://localhost:8082/alert")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("tg_worker")

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


try:
    r.xgroup_create(QUEUE, GROUP, mkstream=True)
except redis.ResponseError as e:
    if "BUSYGROUP" not in str(e):
        raise

logger.info(f"Telegram-воркер запущен: очередь={QUEUE}, группа={GROUP}")


while True:
    msgs = r.xreadgroup(GROUP, CONSUMER, {QUEUE: ">"}, count=10, block=5000)
    if not msgs:
        continue

    _, batch = msgs[0]
    for msg_id, data in batch:
        try:
            payload = json.loads(data["payload"])
            txid = payload.get("txid")

            message = (
                f"🚨 Подозрительная транзакция\n\n"
                f"ID: {txid}\n"
                f"Сумма: {payload.get('amount')} ₽\n"
                f"От: {payload.get('sender')}\n"
                f"Кому: {payload.get('receiver')}\n"
                f"Критичность: {payload.get('criticality')}\n"
                f"Причина: {payload.get('reason')}"
            )

            requests.post(
                BOT_ENDPOINT,
                json={"message": message, "transaction_id": txid},
                timeout=3,
            )
            logger.info(f"✅ Telegram alert sent for {txid}")
        except Exception as e:
            logger.warning(f"Ошибка Telegram alert: {e}")
        finally:
            r.xack(QUEUE, GROUP, msg_id)
