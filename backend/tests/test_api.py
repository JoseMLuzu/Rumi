from auth_helpers import AccountClient, PASSWORD_HASH, connect
import os
import unittest
from unittest.mock import patch

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


@unittest.skipUnless(
    TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a dedicated PostgreSQL test database."
)
class RoomApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from sqlalchemy.engine import make_url

        if not (make_url(TEST_DATABASE_URL).database or "").endswith("_test"):
            raise RuntimeError("Use a dedicated database whose name ends in _test.")
        if TEST_DATABASE_URL == os.environ.get("DATABASE_URL"):
            raise RuntimeError("The test database must be separate from your development database.")
        cls.environment = patch.dict(os.environ, {"DATABASE_URL": TEST_DATABASE_URL})
        cls.environment.start()
        cls.addClassCleanup(cls.environment.stop)
        from backend.app import app
        from backend.database import Base, SessionLocal, engine
        from backend.models import PlacedFurniture, Room, Visitor

        cls.app, cls.SessionLocal, cls.engine = app, SessionLocal, engine
        cls.Room, cls.PlacedFurniture, cls.Visitor = Room, PlacedFurniture, Visitor
        cls.addClassCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        app.test_client_class = AccountClient
        cls.client = app.test_client()

    def setUp(self):
        from sqlalchemy import delete
        from backend.models import AuthSession, Space, SpaceMembership
        from backend.auth import attempts

        attempts.clear()
        self.app.config["AUTO_JOIN_GCI"] = True
        self.client = self.app.test_client()

        # Only the explicitly configured test database is cleared between tests.
        with self.SessionLocal.begin() as session:
            session.execute(delete(AuthSession))
            session.execute(delete(SpaceMembership))
            session.query(Space).update({"owner_id": None})
            session.execute(delete(self.Visitor))
            session.execute(delete(self.PlacedFurniture))
            session.execute(delete(self.Room))
            session.execute(delete(Space))
            session.add(Space(id=1, name="gci"))
            session.flush()
            session.add_all(
                [
                    self.Room(id=1, name="Central room", is_central=True),
                    self.Room(id=2, name="My room"),
                ]
            )
            session.flush()
            session.add(self.PlacedFurniture.from_record(1, self.chair(id="central-chair")))
            session.add(self.PlacedFurniture.from_record(2, self.chair()))
            visitor_id = "test owner"
            session.add(self.Visitor(id=visitor_id, room_id=2, password_hash=PASSWORD_HASH))
            session.flush()
            session.add(SpaceMembership(space_id=1, user_id=visitor_id, room_id=2))
        self.assertEqual(self.client.login(visitor_id).status_code, 200)
        from backend.seed import seed

        with patch("builtins.print"):
            seed()
        # Reset in-memory hall bounds alongside this test's fresh database fixture.
        from backend.hall import build_hall
        from backend.realtime import hall_walk_areas, hall_limits

        hall_limits.clear()
        hall_limits[1] = hall_walk_areas
        with self.SessionLocal() as session:
            hall_walk_areas[:] = build_hall(session.query(self.Room).all())["walkAreas"]

    @staticmethod
    def chair(**changes):
        return {"id": "chair-1", "type": "chair", "position": [0, 0, 0], "rotation": 0, **changes}

    def test_health_get_and_missing_room(self):
        self.assertEqual(self.client.get("/api/health").json, {"status": "ok"})
        room = self.client.get("/api/rooms/2")
        self.assertEqual(room.status_code, 200)
        self.assertEqual(room.json["items"], [self.chair()])
        self.assertEqual(self.client.get("/api/rooms/999999").status_code, 404)

    def test_public_playtest_rejects_saves_and_preserves_furniture(self):
        with patch.dict(self.app.config, {"ROOM_READ_ONLY": True}):
            self.assertTrue(self.client.get("/api/rooms/2").json["readOnly"])
            self.assertEqual(self.client.put("/api/rooms/2", json={"items": []}).status_code, 403)
            self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])
        self.assertFalse(self.client.get("/api/rooms/2").json["readOnly"])

    def test_visitors_get_distinct_persistent_rooms_with_unique_furniture(self):
        first, second = self.app.test_client(), self.app.test_client()
        first_response = first.register("Jose")
        self.assertEqual(first_response.status_code, 201)
        first_id = first_response.json["user"]["personalRoomId"]
        second_id = second.register("Ana").json["user"]["personalRoomId"]
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(first.login(" Jose ").status_code, 200)
        self.assertEqual(first.login("JOSE").json["user"]["personalRoomId"], first_id)
        first_room = first.get(f"/api/rooms/{first_id}").json
        second_room = second.get(f"/api/rooms/{second_id}").json
        self.assertEqual(len(first_room["items"]), 6)
        self.assertFalse(first_room["readOnly"])
        self.assertTrue(
            set(item["id"] for item in first_room["items"]).isdisjoint(
                item["id"] for item in second_room["items"]
            )
        )
        cookie = first_response.headers["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)
        self.assertIn(
            "Secure",
            self.app.test_client()
            .login("Jose", base_url="https://localhost")
            .headers["Set-Cookie"],
        )
        self.assertEqual(first.put(f"/api/rooms/{first_id}", json={"items": []}).status_code, 200)
        self.assertEqual(first.get(f"/api/rooms/{first_id}").json["items"], [])
        self.assertEqual(len(second.get(f"/api/rooms/{second_id}").json["items"]), 6)

    def test_personal_room_access_and_central_room_write_permissions(self):
        other = self.app.test_client()
        other.register("Guest")
        self.assertEqual(other.get("/api/rooms/2").status_code, 200)
        self.assertTrue(other.get("/api/rooms/2").json["readOnly"])
        self.assertEqual(other.put("/api/rooms/2", json={"items": []}).status_code, 403)
        self.assertEqual(self.app.test_client().get("/api/rooms/2").status_code, 401)
        self.assertTrue(other.get("/api/rooms/1").json["readOnly"])
        self.assertEqual(self.client.put("/api/rooms/1", json={"items": []}).status_code, 403)
        central = self.client.get("/api/rooms/1").json["items"]
        self.assertEqual(central, [self.chair(id="central-chair")])
        collision = self.client.put(
            "/api/rooms/2", json={"items": [self.chair(id="central-chair")]}
        )
        self.assertEqual(collision.status_code, 400)
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])
        self.assertEqual(self.client.get("/api/rooms/1").json["items"], central)

    def test_saved_name_recovers_room_after_losing_cookie_on_another_browser(self):
        client = self.app.test_client()
        original = client.register("José Smith").json["user"]["personalRoomId"]
        self.assertEqual(client.put(f"/api/rooms/{original}", json={"items": []}).status_code, 200)
        client.delete_cookie("social_rooms_session")
        returning = self.app.test_client()
        response = returning.login("  JOSÉ   SMITH ")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["user"]["personalRoomId"], original)
        self.assertFalse(returning.get(f"/api/rooms/{original}").json["readOnly"])
        self.assertEqual(returning.get(f"/api/rooms/{original}").json["items"], [])
        self.assertEqual(
            client.login("José Smith").json["user"]["personalRoomId"],
            original,
        )
        with self.SessionLocal() as session:
            self.assertEqual(session.get(self.Room, original).to_dict()["items"], [])

    def test_entry_requires_a_valid_name_and_never_creates_rooms_on_bad_input(self):
        from sqlalchemy import func, select

        for payload in [
            None,
            {},
            [],
            {"name": 5},
            {"name": "   "},
            {"name": "x" * 25},
            {"name": "<script>"},
            {"name": "a/b"},
        ]:
            response = (
                self.client.post("/api/auth/register", json=payload)
                if payload is not None
                else self.client.post("/api/auth/register")
            )
            self.assertIn(response.status_code, (400, 415))
        with self.SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(self.Room)), 2)

    def test_name_normalization_rules(self):
        from backend.visitors import normalize_name

        for original, expected in [
            ("  Jose  ", "jose"),
            ("JOSÉ   Smith", "josé smith"),
            ("ＡＮＡ", "ana"),
            ("Jose-Manuel_2", "jose-manuel_2"),
        ]:
            self.assertEqual(normalize_name(original)[0], expected)

    def test_concurrent_first_entry_for_same_name_creates_only_one_bedroom(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from sqlalchemy import event, func, select

        rendezvous = Barrier(2)

        def before_insert(_mapper, _connection, visitor):
            if visitor.id == "same name":
                rendezvous.wait(timeout=5)

        def enter():
            with self.app.test_client() as client:
                return client.register("Same Name")

        event.listen(self.Visitor, "before_insert", before_insert)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(enter) for _ in range(2)]
                responses = [future.result(timeout=10) for future in futures]
        finally:
            event.remove(self.Visitor, "before_insert", before_insert)
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        self.assertIn(
            "user", next(response for response in responses if response.status_code == 201).json
        )
        with self.SessionLocal() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(self.Room)), 3)
            self.assertEqual(session.scalar(select(func.count()).select_from(self.Visitor)), 2)

    def test_returning_name_does_not_add_hall_doors_or_reset_saved_furniture(self):
        hall_player = self.live_client()
        hall_player.get_received()
        browser = self.app.test_client()
        first = browser.register("Marta")
        room_id = first.json["user"]["personalRoomId"]
        self.event(hall_player, "hall_changed")
        browser.put(f"/api/rooms/{room_id}", json={"items": []})
        doors_before = self.client.get("/api/rooms/1").json["hall"]["doors"]
        second = self.app.test_client().login("marta")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json["user"]["personalRoomId"], room_id)
        self.assertEqual(hall_player.get_received(), [])
        self.assertEqual(self.client.get("/api/rooms/1").json["hall"]["doors"], doors_before)

    def test_reset_house_leaves_only_the_living_room(self):
        from backend.reset_house import reset_house
        from sqlalchemy import select

        with patch("builtins.print"):
            reset_house()
        with self.SessionLocal() as session:
            self.assertEqual([room.id for room in session.scalars(select(self.Room)).all()], [1])
            self.assertEqual(session.scalars(select(self.Visitor)).all(), [])
            self.assertEqual(session.get(self.Room, 1).name, "Living room")
            self.assertEqual(len(session.get(self.Room, 1).furniture), 15)
        first = self.client.register("First bedroom")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.json["user"]["personalRoomId"], 2)

    def test_live_presence_is_isolated_and_visitors_can_meet_in_a_personal_room(self):
        from backend.realtime import socketio

        personal = self.live_client(roomId=2)
        central = self.live_client()
        self.assertEqual(len(self.event(personal, "room_state")["players"]), 1)
        self.assertEqual(len(self.event(central, "room_state")["players"]), 1)
        other = self.app.test_client()
        other_room = other.register("Guest").json["user"]["personalRoomId"]
        self.event(central, "hall_changed")
        guest = connect(
            socketio,
            self.app,
            auth={
                "roomId": 2,
                "position": [1, 0, 1],
                "rotation": 0,
            },
            flask_test_client=other,
        )
        self.addCleanup(lambda: guest.disconnect() if guest.is_connected() else None)
        self.assertTrue(guest.is_connected())
        self.assertEqual(len(self.event(guest, "room_state")["players"]), 2)
        self.event(personal, "player_joined")
        another = connect(
            socketio,
            self.app,
            auth={
                "roomId": other_room,
                "position": [1, 0, 1],
                "rotation": 0,
            },
            flask_test_client=other,
        )
        self.addCleanup(lambda: another.disconnect() if another.is_connected() else None)
        self.assertEqual(len(self.event(another, "room_state")["players"]), 1)
        personal.emit("player_move", {"roomId": 1, "position": [1.5, 0, 1], "rotation": 0})
        self.assertEqual(self.event(guest, "player_moved")["position"], [1.5, 0, 1])
        self.assertEqual(central.get_received(), [])
        self.assertEqual(another.get_received(), [])
        personal.disconnect()
        self.assertIn("id", self.event(guest, "player_left"))
        self.assertEqual(central.get_received(), [])
        self.assertEqual(another.get_received(), [])

    def test_directory_lists_room_ids_without_exposing_visitor_keys(self):
        self.assertEqual(self.app.test_client().get("/api/rooms").status_code, 401)
        result = self.client.get("/api/rooms")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(
            result.json,
            {
                "rooms": [
                    {"id": 1, "name": "Living room"},
                    {"id": 2, "name": "My room"},
                ]
            },
        )

    def test_saved_layout_notifies_only_the_occupied_room_after_commit(self):
        owner = self.live_client(roomId=2)
        guest_http = self.app.test_client()
        guest_http.register("Guest")
        from backend.realtime import socketio

        guest = connect(
            socketio,
            self.app,
            auth={
                "roomId": 2,
                "position": [1, 0, 1],
                "rotation": 0,
            },
            flask_test_client=guest_http,
        )
        self.addCleanup(lambda: guest.disconnect() if guest.is_connected() else None)
        central = self.live_client()
        for client in [owner, guest, central]:
            client.get_received()
        self.assertEqual(guest_http.put("/api/rooms/2", json={"items": []}).status_code, 403)
        self.assertEqual(guest.get_received(), [])
        self.assertEqual(self.client.put("/api/rooms/2", json={"items": []}).status_code, 200)
        self.assertEqual(self.event(guest, "room_layout_changed"), {"roomId": 2})
        self.assertEqual(self.event(owner, "room_layout_changed"), {"roomId": 2})
        self.assertEqual(central.get_received(), [])
        self.assertEqual(guest_http.get("/api/rooms/2").json["items"], [])
        self.assertTrue(guest_http.get("/api/rooms/2").json["readOnly"])

    def test_put_replaces_without_duplicates_and_can_clear(self):
        item = self.chair(position=[2, 0, 2])
        for _ in range(2):
            response = self.client.put("/api/rooms/2", json={"items": [item]})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["items"], [item])
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [item])
        self.assertEqual(self.client.put("/api/rooms/2", json={"items": []}).json["items"], [])
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [])

    def test_invalid_requests_leave_the_previous_layout_unchanged(self):
        for payload in [{}, {"items": [None]}, {"items": [self.chair(type="unknown")]}]:
            self.assertEqual(self.client.put("/api/rooms/2", json=payload).status_code, 400)
        self.assertEqual(
            self.client.put(
                "/api/rooms/2", data="broken", content_type="application/json"
            ).status_code,
            400,
        )
        self.assertEqual(self.client.put("/api/rooms/2", data="{}").status_code, 415)
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])
        self.assertEqual(self.client.put("/api/rooms/999999", json={"items": []}).status_code, 403)

    def test_database_failure_rolls_back_the_deletion(self):
        from sqlalchemy import event
        from sqlalchemy.exc import SQLAlchemyError

        def fail_insert(*_):
            raise SQLAlchemyError("Simulated insert failure after deleting the old layout")

        event.listen(self.PlacedFurniture, "before_insert", fail_insert)
        try:
            with self.assertLogs(self.app.logger, level="ERROR"):
                response = self.client.put(
                    "/api/rooms/2", json={"items": [self.chair(position=[2, 0, 2])]}
                )
            self.assertEqual(response.status_code, 503)
        finally:
            event.remove(self.PlacedFurniture, "before_insert", fail_insert)
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])

    def test_seeding_does_not_reset_an_existing_room(self):
        from backend.seed import seed

        central_before = self.client.get("/api/rooms/1").json["items"]
        with patch("builtins.print"):
            seed()
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])
        self.assertEqual(self.client.get("/api/rooms/1").json["items"], central_before)

    def test_central_garden_layout_is_valid_with_a_clear_exit_and_spawn(self):
        from backend.seed import CENTRAL_ITEMS
        from backend.validation import validate_layout
        from backend.living_room import validate_entrances

        self.assertEqual(len(validate_layout({"items": CENTRAL_ITEMS})), 15)
        self.assertNotIn("bed", [item["type"] for item in CENTRAL_ITEMS])
        validate_entrances(CENTRAL_ITEMS)

    def live_client(self, **changes):
        from backend.realtime import socketio

        client = connect(
            socketio,
            self.app,
            auth={
                "roomId": 1,
                "position": [1, 0, 1],
                "rotation": 0,
                **changes,
            },
            flask_test_client=self.client,
        )
        self.addCleanup(lambda: client.disconnect() if client.is_connected() else None)
        return client

    @staticmethod
    def event(client, name):
        return next(
            message["args"][0] for message in client.get_received() if message["name"] == name
        )

    def test_live_players_join_move_and_leave_without_database_writes(self):
        first = self.live_client()
        first_id = self.event(first, "room_state")["players"][0]["id"]
        second = self.live_client(position=[2, 0, 2])
        snapshot = self.event(second, "room_state")["players"]
        self.assertEqual(len(snapshot), 2)
        second_id = self.event(first, "player_joined")["id"]
        pose = {"position": [1.5, 0, 1], "rotation": 0.5}
        # A client-supplied ID must never let it impersonate another connection.
        self.assertEqual(
            first.emit("player_move", {"id": second_id, **pose}, callback=True), {"ok": True}
        )
        moved = self.event(second, "player_moved")
        self.assertEqual(
            moved,
            {"id": first_id, "name": "My room", "voiceEnabled": False, "voiceMuted": False, **pose},
        )
        self.assertEqual(first.get_received(), [])
        first.disconnect()
        self.assertEqual(self.event(second, "player_left"), {"id": first_id})
        self.assertEqual(self.client.get("/api/rooms/2").json["items"], [self.chair()])

    def test_seat_reservation_is_shared_and_walking_cannot_override_it(self):
        first = self.live_client()
        second = self.live_client(position=[0.9, 0, 1])
        result = first.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)
        self.assertTrue(result["ok"])
        pose = result["player"]
        self.assertEqual(pose["position"], [0, 0, 0.04])
        self.assertEqual(pose["seatHeight"], 0.69)
        self.assertTrue(self.event(second, "player_posture_changed")["seated"])
        self.assertFalse(
            second.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)["ok"]
        )
        self.assertEqual(
            first.emit(
                "player_move",
                {"position": [3, 0, 3], "rotation": 0, "seated": False},
                callback=True,
            ),
            {"ok": False},
        )
        joined = self.live_client(position=[3, 0, 3])
        snapshot = self.event(joined, "room_state")["players"]
        self.assertTrue(next(player for player in snapshot if player["id"] == pose["id"])["seated"])
        standing = first.emit("player_stand", callback=True)
        self.assertTrue(standing["ok"])
        self.assertFalse(standing["player"]["seated"])
        self.assertEqual(standing["player"]["position"], [1, 0, 1])
        self.assertTrue(
            second.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)["ok"]
        )

    def test_seating_rejects_bad_slots_other_rooms_nonseats_and_distance(self):
        client = self.live_client()
        self.add_projector_table()
        for data in [
            None,
            {},
            {"itemId": []},
            {"itemId": "central-chair", "slot": True},
            {"itemId": "central-chair", "slot": -1},
            {"itemId": "central-chair", "slot": 2},
            {"itemId": "chair-1", "slot": 0},
            {"itemId": "projector-table", "slot": 0},
        ]:
            with self.subTest(data=data):
                self.assertFalse(client.emit("player_sit", data, callback=True)["ok"])
        client.emit("player_move", {"position": [4, 0, 4], "rotation": 0})
        self.assertFalse(
            client.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)["ok"]
        )

    def test_sofa_slots_are_independent_and_rotated_with_the_furniture(self):
        import math

        with self.SessionLocal.begin() as session:
            session.add(
                self.PlacedFurniture.from_record(
                    1,
                    {
                        "id": "test-sofa",
                        "type": "sofa",
                        "position": [2, 0, 0],
                        "rotation": math.pi / 2,
                    },
                )
            )
        first = self.live_client(position=[3.5, 0, 0.5])
        second = self.live_client(position=[3.5, 0, -0.5])
        for client, slot, z in [(first, 0, 0.55), (second, 1, -0.55)]:
            result = client.emit("player_sit", {"itemId": "test-sofa", "slot": slot}, callback=True)
            self.assertTrue(result["ok"])
            self.assertAlmostEqual(result["player"]["position"][0], 2.1)
            self.assertAlmostEqual(result["player"]["position"][2], z)
            self.assertEqual(result["player"]["seatHeight"], 0.72)

    def test_disconnect_releases_seat_and_posture_preserves_voice(self):
        first = self.live_client()
        self.add_projector_table()
        first.emit("voice_state", {"enabled": True, "muted": False})
        result = first.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)
        self.assertTrue(result["player"]["voiceEnabled"])
        self.assertEqual(result["player"]["name"], "My room")
        self.assertTrue(first.emit("screen_start", callback=True)["ok"])
        first.disconnect()
        second = self.live_client()
        self.assertTrue(
            second.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)["ok"]
        )
        self.assertEqual(len(self.client.get("/api/rooms/1").json["items"]), 2)

    def test_standing_avoids_changed_furniture_and_respects_book_table_removal(self):
        from backend.seating import can_stand

        client = self.live_client()
        self.assertTrue(
            client.emit("player_sit", {"itemId": "central-chair", "slot": 0}, callback=True)["ok"]
        )
        with self.SessionLocal.begin() as session:
            session.add(
                self.PlacedFurniture.from_record(
                    1, {"id": "blocking-lamp", "type": "lamp", "position": [1, 0, 1], "rotation": 0}
                )
            )
        result = client.emit("player_stand", callback=True)
        self.assertTrue(result["ok"])
        self.assertNotEqual(result["player"]["position"], [1, 0, 1])
        with self.SessionLocal() as session:
            items = session.query(self.PlacedFurniture).filter_by(room_id=1).all()
            self.assertTrue(can_stand(result["player"]["position"], items, 1))
        # Removing the book table now also removes its collision footprint.
        self.assertTrue(can_stand([0, 0, 3.25], [], 1))

    def test_anonymous_visitor_cannot_join_shared_living_room(self):
        from backend.realtime import socketio

        client = connect(
            socketio, self.app, auth={"roomId": 1, "position": [1, 0, 1], "rotation": 0}
        )
        self.addCleanup(lambda: client.disconnect() if client.is_connected() else None)
        self.assertFalse(client.is_connected())

    def test_live_rejects_unknown_rooms_and_invalid_poses(self):
        self.assertFalse(self.live_client(roomId=999999).is_connected())
        self.assertFalse(self.live_client(roomId=True).is_connected())
        self.assertFalse(self.live_client(position=[100, 0, 0]).is_connected())
        first, second = self.live_client(), self.live_client()
        first.get_received()
        second.get_received()
        for payload in [
            None,
            {},
            {"position": [True, 0, 0], "rotation": 0},
            {"position": [0, 1, 0], "rotation": 0},
            {"position": [float("nan"), 0, 0], "rotation": 0},
            {"position": [0, 0, 0], "rotation": 10},
            {"position": [5, 0, 4], "rotation": 0},
        ]:
            self.assertEqual(first.emit("player_move", payload, callback=True), {"ok": False})
        self.assertEqual(second.get_received(), [])

    def test_hall_has_one_door_per_room_and_expands_for_connected_players(self):
        hall_player = self.live_client()
        self.event(hall_player, "room_state")
        old_hall = self.client.get("/api/rooms/1").json["hall"]
        self.assertEqual([door["roomId"] for door in old_hall["doors"]], [2])
        self.assertEqual(
            hall_player.emit("player_move", {"position": [21, 0, 0], "rotation": 0}, callback=True),
            {"ok": False},
        )
        for index in range(4):
            self.app.test_client().register(f"Guest {index}")
        notices = hall_player.get_received()
        self.assertEqual(sum(event["name"] == "hall_changed" for event in notices), 4)
        hall = self.client.get("/api/rooms/1").json["hall"]
        self.assertEqual(len(hall["doors"]), 5)
        self.assertGreater(hall["halfLength"], old_hall["halfLength"])
        self.assertEqual(hall["doors"][0], old_hall["doors"][0])
        self.assertEqual(
            hall_player.emit("player_move", {"position": [15, 0, 0], "rotation": 0}, callback=True),
            {"ok": True},
        )
        self.assertEqual(
            hall_player.emit("player_move", {"position": [21, 0, 3], "rotation": 0}, callback=True),
            {"ok": False},
        )
        personal = self.live_client(roomId=2)
        self.assertEqual(
            personal.emit(
                "player_move", {"roomId": 1, "position": [21, 0, 0], "rotation": 0}, callback=True
            ),
            {"ok": False},
        )
        corridor = self.live_client(position=hall["doors"][-1]["arrival"])
        self.assertTrue(corridor.is_connected())

    def test_live_reconnect_has_new_identity_and_fresh_snapshot(self):
        first, second = self.live_client(), self.live_client()
        old_id = self.event(first, "room_state")["players"][0]["id"]
        second.get_received()
        first.disconnect()
        second.get_received()
        first = self.live_client(position=[3, 0, 3])
        snapshot = self.event(first, "room_state")["players"]
        self.assertEqual(len(snapshot), 2)
        self.assertNotIn(old_id, [player["id"] for player in snapshot])
        self.assertTrue(any(player["position"] == [3, 0, 3] for player in snapshot))

    def test_player_names_come_from_saved_identity_and_survive_movement(self):
        player = self.live_client(name="Fake name")
        snapshot = self.event(player, "room_state")["players"]
        self.assertEqual(snapshot[0]["name"], "My room")
        other = self.live_client()
        player.get_received()
        other.get_received()
        player.emit("player_move", {"name": "Fake name", "position": [2, 0, 1], "rotation": 0})
        self.assertEqual(self.event(other, "player_moved")["name"], "My room")

    def add_projector_table(self, position=None):
        with self.SessionLocal.begin() as session:
            session.add(
                self.PlacedFurniture.from_record(
                    1,
                    {
                        "id": "projector-table",
                        "type": "table",
                        "position": position or [0, 0, -0.4],
                        "rotation": 0,
                    },
                )
            )

    def test_projector_has_one_presenter_and_late_joiners_receive_its_preview(self):
        self.add_projector_table()
        first = self.live_client()
        first.get_received()
        reply = first.emit("screen_start", {"name": "Fake", "id": "spoofed"}, callback=True)
        self.assertTrue(reply["ok"])
        share = reply["share"]
        self.assertEqual(share["name"], "My room")
        frame = "data:image/jpeg;base64,/9j/AA=="
        self.assertTrue(
            first.emit(
                "screen_preview", {"sessionId": share["sessionId"], "frame": frame}, callback=True
            )["ok"]
        )
        second = self.live_client()
        snapshot = self.event(second, "screen_state")
        self.assertEqual(snapshot, {"share": share, "preview": frame})
        self.assertFalse(second.emit("screen_start", {}, callback=True)["ok"])
        self.assertFalse(
            second.emit("screen_stop", {"sessionId": share["sessionId"]}, callback=True)["ok"]
        )
        second.get_received()
        first.disconnect()
        self.assertEqual(self.event(second, "screen_state"), {"share": None, "preview": None})
        self.assertTrue(second.emit("screen_start", {}, callback=True)["ok"])

    def test_projector_full_video_requires_nearby_opt_in_and_current_session(self):
        self.add_projector_table()
        presenter = self.live_client(position=[0, 0, 2])
        viewer = self.live_client(position=[1, 0, 1])
        personal = self.live_client(roomId=2)
        presenter.get_received()
        viewer_id = next(
            p["id"]
            for p in self.event(viewer, "room_state")["players"]
            if p["position"] == [1, 0, 1]
        )
        self.assertFalse(personal.emit("screen_start", {}, callback=True)["ok"])
        share = presenter.emit("screen_start", {}, callback=True)["share"]
        for client in [presenter, viewer, personal]:
            client.get_received()
        offer = {
            "sessionId": share["sessionId"],
            "to": viewer_id,
            "description": {"type": "offer", "sdp": "test video offer"},
        }
        self.assertFalse(presenter.emit("screen_signal", offer, callback=True)["ok"])
        self.assertFalse(
            viewer.emit("screen_watch", {"sessionId": "old", "watching": True}, callback=True)["ok"]
        )
        self.assertTrue(
            viewer.emit(
                "screen_watch", {"sessionId": share["sessionId"], "watching": True}, callback=True
            )["ok"]
        )
        self.assertEqual(
            self.event(presenter, "screen_viewer_joined"),
            {"id": viewer_id, "sessionId": share["sessionId"]},
        )
        self.assertTrue(presenter.emit("screen_signal", offer, callback=True)["ok"])
        signal = self.event(viewer, "screen_signal")
        self.assertEqual(signal["description"], offer["description"])
        self.assertEqual(signal["from"], share["id"])
        self.assertFalse(
            personal.emit(
                "screen_watch", {"sessionId": share["sessionId"], "watching": True}, callback=True
            )["ok"]
        )
        viewer.emit(
            "screen_watch", {"sessionId": share["sessionId"], "watching": False}, callback=True
        )
        self.assertEqual(self.event(presenter, "screen_viewer_left")["id"], viewer_id)
        self.assertFalse(presenter.emit("screen_signal", offer, callback=True)["ok"])
        viewer.emit("player_move", {"position": [0, 0, -3], "rotation": 0})
        self.assertFalse(
            viewer.emit(
                "screen_watch", {"sessionId": share["sessionId"], "watching": True}, callback=True
            )["ok"]
        )
        self.assertFalse(viewer.emit("screen_start", {}, callback=True)["ok"])
        presenter.emit("screen_stop", {"sessionId": share["sessionId"]}, callback=True)
        next_share = presenter.emit("screen_start", {}, callback=True)["share"]
        self.assertNotEqual(next_share["sessionId"], share["sessionId"])
        self.assertFalse(
            presenter.emit("screen_stop", {"sessionId": share["sessionId"]}, callback=True)["ok"]
        )

    def test_projector_preview_rejects_spoofing_large_frames_and_flooding(self):
        self.add_projector_table()
        presenter, other = self.live_client(), self.live_client()
        share = presenter.emit("screen_start", {}, callback=True)["share"]
        payload = {"sessionId": share["sessionId"], "frame": "data:image/jpeg;base64,/9j/AA=="}
        self.assertFalse(other.emit("screen_preview", payload, callback=True)["ok"])
        for frame in [
            None,
            "https://example.test/frame.jpg",
            "data:image/svg+xml;base64,AAAA",
            "data:image/jpeg;base64," + "A" * 12000,
        ]:
            self.assertFalse(
                presenter.emit("screen_preview", {**payload, "frame": frame}, callback=True)["ok"]
            )
        with patch("backend.screens.monotonic", return_value=100):
            self.assertTrue(presenter.emit("screen_preview", payload, callback=True)["ok"])
            self.assertFalse(presenter.emit("screen_preview", payload, callback=True)["ok"])
        with patch("backend.screens.monotonic", return_value=104):
            self.assertFalse(presenter.emit("screen_preview", payload, callback=True)["ok"])
        with patch("backend.screens.monotonic", return_value=105):
            self.assertTrue(presenter.emit("screen_preview", payload, callback=True)["ok"])

    def test_projector_permissions_follow_saved_table_and_require_one(self):
        presenter = self.live_client(position=[0, 0, 1])
        self.assertFalse(presenter.emit("screen_start", {}, callback=True)["ok"])
        self.add_projector_table([3, 0, -2])
        self.assertFalse(presenter.emit("screen_start", {}, callback=True)["ok"])
        presenter.emit("player_move", {"position": [3, 0, -1], "rotation": 0})
        self.assertTrue(presenter.emit("screen_start", {}, callback=True)["ok"])

    def test_voice_config_requires_named_visitor_and_supports_relay_settings(self):
        self.assertEqual(self.app.test_client().get("/api/voice-config").status_code, 401)
        config = [
            {"urls": "turn:example.test:3478", "username": "temporary", "credential": "test-only"}
        ]
        with patch.dict(self.app.config, {"VOICE_ICE_SERVERS": config}):
            response = self.client.get("/api/voice-config")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json, {"iceServers": config})
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_voice_flags_and_signaling_require_opt_in_same_room_and_nearby_target(self):
        first = self.live_client()
        first_id = self.event(first, "room_state")["players"][0]["id"]
        second = self.live_client(position=[2, 0, 1])
        snapshot = self.event(second, "room_state")["players"]
        second_id = next(player["id"] for player in snapshot if player["position"] == [2, 0, 1])
        personal = self.live_client(roomId=2)
        personal_id = self.event(personal, "room_state")["players"][0]["id"]
        for client in [first, second, personal]:
            client.get_received()
        offer = {"to": second_id, "description": {"type": "offer", "sdp": "test audio offer"}}
        self.assertEqual(first.emit("voice_signal", offer, callback=True), {"ok": False})
        for client in [first, second, personal]:
            self.assertEqual(
                client.emit("voice_state", {"enabled": True, "muted": False}, callback=True),
                {"ok": True},
            )
            client.get_received()
        self.assertEqual(first.emit("voice_signal", offer, callback=True), {"ok": True})
        self.assertEqual(
            self.event(second, "voice_signal"),
            {"from": first_id, "description": offer["description"]},
        )
        candidate = {"candidate": "candidate:audio", "sdpMid": "0", "sdpMLineIndex": 0}
        self.assertEqual(
            first.emit(
                "voice_signal",
                {"to": second_id, "from": "spoofed", "candidate": candidate},
                callback=True,
            ),
            {"ok": True},
        )
        self.assertEqual(
            self.event(second, "voice_signal"), {"from": first_id, "candidate": candidate}
        )
        self.assertEqual(personal.get_received(), [])
        self.assertEqual(
            first.emit("voice_signal", {**offer, "to": personal_id}, callback=True), {"ok": False}
        )
        self.assertEqual(
            first.emit("voice_signal", {**offer, "to": first_id}, callback=True), {"ok": False}
        )
        self.assertEqual(
            first.emit("voice_signal", {**offer, "to": "missing"}, callback=True), {"ok": False}
        )
        # Expand the hall using test names, then place the target well outside voice range.
        for index in range(4):
            self.app.test_client().register(f"Far {index}")
        second.emit("player_move", {"position": [16, 0, 0], "rotation": 0})
        second.get_received()
        self.assertEqual(first.emit("voice_signal", offer, callback=True), {"ok": False})
        self.assertFalse(any(event["name"] == "voice_signal" for event in second.get_received()))

    def test_voice_mute_is_preserved_during_moves_and_leave_blocks_signaling(self):
        first, second = self.live_client(), self.live_client(position=[2, 0, 1])
        first.get_received()
        snapshot = self.event(second, "room_state")["players"]
        second_id = next(player["id"] for player in snapshot if player["position"] == [2, 0, 1])
        for client in [first, second]:
            client.emit("voice_state", {"enabled": True, "muted": False}, callback=True)
        first.get_received()
        second.get_received()
        first.emit("voice_state", {"enabled": True, "muted": True}, callback=True)
        flags = self.event(second, "player_voice_changed")
        self.assertTrue(flags["voiceMuted"])
        first.emit("player_move", {"position": [1.5, 0, 1], "rotation": 0, "voiceMuted": False})
        self.assertTrue(self.event(second, "player_moved")["voiceMuted"])
        first.emit("voice_state", {"enabled": False, "muted": True}, callback=True)
        flags = self.event(second, "player_voice_changed")
        self.assertFalse(flags["voiceEnabled"])
        self.assertFalse(flags["voiceMuted"])
        self.assertEqual(
            first.emit(
                "voice_signal",
                {"to": second_id, "description": {"type": "offer", "sdp": "audio"}},
                callback=True,
            ),
            {"ok": False},
        )

    def test_malformed_voice_packets_and_unnamed_voice_join_are_rejected(self):
        player = self.live_client()
        for payload in [
            None,
            {},
            {"enabled": 1, "muted": False},
            {"enabled": True, "muted": "false"},
        ]:
            self.assertEqual(player.emit("voice_state", payload, callback=True), {"ok": False})
        for payload in [
            None,
            {},
            {"to": 1},
            {"to": "x", "description": {"type": "bad", "sdp": "audio"}},
            {"to": "x", "description": {"type": "offer", "sdp": "x" * 12001}},
            {"to": "x", "candidate": {"candidate": "x", "sdpMLineIndex": True}},
            {"to": "x", "candidate": {"candidate": "x" * 2049}},
            {"to": "x", "candidate": {}, "description": {}},
        ]:
            self.assertEqual(player.emit("voice_signal", payload, callback=True), {"ok": False})
        from backend.realtime import socketio

        anonymous = connect(
            socketio, self.app, auth={"roomId": 1, "position": [0, 0, 1], "rotation": 0}
        )
        self.addCleanup(lambda: anonymous.disconnect() if anonymous.is_connected() else None)
        self.assertFalse(anonymous.is_connected())


if __name__ == "__main__":
    unittest.main()
