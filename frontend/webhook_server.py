from http.server import BaseHTTPRequestHandler, HTTPServer
import json

notifications = []

class WebhookHandler(BaseHTTPRequestHandler):
    def _set_headers(self):
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path.startswith("/api/alerts"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                notifications.append(data)
                print("📩 Вебхук получен:", data)

                self.send_response(200)
                self._set_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(400)
                self._set_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self._set_headers()
            self.wfile.write(b'{"error":"not found"}')

    def do_GET(self):
        if self.path == "/api/notifications":
            self.send_response(200)
            self._set_headers()
            self.wfile.write(json.dumps(notifications[-50:], ensure_ascii=False).encode())
        else:
            self.send_response(404)
            self._set_headers()
            self.wfile.write(b'{"error":"not found"}')

def run():
    port = 8002
    HTTPServer(("0.0.0.0", port), WebhookHandler).serve_forever()

if __name__ == "__main__":
    run()
