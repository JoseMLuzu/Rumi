import unittest
from types import SimpleNamespace

from backend.hall import build_hall


class HallLayoutTests(unittest.TestCase):
    def rooms(self, *ids):
        return [SimpleNamespace(id=room_id, name=f"Room {room_id}") for room_id in ids]

    def test_sparse_room_ids_get_compact_unique_doorways_and_safe_arrivals(self):
        hall = build_hall(self.rooms(1, 2, 7, 100, 250, 500))
        self.assertEqual([door["roomId"] for door in hall["doors"]], [2, 7, 100, 250, 500])
        self.assertEqual(len(set(tuple(door["position"]) for door in hall["doors"])), 5)
        self.assertAlmostEqual(hall["halfLength"], 17.8)
        self.assertEqual([door["position"] for door in hall["doors"][:4]], [
            [-8.2, 0, -1.5], [8.2, 0, -1.5], [-8.2, 0, 1.5], [8.2, 0, 1.5],
        ])
        for door in hall["doors"]:
            self.assertEqual(door["arrival"][0], door["position"][0])
            self.assertLess(abs(door["arrival"][2]), 1.15)

    def test_adding_a_room_does_not_move_existing_entrances(self):
        before = build_hall(self.rooms(1, 2, 3, 4, 5))
        after = build_hall(self.rooms(1, 2, 3, 4, 5, 6))
        self.assertEqual(after["doors"][:4], before["doors"])
        self.assertGreater(after["halfLength"], before["halfLength"])

    def test_an_empty_directory_still_has_the_shared_lobby(self):
        hall = build_hall(self.rooms(1))
        self.assertEqual(hall["doors"], [])
        self.assertEqual(hall["halfLength"], 5)
