"""Security checks use a raw browser client so missing CSRF is really tested."""

import os
import secrets
import time
import unittest
from flask.testing import FlaskClient
from sqlalchemy import delete, select
import test_api as fixtures
from auth_helpers import PASSWORD


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "Use a dedicated _test database.")
class AuthenticationTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.RoomApiTests.setUpClass.__func__)
    setUp = fixtures.RoomApiTests.setUp
    chair = staticmethod(fixtures.RoomApiTests.chair)
    live_client = fixtures.RoomApiTests.live_client

    def raw_browser(self):
        return FlaskClient(self.app, use_cookies=True)

    def test_bootstrap_csrf_required_and_session_rotates_on_login(self):
        from backend.auth import SESSION_COOKIE

        client = self.raw_browser()
        self.assertIsNone(client.get("/api/auth/session").json["user"])
        before = client.get_cookie(SESSION_COOKIE).value
        payload = {"username": "test owner", "password": PASSWORD}
        self.assertEqual(client.post("/api/auth/login", json=payload).status_code, 403)
        token = client.get("/api/auth/session").json["csrfToken"]
        response = client.post("/api/auth/login", json=payload, headers={"X-CSRF-Token": token})
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(before, client.get_cookie(SESSION_COOKIE).value)
        self.assertNotEqual(token, response.json["csrfToken"])
        self.assertEqual(client.get("/api/auth/session").json["user"]["personalRoomId"], 2)
        self.assertEqual(client.put("/api/rooms/2", json={"items": []}).status_code, 403)
        self.assertEqual(
            client.put(
                "/api/rooms/2",
                json={"items": []},
                headers={
                    "X-CSRF-Token": response.json["csrfToken"],
                    "Origin": "https://evil.example",
                },
            ).status_code,
            403,
        )

    def test_unknown_and_wrong_password_have_identical_error_and_limit(self):
        wrong = {"username": "test owner", "password": "wrong password phrase"}
        unknown = {**wrong, "username": "missing"}
        first = self.client.post("/api/auth/login", json=wrong)
        second = self.client.post("/api/auth/login", json=unknown)
        self.assertEqual(first.status_code, 401)
        self.assertEqual(first.json, second.json)
        from backend.auth import attempts, ATTEMPT_WINDOW

        attempts["127.0.0.1"] = [time.time()] * 20
        self.assertEqual(self.client.post("/api/auth/login", json=wrong).status_code, 429)
        attempts["127.0.0.1"] = [time.time() - ATTEMPT_WINDOW - 1] * 20
        self.assertEqual(self.client.post("/api/auth/login", json=wrong).status_code, 401)

    def test_reserved_room_requires_one_time_invitation_and_preserves_data(self):
        from backend.auth import digest

        with self.SessionLocal.begin() as session:
            user = session.get(self.Visitor, "test owner")
            user.password_hash = None
            user.is_host = True
            from backend.models import SpaceMembership

            session.get(SpaceMembership, (1, user.id)).is_host = True
            code = secrets.token_urlsafe(32)
            user.activation_hash = digest(code)
            user.activation_expires_at = time.time() + 100
        newcomer = self.app.test_client()
        self.assertEqual(newcomer.register("test owner").status_code, 409)
        payload = {"username": "TEST OWNER", "password": PASSWORD, "activationCode": code}
        response = newcomer.post("/api/auth/register", json=payload)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["user"]["personalRoomId"], 2)
        self.assertTrue(response.json["user"]["isHost"])
        self.assertEqual(newcomer.get("/api/rooms/2").json["items"], [self.chair()])
        self.assertEqual(newcomer.post("/api/auth/register", json=payload).status_code, 409)
        with self.SessionLocal() as session:
            user = session.get(self.Visitor, "test owner")
            self.assertIsNone(user.activation_hash)
            self.assertTrue(user.password_hash.startswith("scrypt:"))
            self.assertNotIn(PASSWORD, user.password_hash)

    def test_expired_invitation_and_forged_legacy_cookie_fail(self):
        from backend.auth import digest

        with self.SessionLocal.begin() as session:
            user = session.get(self.Visitor, "test owner")
            user.password_hash = None
            user.activation_hash = digest("long enough activation token")
            user.activation_expires_at = time.time() - 1
        raw = self.raw_browser()
        raw.set_cookie("social_rooms_visitor", "test owner")
        self.assertEqual(raw.get("/api/rooms/1").status_code, 401)
        self.assertEqual(raw.get("/api/rooms/2").status_code, 401)
        response = self.app.test_client().post(
            "/api/auth/register",
            json={
                "username": "test owner",
                "password": PASSWORD,
                "activationCode": "long enough activation token",
            },
        )
        self.assertEqual(response.status_code, 409)

    def test_new_account_cannot_claim_host_role_or_overwrite_another_room(self):
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": "jose",
                "password": PASSWORD,
                "isHost": True,
                "roomId": 2,
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json["user"]["isHost"])
        self.assertNotEqual(response.json["user"]["personalRoomId"], 2)
        self.assertEqual(self.client.put("/api/rooms/2", json={"items": []}).status_code, 403)
        self.assertEqual(self.client.put("/api/rooms/1", json={"items": []}).status_code, 403)

    def test_logout_revokes_cookie_and_disconnects_all_seats_for_session(self):
        from backend.auth import SESSION_COOKIE

        first, second = self.live_client(), self.live_client(position=[2, 0, 1])
        first.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)
        stolen = self.raw_browser()
        stolen.set_cookie(SESSION_COOKIE, self.client.get_cookie(SESSION_COOKIE).value)
        result = self.client.post("/api/auth/logout", json={})
        self.assertIsNone(result.json["user"])
        self.assertFalse(first.is_connected())
        self.assertFalse(second.is_connected())
        self.assertEqual(stolen.get("/api/rooms/2").status_code, 401)
        self.assertEqual(self.client.get("/api/rooms/2").status_code, 401)
        self.client.login("test owner")
        next_player = self.live_client()
        self.assertTrue(
            next_player.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)[
                "ok"
            ]
        )

    def test_socket_requires_csrf_and_detects_external_revocation_or_expiry(self):
        from backend.models import AuthSession
        from backend.realtime import socketio

        auth = {"roomId": 1, "position": [1, 0, 1], "rotation": 0}
        unprotected = socketio.test_client(self.app, auth=auth, flask_test_client=self.client)
        self.assertFalse(unprotected.is_connected())
        player = self.live_client()
        with self.SessionLocal.begin() as session:
            session.execute(delete(AuthSession))
        self.assertFalse(
            player.emit("player_move", {"position": [2, 0, 1], "rotation": 0}, callback=True)["ok"]
        )
        self.assertFalse(player.is_connected())
        self.client.login("test owner")
        player = self.live_client()
        with self.SessionLocal.begin() as session:
            record = session.scalar(select(AuthSession).where(AuthSession.user_id == "test owner"))
            record.expires_at = time.time() - 1
        player.emit("voice_state", {"enabled": True, "muted": False}, callback=True)
        self.assertFalse(player.is_connected())
        self.assertEqual(self.client.get("/api/rooms/2").status_code, 401)

    def test_sessions_store_hash_only_and_cookie_has_secure_flags_on_https(self):
        from backend.models import AuthSession
        from backend.auth import SESSION_COOKIE, digest

        response = self.app.test_client().login("test owner", base_url="https://localhost")
        cookie = response.headers["Set-Cookie"]
        for flag in ("Secure", "HttpOnly", "SameSite=Lax"):
            self.assertIn(flag, cookie)
        token = self.client.get_cookie(SESSION_COOKIE).value
        with self.SessionLocal() as session:
            self.assertIsNotNone(session.get(AuthSession, digest(token)))
            self.assertIsNone(session.get(AuthSession, token))
