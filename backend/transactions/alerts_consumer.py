import os
import sys
import json
import time
import django
import redis
import requests
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
ALERTS_DB = int(os.getenv("ALERTS_DB", "1"))
ALERTS_QUEUE = os.getenv("ALERTS_QUEUE", "alerts_queue")

WORKERS = int(os.getenv("WEBHOOK_WORKERS", "4"))
BRPOP_TIMEOUT = int(os.getenv("ALERTS_BRPOP_TIMEOUT", "5"))
MAX_INFLIGHT = WORKERS * 4

WEBHOOK_BASE_URL = os.getenv("WEBHOOK_BASE_URL", "http://webhook-server:8002",)

sys.path.insert(0, PROJECT_ROOT)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

try:
    django.setup()
except Exception as e:
    print(f"[alerts_consumer] Django init failed: {e}", flush=True)
    raise

logger = logging.getLogger("alerts_consumer")
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False


def _wait_some(futures):
    done = set()
    for fut in list(futures):
        if fut.done():
            done.add(fut)
            futures.remove(fut)
    if not done:
        time.sleep(0.05)
    return done, futures


def main():
    logger.info({
        "event": "consumer_starting",
        "queue": ALERTS_QUEUE,
        "redis": f"{REDIS_HOST}:{REDIS_PORT}",
        "workers": WORKERS
    })
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=int(os.getenv("ALERTS_DB", "1")), decode_responses=True)
    try:
        r.ping()
        logger.info({"event": "redis_connect_ok"})
    except Exception as e:
        logger.error({"event": "redis_connect_fail", "error": str(e)})
        sys.exit(1)
    executor = ThreadPoolExecutor(max_workers=WORKERS)
    futures = set()
    last_idle_log = 0.0

    try:
        while True:
            if len(futures) >= MAX_INFLIGHT:
                done, futures = _wait_some(futures)
                for fut in done:
                    ok, err = fut.result()
                    if not ok:
                        logger.warning({"event": "webhook_task_failed", "error": err})
            res = r.brpop(ALERTS_QUEUE, timeout=BRPOP_TIMEOUT)
            if not res:
                now = time.time()
                if now - last_idle_log > 10:
                    logger.info({"event": "idle", "note": "no tasks yet"})
                    last_idle_log = now
                continue
            _queue, payload = res
            try:
                task = json.loads(payload)
            except Exception as e:
                logger.warning({"event": "bad_task_json", "error": str(e)})
                continue
            futures.add(executor.submit(_send_one, task))
    except KeyboardInterrupt:
        logger.info({"event": "consumer_stopping"})
    finally:
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception:
                pass
        executor.shutdown(wait=True)
        logger.info({"event": "consumer_stopped"})

def _send_one(task: dict):
    try:
        logger.info(f"Processing alert task: {task}")
        webhook_url = f"{WEBHOOK_BASE_URL}/api/alerts/{task.get('criticality', 'medium')}"
        response = requests.post(
            webhook_url,
            json=task,
            headers={"Content-Type": "application/json"},
            timeout=5
        )
        if response.status_code == 200:
            logger.info(f"Alert sent successfully to webhook: {task.get('transaction_id')}")
            return True, None
        else:
            logger.error(f"Webhook failed with status {response.status_code}: {response.text}")
            return False, f"HTTP {response.status_code}"
    except Exception as e:
        logger.error(f"Error in _send_one: {e}")
        return False, str(e)


if __name__ == "__main__":
    main()
