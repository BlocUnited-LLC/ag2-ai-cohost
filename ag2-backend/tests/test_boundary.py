import unittest

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from realtime_over_webrtc.main import app


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, base_url="http://localhost:5050")
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def tokens(self):
        response = self.client.get("/api/bootstrap")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        return response.json()

    def test_bootstrap_rejects_untrusted_origin_host_and_cross_site(self):
        self.tokens()
        for headers in (
            {"origin": "https://attacker.example"},
            {"origin": "null"},
            {"host": "attacker.example"},
            {"sec-fetch-site": "cross-site"},
        ):
            self.assertEqual(self.client.get("/api/bootstrap", headers=headers).status_code, 403)

    def test_websocket_requires_origin_and_first_message_auth(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("ws://localhost:5050/session"):
                pass
        with self.client.websocket_connect("ws://localhost:5050/session", headers={"origin": "http://localhost:5050"}) as ws:
            ws.send_bytes(b"\x00\x00")
            error = ws.receive_json()
            self.assertEqual(error["code"], "auth_failed")
            with self.assertRaises(WebSocketDisconnect):
                ws.receive_json()

    def test_viewer_auth_cannot_start_provider(self):
        tokens = self.tokens()
        with self.client.websocket_connect("ws://localhost:5050/session", headers={"origin": "http://localhost:5050"}) as ws:
            ws.send_json({"type": "auth", "role": "viewer", "token": tokens["viewerToken"]})
            self.assertEqual(ws.receive_json()["type"], "authenticated")
            self.assertEqual(ws.receive_json()["status"], "idle")
            ws.send_json({"type": "start"})
            self.assertEqual(ws.receive_json()["code"], "unauthorized")
        self.assertIsNone(app.state.cohost.runner)

    def test_controller_conflict_returns_actionable_error(self):
        tokens = self.tokens()
        headers = {"origin": "http://localhost:5050"}
        with self.client.websocket_connect("ws://localhost:5050/session", headers=headers) as first:
            first.send_json({"type": "auth", "role": "controller", "token": tokens["controllerToken"]})
            first.receive_json()
            first.receive_json()
            with self.client.websocket_connect("ws://localhost:5050/session", headers=headers) as second:
                second.send_json({"type": "auth", "role": "controller", "token": tokens["controllerToken"]})
                self.assertEqual(second.receive_json()["code"], "controller_busy")
        self.assertIsNone(app.state.cohost.runner)


if __name__ == "__main__":
    unittest.main()
