from auth_helpers import AccountClient, PASSWORD_HASH, connect

"""Exercise living-room saves with real PostgreSQL and shared player connections."""

import os
import unittest
from unittest.mock import patch

import test_api as fixtures


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "Use a dedicated _test database.")
class LivingRoomTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.RoomApiTests.setUpClass.__func__)
    chair = staticmethod(fixtures.RoomApiTests.chair)
    live_client = fixtures.RoomApiTests.live_client
    event = staticmethod(fixtures.RoomApiTests.event)

    def setUp(self):
        fixtures.RoomApiTests.setUp(self)
        with self.SessionLocal.begin() as session:
            session.get(self.Visitor, "test owner").is_host = True
            from backend.models import SpaceMembership

            session.get(SpaceMembership, (1, "test owner")).is_host = True

    def save(self, items, version=None):
        version = version or self.client.get("/api/rooms/1").json["layoutVersion"]
        return self.client.put("/api/rooms/1", json={"items": items, "layoutVersion": version})

    def test_only_named_host_can_edit_and_global_read_only_still_wins(self):
        self.assertFalse(self.client.get("/api/rooms/1").json["readOnly"])
        other = self.app.test_client()
        other.register("Visitor")
        self.assertTrue(other.get("/api/rooms/1").json["readOnly"])
        self.assertEqual(other.put("/api/rooms/1", json={"items": []}).status_code, 403)
        self.assertEqual(
            self.app.test_client().put("/api/rooms/1", json={"items": []}).status_code, 401
        )
        with patch.dict(self.app.config, {"ROOM_READ_ONLY": True}):
            self.assertTrue(self.client.get("/api/rooms/1").json["readOnly"])
            self.assertEqual(self.save([]).status_code, 403)
        # The living room stays open and keeps its existing shared shell style.
        self.assertEqual(
            self.client.patch("/api/rooms/1/access", json={"isOpen": False}).status_code, 403
        )
        self.assertEqual(self.client.patch("/api/rooms/1/appearance", json={}).status_code, 403)

    def test_add_move_rotate_scale_delete_and_notify_visitors(self):
        observer = self.live_client()
        observer.get_received()
        book = {"id": "book", "type": "bookTable", "position": [0, 0, 3.25], "rotation": 0}
        response = self.save([book])
        self.assertEqual(response.status_code, 200, response.json)
        self.assertIn("hall", response.json)
        self.assertEqual(self.event(observer, "room_layout_changed"), {"roomId": 1})
        moved = {**book, "position": [-2, 0, 3], "rotation": 1.5707963267948966, "scale": 0.8}
        self.assertEqual(self.save([moved]).status_code, 200)
        self.assertEqual(self.client.get("/api/rooms/1").json["items"], [moved])
        self.assertEqual(self.save([]).status_code, 200)
        self.assertEqual(self.client.get("/api/rooms/1").json["items"], [])
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])

    def test_stale_or_missing_version_cannot_overwrite_newer_layout(self):
        old = self.client.get("/api/rooms/1").json["layoutVersion"]
        self.assertEqual(self.save([], old).status_code, 200)
        self.assertEqual(self.save([self.chair(id="new")], old).status_code, 409)
        self.assertEqual(self.client.put("/api/rooms/1", json={"items": []}).status_code, 409)
        self.assertEqual(self.client.get("/api/rooms/1").json["items"], [])

    def test_hallway_entrances_stay_clear(self):
        for x in (-4.3, 4.3):
            response = self.save([self.chair(position=[x, 0, 0])])
            self.assertEqual(response.status_code, 400)
            self.assertIn("hallway entrances", response.json["error"])

    def test_occupied_seat_cannot_be_removed_or_moved_but_unchanged_save_works(self):
        seated = self.live_client()
        self.assertTrue(
            seated.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)["ok"]
        )
        original = self.chair(id="central-chair")
        self.assertEqual(self.save([original]).status_code, 200)
        for items in ([], [{**original, "position": [2, 0, 2]}], [{**original, "scale": 1.5}]):
            self.assertEqual(self.save(items).status_code, 409)
        self.assertTrue(seated.emit("player_stand", callback=True)["ok"])
        self.assertEqual(self.save([]).status_code, 200)

    def test_projector_removal_ends_share_and_releases_viewers(self):
        table = {"id": "table", "type": "table", "position": [0, 0, -0.4], "rotation": 0}
        self.assertEqual(self.save([table]).status_code, 200)
        presenter, viewer = self.live_client(), self.live_client()
        share = presenter.emit("screen_start", callback=True)["share"]
        self.assertTrue(
            viewer.emit(
                "screen_watch", {"sessionId": share["sessionId"], "watching": True}, callback=True
            )["ok"]
        )
        viewer.get_received()
        self.assertEqual(self.save([table]).status_code, 200)
        from backend import screens

        self.assertIsNotNone(screens.screen_snapshot()["share"])
        self.assertEqual(self.save([]).status_code, 200)
        self.assertEqual(self.event(viewer, "screen_state"), {"share": None, "preview": None})
        self.assertEqual(screens.projectors.get(1, {}).get("viewers", set()), set())
        self.assertFalse(presenter.emit("screen_start", callback=True)["ok"])
