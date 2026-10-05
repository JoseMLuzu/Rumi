"""Membership, invitations and isolation against real PostgreSQL and Socket.IO."""

import os
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import func, select
import test_api as fixtures
from auth_helpers import connect


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "Use a dedicated _test database.")
class SpaceTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.RoomApiTests.setUpClass.__func__)
    chair = staticmethod(fixtures.RoomApiTests.chair)
    event = staticmethod(fixtures.RoomApiTests.event)

    def setUp(self):
        fixtures.RoomApiTests.setUp(self)
        self.app.config["AUTO_JOIN_GCI"] = False
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        from backend import media

        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        uploads = patch.object(media, "UPLOAD_DIR", Path(self.temp.name))
        uploads.start()
        self.addCleanup(uploads.stop)

    def create(self, name="Friends"):
        response = self.client.post("/api/spaces", json={"name": name})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def invite(self, space):
        response = self.client.post(f'/api/spaces/{space["id"]}/invitation', json={})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json["token"]

    def newcomer(self, name="New friend"):
        client = self.app.test_client()
        response = client.register(name)
        self.assertEqual(response.status_code, 201, response.json)
        return client

    def socket(self, client, room_id):
        from backend.realtime import socketio

        player = connect(
            socketio,
            self.app,
            flask_test_client=client,
            auth={"roomId": room_id, "position": [1, 0, 1], "rotation": 0},
        )
        self.addCleanup(lambda: player.disconnect() if player.is_connected() else None)
        return player

    def test_existing_gci_access_and_new_account_starts_without_spaces(self):
        original = self.client.get("/api/spaces").json["spaces"]
        self.assertEqual(
            [(s["id"], s["name"], s["personalRoomId"]) for s in original], [(1, "gci", 2)]
        )
        newcomer = self.newcomer()
        profile = newcomer.get("/api/auth/session").json["user"]
        self.assertIsNone(profile["personalRoomId"])
        self.assertIsNone(profile["centralRoomId"])
        self.assertEqual(newcomer.get("/api/spaces").json["spaces"], [])
        self.assertEqual(newcomer.get("/api/rooms/1").status_code, 403)
        self.assertEqual(newcomer.get("/api/rooms/2").status_code, 403)
        self.assertFalse(self.socket(newcomer, 1).is_connected())
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])
        with self.SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(self.Room)), 2)

    def test_creation_builds_separate_house_and_scoped_directory(self):
        space = self.create("  Friday  friends  ")
        self.assertEqual(space["name"], "Friday friends")
        self.assertTrue(space["isHost"])
        self.assertTrue(space["isOwner"])
        self.assertEqual(space["memberCount"], 1)
        central = self.client.get(f'/api/rooms/{space["centralRoomId"]}').json
        bedroom = self.client.get(f'/api/rooms/{space["personalRoomId"]}').json
        self.assertTrue(central["isCentral"])
        self.assertNotEqual(central["id"], 1)
        self.assertFalse(central["readOnly"])
        self.assertEqual([door["roomId"] for door in central["hall"]["doors"]], [bedroom["id"]])
        self.assertEqual(len(central["items"]), 15)
        self.assertEqual(len(bedroom["items"]), 6)
        self.assertEqual(
            self.client.put(
                f'/api/rooms/{central["id"]}',
                json={"items": [], "layoutVersion": central["layoutVersion"]},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get("/api/rooms/1").json["items"], [self.chair(id="central-chair")]
        )
        directory = self.client.get(f'/api/rooms?spaceId={space["id"]}').json["rooms"]
        self.assertEqual({r["id"] for r in directory}, {central["id"], bedroom["id"]})
        self.assertEqual(
            {r["id"] for r in self.client.get("/api/rooms?spaceId=1").json["rooms"]}, {1, 2}
        )

    def test_invitation_join_is_idempotent_and_keeps_other_spaces_private(self):
        first, second = self.create("First"), self.create("Second")
        token = self.invite(first)
        friend = self.newcomer()
        self.assertEqual(
            friend.post("/api/spaces/invitations/preview", json={"token": token}).json["name"],
            "First",
        )
        joined = friend.post("/api/spaces/join", json={"token": token})
        self.assertEqual(joined.status_code, 201)
        self.assertFalse(joined.json["isHost"])
        again = friend.post("/api/spaces/join", json={"token": token})
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json["personalRoomId"], joined.json["personalRoomId"])
        self.assertEqual(again.json["memberCount"], 2)
        self.assertEqual(friend.get(f'/api/rooms/{first["centralRoomId"]}').status_code, 200)
        self.assertTrue(friend.get(f'/api/rooms/{first["personalRoomId"]}').json["readOnly"])
        self.assertEqual(
            friend.put(f'/api/rooms/{first["personalRoomId"]}', json={"items": []}).status_code, 403
        )
        self.assertEqual(friend.get(f'/api/rooms/{second["centralRoomId"]}').status_code, 403)
        self.assertEqual(friend.get(f'/api/rooms?spaceId={second["id"]}').status_code, 403)
        self.assertEqual([s["id"] for s in friend.get("/api/spaces").json["spaces"]], [first["id"]])
        self.assertEqual(
            friend.post(f'/api/spaces/{first["id"]}/invitation', json={}).status_code, 403
        )
        self.assertEqual(friend.delete(f'/api/spaces/{first["id"]}/invitation').status_code, 403)
        self.assertFalse(self.socket(friend, second["centralRoomId"]).is_connected())

    def test_invitation_rotation_revocation_and_expiry_do_not_remove_members(self):
        from backend.models import Space

        space = self.create()
        first = self.invite(space)
        friend = self.newcomer()
        friend.post("/api/spaces/join", json={"token": first})
        second = self.invite(space)
        self.assertEqual(friend.post("/api/spaces/join", json={"token": first}).status_code, 404)
        self.assertEqual(friend.post("/api/spaces/join", json={"token": second}).status_code, 200)
        self.client.delete(f'/api/spaces/{space["id"]}/invitation')
        self.assertEqual(
            friend.post("/api/spaces/invitations/preview", json={"token": second}).status_code, 404
        )
        self.assertEqual(friend.get(f'/api/rooms/{space["centralRoomId"]}').status_code, 200)
        third = self.invite(space)
        with self.SessionLocal.begin() as session:
            session.get(Space, space["id"]).invitation_expires_at = time.time() - 1
        self.assertEqual(friend.post("/api/spaces/join", json={"token": third}).status_code, 404)

    def test_two_browsers_accepting_together_create_only_one_bedroom(self):
        from backend.models import SpaceMembership

        space = self.create()
        token = self.invite(space)
        first = self.newcomer("Racing friend")
        second = self.app.test_client()
        self.assertEqual(second.login("Racing friend").status_code, 200)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(
                    lambda client: client.post("/api/spaces/join", json={"token": token}),
                    [first, second],
                )
            )
        self.assertEqual(sorted(r.status_code for r in results), [200, 201])
        self.assertEqual(results[0].json["personalRoomId"], results[1].json["personalRoomId"])
        with self.SessionLocal() as session:
            self.assertEqual(
                session.scalar(
                    select(func.count())
                    .select_from(SpaceMembership)
                    .where(SpaceMembership.space_id == space["id"])
                ),
                2,
            )
            self.assertEqual(
                session.scalar(
                    select(func.count())
                    .select_from(self.Room)
                    .where(self.Room.space_id == space["id"])
                ),
                3,
            )

    def test_projectors_presence_voice_and_bounds_are_isolated(self):
        from backend.models import SpaceMembership
        from backend import screens
        from backend.realtime import hall_limits

        first, second = self.create("First"), self.create("Second")
        token = self.invite(first)
        for index in range(4):
            extra = self.newcomer(f"Bounds {index}")
            self.assertEqual(extra.post("/api/spaces/join", json={"token": token}).status_code, 201)
        a = self.socket(self.client, first["centralRoomId"])
        b = self.socket(self.client, second["centralRoomId"])
        aid = self.event(a, "room_state")["players"][0]["id"]
        bid = self.event(b, "room_state")["players"][0]["id"]
        a.get_received()
        b.get_received()
        share_a = a.emit("screen_start", callback=True)["share"]
        self.assertEqual(b.get_received(), [])
        share_b = b.emit("screen_start", callback=True)["share"]
        self.assertNotEqual(share_a["sessionId"], share_b["sessionId"])
        self.assertEqual(screens.screen_snapshot(first["centralRoomId"])["share"], share_a)
        self.assertEqual(screens.screen_snapshot(second["centralRoomId"])["share"], share_b)
        for player in (a, b):
            player.emit("voice_state", {"enabled": True, "muted": False}, callback=True)
            player.get_received()
        self.assertFalse(
            a.emit(
                "voice_signal",
                {"to": bid, "description": {"type": "offer", "sdp": "audio"}},
                callback=True,
            )["ok"]
        )
        self.assertFalse(
            b.emit(
                "screen_watch", {"sessionId": share_a["sessionId"], "watching": True}, callback=True
            )["ok"]
        )
        self.assertFalse(
            a.emit(
                "screen_signal",
                {
                    "to": bid,
                    "sessionId": share_a["sessionId"],
                    "description": {"type": "offer", "sdp": "video"},
                },
                callback=True,
            )["ok"]
        )
        a.emit("player_move", {"position": [1.5, 0, 1], "rotation": 0}, callback=True)
        self.assertEqual(b.get_received(), [])
        self.assertIsNot(hall_limits[first["centralRoomId"]], hall_limits[second["centralRoomId"]])
        self.assertTrue(
            a.emit("player_move", {"position": [15, 0, 0], "rotation": 0}, callback=True)["ok"]
        )
        self.assertFalse(
            b.emit("player_move", {"position": [15, 0, 0], "rotation": 0}, callback=True)["ok"]
        )

        a.disconnect()
        self.assertIsNone(screens.screen_snapshot(first["centralRoomId"])["share"])
        self.assertEqual(screens.screen_snapshot(second["centralRoomId"])["share"], share_b)

    def test_nonmember_cannot_fetch_media_even_when_bedroom_is_open(self):
        import io
        from PIL import Image

        space = self.create()
        photo = io.BytesIO()
        Image.new("RGB", (10, 10)).save(photo, format="PNG")
        photo.seek(0)
        response = self.client.post(
            f'/api/rooms/{space["personalRoomId"]}/media', data={"file": (photo, "photo.png")}
        )
        self.assertEqual(response.status_code, 201, response.json)
        friend = self.newcomer()
        self.assertEqual(friend.get(response.json["url"]).status_code, 403)
        with self.client.get(response.json["url"]) as image_response:
            self.assertEqual(image_response.status_code, 200)

    def test_names_bad_invitations_and_guest_permissions_are_validated(self):
        for name in ("", " " * 3, "x" * 49, 5):
            self.assertEqual(self.client.post("/api/spaces", json={"name": name}).status_code, 400)
        for token in (None, "bad", "z" * 129, [], "x" * 32):
            self.assertEqual(
                self.client.post("/api/spaces/join", json={"token": token}).status_code, 404
            )
        self.assertEqual(self.app.test_client().get("/api/spaces").status_code, 401)
        self.assertEqual(self.client.post("/api/spaces/9999/invitation", json={}).status_code, 403)

    def test_migration_adds_reserved_users_without_changing_their_rooms(self):
        from backend.models import SpaceMembership
        from backend.migrate_spaces import migrate
        from unittest.mock import patch

        with self.SessionLocal.begin() as session:
            room = self.Room(name="Reserved’s bedroom")
            session.add(room)
            session.flush()
            room_id = room.id
            session.add(
                self.Visitor(id="reserved", room_id=room.id, password_hash=None, is_host=True)
            )
            session.add(self.PlacedFurniture.from_record(room.id, self.chair(id="reserved-chair")))
        with patch("builtins.print"):
            migrate(self.temp.name)
            migrate(self.temp.name)
        with self.SessionLocal() as session:
            member = session.get(SpaceMembership, (1, "reserved"))
            self.assertEqual(member.room_id, room_id)
            self.assertTrue(member.is_host)
            self.assertIsNone(session.get(self.Visitor, "reserved").password_hash)
            self.assertEqual(
                session.get(self.Room, room_id).to_dict()["items"],
                [self.chair(id="reserved-chair")],
            )
