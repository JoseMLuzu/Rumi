from auth_helpers import AccountClient, PASSWORD_HASH, connect

"""Real PostgreSQL + Socket.IO object tests; never touch development rooms."""

import io
import math
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
import test_api as api_fixtures


@unittest.skipUnless(
    os.environ.get("TEST_DATABASE_URL"), "Use a dedicated _test PostgreSQL database."
)
class InteractiveObjectTests(unittest.TestCase):
    setUpClass = classmethod(api_fixtures.RoomApiTests.setUpClass.__func__)
    chair = staticmethod(api_fixtures.RoomApiTests.chair)

    def setUp(self):
        api_fixtures.RoomApiTests.setUp(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        from backend import media

        self.media_patch = patch.object(media, "UPLOAD_DIR", Path(self.temp.name))
        self.media_patch.start()
        self.addCleanup(self.media_patch.stop)
        from backend.database import SessionLocal
        from backend.models import MediaAsset
        from sqlalchemy import delete

        with SessionLocal.begin() as session:
            session.execute(delete(MediaAsset))

    def item(self, kind, item_id="object", position=None, **extra):
        from backend.database import SessionLocal
        from backend.models import PlacedFurniture
        from backend.validation import OBJECTS

        record = {
            "id": item_id,
            "type": kind,
            "position": position or [0, 0, 0],
            "rotation": 0,
            "config": OBJECTS[kind]["defaults"],
            **extra,
        }
        with SessionLocal.begin() as session:
            old = session.get(PlacedFurniture, item_id)
            if old:
                session.delete(old)
                session.flush()
            session.add(PlacedFurniture.from_record(2, record))
        return record

    def socket(self, client=None, position=None):
        from backend.realtime import socketio

        connection = connect(
            socketio,
            self.app,
            flask_test_client=client or self.client,
            auth={"roomId": 2, "position": position or [1.3, 0, 0], "rotation": 0},
        )
        self.addCleanup(lambda: connection.disconnect() if connection.is_connected() else None)
        connection.get_received()
        return connection

    def test_chaise_layout_restore_and_exclusive_scaled_seat(self):
        record = {
            "id": "chaise",
            "type": "chaiseLongue",
            "position": [1, 0, 0],
            "rotation": math.pi / 2,
            "scale": 1.5,
        }
        saved = self.client.put("/api/rooms/2", json={"items": [record]})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [record])
        first = self.socket(position=[2.5, 0, 0.2])
        second = self.socket(position=[2.6, 0, 0.3])
        result = first.emit("player_sit", {"itemId": "chaise", "slot": 0}, callback=True)
        self.assertTrue(result["ok"])
        self.assertAlmostEqual(result["player"]["position"][0], 1.24)
        self.assertAlmostEqual(result["player"]["position"][2], 0)
        self.assertAlmostEqual(result["player"]["seatHeight"], 0.63)
        self.assertFalse(
            second.emit("player_sit", {"itemId": "chaise", "slot": 0}, callback=True)["ok"]
        )
        first.disconnect()
        self.assertTrue(
            second.emit("player_sit", {"itemId": "chaise", "slot": 0}, callback=True)["ok"]
        )
        self.assertFalse(
            second.emit("player_sit", {"itemId": "chaise", "slot": 1}, callback=True)["ok"]
        )
        self.assertTrue(second.emit("player_stand", callback=True)["ok"])

    @staticmethod
    def image(alpha=True):
        image = Image.new(
            "RGBA" if alpha else "RGB", (2800, 1000), (10, 80, 110, 90) if alpha else (10, 80, 110)
        )
        stream = io.BytesIO()
        image.save(stream, "PNG")
        stream.seek(0)
        return stream

    def upload(self, file=None, purpose="image", client=None):
        response = (client or self.client).post(
            "/api/rooms/2/media",
            data={"purpose": purpose, "file": (file or self.image(), "photo.png")},
            content_type="multipart/form-data",
        )
        response.request.environ["wsgi.input"].close()
        return response

    def test_room_style_image_restore_shared_update_and_furniture_independence(self):
        from backend.appearance import default_appearance

        initial = self.client.get("/api/rooms/2").json
        self.assertEqual(initial["appearance"], default_appearance())
        self.assertEqual(initial["appearanceRevision"], 0)
        asset = self.upload()
        appearance = default_appearance()
        appearance["floor"].update(image=asset.json["url"], fit="tile", repeat=3)
        appearance["walls"].update(preset="rose", color="#dfbbb6")
        appearance["background"].update(image=asset.json["url"], fit="contain")
        guest = self.app.test_client()
        guest.register("Style visitor")
        observer = self.socket(guest)
        saved = self.client.patch(
            "/api/rooms/2/appearance", json={"appearance": appearance, "revision": 0}
        )
        self.assertEqual(saved.status_code, 200)
        notification = next(
            p["args"][0] for p in observer.get_received() if p["name"] == "room_appearance"
        )
        self.assertEqual(notification, saved.json)
        loaded = guest.get("/api/rooms/2").json
        self.assertEqual(loaded["appearance"], appearance)
        self.assertEqual(loaded["appearanceRevision"], 1)
        response = guest.get(asset.json["url"])
        self.assertEqual(response.status_code, 200)
        response.close()
        # A layout save from an older page has no authority to overwrite the separate style record.
        layout = self.client.put(
            "/api/rooms/2",
            json={"items": [self.chair(position=[2, 0, 0])], "appearance": default_appearance()},
        )
        self.assertEqual(layout.status_code, 200)
        self.assertEqual(layout.json["appearance"], appearance)
        self.assertEqual(layout.json["appearanceRevision"], 1)
        from backend.realtime import socketio

        newcomer = connect(
            socketio,
            self.app,
            flask_test_client=guest,
            auth={"roomId": 2, "position": [0, 0, 1], "rotation": 0},
        )
        self.addCleanup(lambda: newcomer.disconnect() if newcomer.is_connected() else None)
        snapshot = next(
            p["args"][0] for p in newcomer.get_received() if p["name"] == "room_appearance"
        )
        self.assertEqual(snapshot, saved.json)

    def test_room_style_owner_permissions_and_revision_conflict(self):
        from backend.appearance import default_appearance

        payload = {"appearance": default_appearance(), "revision": 0}
        other = self.app.test_client()
        other.register("Style guest")
        self.assertEqual(other.patch("/api/rooms/2/appearance", json=payload).status_code, 403)
        self.assertEqual(
            self.app.test_client().patch("/api/rooms/2/appearance", json=payload).status_code, 401
        )
        self.assertEqual(
            self.client.patch("/api/rooms/1/appearance", json=payload).status_code, 403
        )
        with patch.dict(self.app.config, {"ROOM_READ_ONLY": True}):
            self.assertEqual(
                self.client.patch("/api/rooms/2/appearance", json=payload).status_code, 403
            )
        self.assertEqual(
            self.client.patch("/api/rooms/2/appearance", json=payload).status_code, 200
        )
        payload["appearance"]["background"]["color"] = "#112233"
        self.assertEqual(
            self.client.patch("/api/rooms/2/appearance", json=payload).status_code, 409
        )
        self.assertEqual(self.client.get("/api/rooms/2").json["appearance"], default_appearance())
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])

    def test_room_style_rejects_invalid_config_and_foreign_media(self):
        from backend.appearance import default_appearance

        for surface, key, value in [
            ("floor", "preset", "unknown"),
            ("floor", "repeat", True),
            ("walls", "repeat", 9),
            ("walls", "color", "red"),
            ("floor", "crop", [True, 0.5]),
            ("background", "fit", "tile"),
            ("floor", "image", "data:image/png;base64,abc"),
            ("walls", "image", "/api/media/" + "a" * 32),
        ]:
            with self.subTest(surface=surface, key=key):
                appearance = default_appearance()
                appearance[surface][key] = value
                response = self.client.patch(
                    "/api/rooms/2/appearance", json={"appearance": appearance, "revision": 0}
                )
                self.assertEqual(response.status_code, 400)
        other = self.app.test_client()
        room_id = other.register("Foreign style").json["user"]["personalRoomId"]
        asset = other.post(
            f"/api/rooms/{room_id}/media",
            data={"file": (self.image(), "x.png")},
            content_type="multipart/form-data",
        )
        asset.request.environ["wsgi.input"].close()
        appearance = default_appearance()
        appearance["walls"]["image"] = asset.json["url"]
        self.assertEqual(
            self.client.patch(
                "/api/rooms/2/appearance", json={"appearance": appearance, "revision": 0}
            ).status_code,
            400,
        )
        self.assertEqual(self.client.get("/api/rooms/2").json["appearanceRevision"], 0)

    def test_image_upload_optimized_alpha_restore_permissions_and_live_update(self):
        self.client.put("/api/rooms/2", json={"items": []})
        self.item("poster")
        asset = self.upload()
        self.assertEqual(asset.status_code, 201)
        downloaded = self.client.get(asset.json["url"])
        self.assertEqual(downloaded.status_code, 200)
        with Image.open(io.BytesIO(downloaded.data)) as image:
            self.assertLessEqual(max(image.size), 2048)
            self.assertEqual(image.mode, "RGBA")
        downloaded.close()
        guest = self.app.test_client()
        guest.register("Object guest")
        observer = self.socket(guest)
        config = {
            "images": [asset.json["url"]],
            "fit": "cover",
            "crop": [0.2, 0.7],
            "frameColor": "#123456",
        }
        response = self.client.patch(
            "/api/rooms/2/objects/object", json={"revision": 0, "config": config}
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(p["name"] == "object_update" for p in observer.get_received()))
        restored = guest.get("/api/rooms/2").json["items"][0]
        self.assertEqual(restored["config"], config)
        self.assertEqual(
            guest.patch(
                "/api/rooms/2/objects/object", json={"revision": 1, "config": config}
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.patch(
                "/api/rooms/2/objects/object", json={"revision": 0, "config": config}
            ).status_code,
            409,
        )
        self.assertEqual(self.upload(io.BytesIO(b"broken photo")).status_code, 400)
        self.assertEqual(self.upload(io.BytesIO(b"x" * (10 * 1024 * 1024 + 1))).status_code, 413)
        self.assertEqual(
            guest.post("/api/rooms/2/media", data={"file": (self.image(), "x.png")}).status_code,
            403,
        )
        bad = {**config, "images": ["data:image/png;base64,abc"]}
        self.assertEqual(
            self.client.patch(
                "/api/rooms/2/objects/object", json={"revision": 1, "config": bad}
            ).status_code,
            400,
        )

    def test_exclusive_new_seats_scaled_height_pose_crown_and_disconnect_release(self):
        self.item("plasticThrone", scale=1.5, config={"pose": "wave"})
        a, b = self.socket(), self.socket()
        first = a.emit("player_sit", {"itemId": "object", "slot": 0}, callback=True)
        self.assertTrue(first["ok"])
        self.assertTrue(first["player"]["crown"])
        self.assertEqual(first["player"]["seatPose"], "wave")
        self.assertAlmostEqual(first["player"]["seatHeight"], 0.675)
        self.assertFalse(b.emit("player_sit", {"itemId": "object", "slot": 0}, callback=True)["ok"])
        a.disconnect()
        self.assertTrue(b.emit("player_sit", {"itemId": "object", "slot": 0}, callback=True)["ok"])
        self.assertTrue(b.emit("player_stand", {}, callback=True)["ok"])
        self.item("handChair")
        self.assertTrue(b.emit("player_sit", {"itemId": "object", "slot": 0}, callback=True)["ok"])

    def test_board_concurrency_layers_delete_and_layout_save_preserves_posts(self):
        self.client.put("/api/rooms/2", json={"items": []})
        self.item("visitorBoard")
        a, b = self.socket(), self.socket()
        asset = self.upload(purpose="drawing").json
        data = {
            "itemId": "object",
            "action": "draw",
            "revision": 0,
            "url": asset["url"],
            "text": "Hola",
        }
        one = a.emit("object_action", data, callback=True)
        self.assertTrue(one["ok"])
        two = b.emit("object_action", data, callback=True)
        self.assertFalse(two["ok"])
        self.assertIn("Otra persona", two["error"])
        layout = self.client.get("/api/rooms/2").json["items"]
        layout[0]["rotation"] = math.pi / 2
        self.assertEqual(self.client.put("/api/rooms/2", json={"items": layout}).status_code, 200)
        self.assertEqual(
            len(self.client.get("/api/rooms/2").json["items"][0]["state"]["drawings"]), 1
        )
        clear = a.emit("object_action", {"itemId": "object", "action": "clearBoard"}, callback=True)
        self.assertTrue(clear["ok"])
        self.assertEqual(clear["item"]["state"]["drawings"], [])

    def test_shared_actions_cooldown_proximity_and_finite_effect(self):
        self.item("giantDuck")
        a, b = self.socket(), self.socket(position=[4.4, 0, 4.4])
        event = {"itemId": "object", "action": "squeak"}
        self.assertFalse(b.emit("object_action", event, callback=True)["ok"])
        result = a.emit("object_action", event, callback=True)
        self.assertTrue(result["ok"])
        effect = result["item"]["state"]["effect"]
        self.assertEqual(effect["expires"] - effect["at"], 1)
        self.assertTrue(any(p["name"] == "object_update" for p in b.get_received()))
        self.assertFalse(a.emit("object_action", event, callback=True)["ok"])
        self.assertFalse(
            a.emit("object_action", {"itemId": "object", "action": "toggle"}, callback=True)["ok"]
        )

    def test_radio_real_audio_shared_track_position_and_portal_validation(self):
        self.item("retroRadio")
        a = self.socket()
        self.assertFalse(
            a.emit("object_action", {"itemId": "object", "action": "play"}, callback=True)["ok"]
        )
        raw = (
            b"RIFF"
            + struct.pack("<I", 36)
            + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16)
            + b"data"
            + struct.pack("<I", 0)
        )
        audio = self.upload(io.BytesIO(raw), "audio")
        self.assertEqual(audio.status_code, 201)
        response = self.client.patch(
            "/api/rooms/2/objects/object",
            json={
                "revision": 0,
                "config": {"tracks": [{"url": audio.json["url"], "title": "Test audio"}]},
            },
        )
        self.assertEqual(response.status_code, 200)
        played = a.emit(
            "object_action",
            {"itemId": "object", "action": "play", "index": 0, "position": 2},
            callback=True,
        )
        self.assertTrue(played["ok"])
        self.assertTrue(played["item"]["state"]["radio"]["playing"])
        paused = a.emit("object_action", {"itemId": "object", "action": "pause"}, callback=True)
        self.assertTrue(paused["ok"])
        self.assertFalse(paused["item"]["state"]["radio"]["playing"])
        self.item("friendPortal")
        self.assertEqual(
            self.client.patch(
                "/api/rooms/2/objects/object",
                json={"revision": 0, "config": {"destination": 999999}},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.patch(
                "/api/rooms/2/objects/object", json={"revision": 0, "config": {"destination": 1}}
            ).status_code,
            200,
        )
        self.assertEqual(
            a.emit("object_action", {"itemId": "object", "action": "visit"}, callback=True)[
                "destination"
            ]["id"],
            1,
        )

    def test_all_types_validate_and_implement_their_public_actions(self):
        from backend.validation import OBJECTS, validate_layout

        for kind, info in OBJECTS.items():
            with self.subTest(kind=kind):
                record = self.item(kind)
                validate_layout({"items": [record]})
        self.item("dartRack")
        a = self.socket()
        result = a.emit(
            "object_action",
            {"itemId": "object", "action": "darts", "hits": [[0, 0], [0.1, 0], [1.3, 1.3]]},
            callback=True,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 75)
        self.item("snackMachine")
        self.assertTrue(
            a.emit(
                "object_action",
                {"itemId": "object", "action": "snack", "snack": "juice"},
                callback=True,
            )["ok"]
        )
        self.assertTrue(
            a.emit("object_action", {"itemId": "object", "action": "consume"}, callback=True)["ok"]
        )
        self.item("magicMirror")
        self.assertTrue(
            a.emit(
                "object_action",
                {"itemId": "object", "action": "mirror", "effect": "glasses"},
                callback=True,
            )["ok"]
        )
        self.assertTrue(
            a.emit("object_action", {"itemId": "object", "action": "removeEffect"}, callback=True)[
                "ok"
            ]
        )

    def test_closed_room_blocks_http_socket_media_and_portal_arrivals(self):
        self.item("friendPortal", config={"destination": 1})
        visitor = self.app.test_client()
        destination = visitor.register("Closed destination").json["user"]["personalRoomId"]
        self.assertEqual(
            visitor.patch(f"/api/rooms/{destination}/access", json={"isOpen": False}).status_code,
            200,
        )
        self.assertEqual(self.client.get(f"/api/rooms/{destination}").status_code, 403)
        self.assertEqual(visitor.get(f"/api/rooms/{destination}").status_code, 200)
        self.assertEqual(
            self.client.patch(
                "/api/rooms/2/objects/object",
                json={"revision": 0, "config": {"destination": destination}},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.patch(
                f"/api/rooms/{destination}/access", json={"isOpen": True}
            ).status_code,
            403,
        )
        self.assertEqual(
            visitor.patch(f"/api/rooms/{destination}/access", json={"isOpen": True}).status_code,
            200,
        )
        self.assertEqual(
            self.client.patch(
                "/api/rooms/2/objects/object",
                json={"revision": 0, "config": {"destination": destination}},
            ).status_code,
            200,
        )
        a = self.socket()
        visitor.patch(f"/api/rooms/{destination}/access", json={"isOpen": False})
        self.assertFalse(
            a.emit("object_action", {"itemId": "object", "action": "visit"}, callback=True)["ok"]
        )

    def test_shared_visual_actions_and_configuration_survive_reload(self):
        a = self.socket()
        for kind, action in [
            ("aquarium", "feed"),
            ("discoBall", "toggle"),
            ("tinyDoor", "greet"),
            ("noTouchButton", "surprise"),
            ("mysteryBox", "open"),
            ("coneLamp", "toggle"),
            ("eyePlant", "water"),
            ("wingToaster", "toast"),
            ("crookedPicture", "straighten"),
            ("monsterRug", "step"),
        ]:
            with self.subTest(kind=kind):
                self.item(kind)
                response = a.emit(
                    "object_action", {"itemId": "object", "action": action}, callback=True
                )
                self.assertTrue(response["ok"], response)
                if action == "toggle":
                    self.assertFalse(
                        a.emit(
                            "object_action", {"itemId": "object", "action": action}, callback=True
                        )["ok"]
                    )
                from backend.database import SessionLocal
                from backend.models import PlacedFurniture

                with SessionLocal() as session:
                    self.assertEqual(
                        session.get(PlacedFurniture, "object").state, response["item"]["state"]
                    )

    def test_pose_configuration_updates_an_occupied_seat(self):
        self.item("handChair")
        a = self.socket()
        self.assertTrue(a.emit("player_sit", {"itemId": "object", "slot": 0}, callback=True)["ok"])
        a.get_received()
        response = self.client.patch(
            "/api/rooms/2/objects/object", json={"revision": 0, "config": {"pose": "relaxed"}}
        )
        self.assertEqual(response.status_code, 200)
        updates = [
            event["args"][0]
            for event in a.get_received()
            if event["name"] == "player_posture_changed"
        ]
        self.assertEqual(updates[-1]["seatPose"], "relaxed")

    def test_radio_end_validates_time_and_allows_replay_after_room_was_empty(self):
        import time
        from backend.database import SessionLocal
        from backend.models import PlacedFurniture

        self.item("retroRadio")
        audio = self.upload(io.BytesIO(b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 100), "audio")
        config = {"tracks": [{"url": audio.json["url"], "title": "Short track", "duration": 2}]}
        self.assertEqual(
            self.client.patch(
                "/api/rooms/2/objects/object", json={"revision": 0, "config": config}
            ).status_code,
            200,
        )
        near, distant = self.socket(), self.socket(position=[4.4, 0, 4.4])
        self.assertTrue(
            near.emit("object_action", {"itemId": "object", "action": "play"}, callback=True)["ok"]
        )
        end = {"itemId": "object", "action": "pause", "ended": True}
        self.assertFalse(distant.emit("object_action", end, callback=True)["ok"])
        with SessionLocal.begin() as session:
            item = session.get(PlacedFurniture, "object")
            item.state = {
                **item.state,
                "radio": {**item.state["radio"], "updatedAt": time.time() - 3},
            }
        self.assertFalse(
            self.client.get("/api/rooms/2").json["items"][-1]["state"]["radio"]["playing"]
        )
        self.assertTrue(distant.emit("object_action", end, callback=True)["ok"])
        replay = near.emit("object_action", {"itemId": "object", "action": "play"}, callback=True)
        self.assertTrue(replay["ok"])
        self.assertEqual(replay["item"]["state"]["radio"]["position"], 0)
