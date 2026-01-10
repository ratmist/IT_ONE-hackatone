import redis, os, json, logging
from transactions.ml_engine import MLEngine

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
QUEUE = "ml_eval_queue"
GROUP = "ml_group"
CONSUMER = f"ml-worker-{os.getpid()}"

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
engine = MLEngine.get_instance()

try:
    r.xgroup_create(QUEUE, GROUP, mkstream=True)
except redis.ResponseError as e:
    if "BUSYGROUP" not in str(e):
        raise

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml_worker")
logger.info(f"ML-воркер запущен: очередь={QUEUE}, группа={GROUP}")

while True:
    msgs = r.xreadgroup(GROUP, CONSUMER, {QUEUE: ">"}, count=10, block=5000)
    if not msgs:
        continue
    _, batch = msgs[0]
    for msg_id, data in batch:
        try:
            payload = json.loads(data["payload"])
            model = payload["model"]
            tx = payload["data"]
            txid = payload["transaction_id"]

            classifier = engine.load_model(model)
            text = engine.preprocess_transaction(payload["template"], tx)
            preds = classifier([text], truncation=True, max_length=512)
            prob = float(preds[0]["score"])

            r.setex(f"ml:{txid}", 600, prob)
            logger.info(f"ML RULE tx={txid}, prob={prob:.4f}")

        except Exception as e:
            logger.warning(f"Ошибка ML-инференса: {e}")
        finally:
            r.xack(QUEUE, GROUP, msg_id)
