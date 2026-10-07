"""Throwaway MOCK Pi server for verifying the app's Real-mode code path.
Implements the GUESSED placeholder contract in src/api/piApiContract.ts.
NOT the real Pi API. Run: python3 tests/mock_pi_server.py <port> [mode]
mode: ok | missing | malformed | empty
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
MODE = sys.argv[2] if len(sys.argv) > 2 else "ok"


def reading(minutes_ago, ph=7.2, t=28.1, do=6.4):
    ts = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    return {"timestamp": ts, "ph": ph, "temperature_c": t, "dissolved_oxygen_mg_l": do}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body):
        raw = body if isinstance(body, str) else json.dumps(body)
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(raw.encode())

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/health":
            return self.send(200, {"status": "ok"})
        if p == "/readings/latest":
            if MODE == "malformed":
                return self.send(200, "<html>not json</html>")
            if MODE == "missing":
                return self.send(200, {"pond_name": "Test Pond 1", "reading": reading(1, ph=None, t=27.0, do=None)})
            if MODE == "empty":
                return self.send(200, {"pond_name": "Test Pond 1", "reading": None})
            return self.send(200, {"pond_name": "Test Pond 1", "reading": reading(1)})
        if p == "/readings":
            return self.send(200, {"readings": [] if MODE == "empty" else [reading(i * 5) for i in range(10)]})
        if p == "/alerts":
            if MODE == "empty":
                return self.send(200, {"alerts": []})
            return self.send(200, {"alerts": [{"id": "1", "timestamp": reading(30)["timestamp"], "parameter": "dissolved_oxygen",
                                               "value": 2.8, "threshold": "min 3.0 mg/L", "status": "critical", "message": "DO low"}]})
        if p == "/thresholds":
            if MODE == "empty":
                return self.send(404, {"error": "not found"})
            return self.send(200, {"approved": False,
                                   "ph": {"safe_min": 6.5, "safe_max": 8.5, "warn_min": 6.0, "warn_max": 9.0},
                                   "temperature": {"safe_min": 26, "safe_max": 30, "warn_min": 24, "warn_max": 32},
                                   "dissolved_oxygen": {"safe_min": 5, "safe_max": None, "warn_min": 3, "warn_max": None}})
        self.send(404, {"error": "not found"})


HTTPServer(("0.0.0.0", PORT), H).serve_forever()
