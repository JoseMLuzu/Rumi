import math
import unittest

from backend.validation import validate_layout


def piece(**changes):
    return {"id": "chair-1", "type": "chair", "position": [0, 0, 0], "rotation": 0, **changes}


class ValidationTests(unittest.TestCase):
    def test_valid_layout_and_intentionally_empty_room(self):
        self.assertEqual(validate_layout({"items": [piece()]}), [piece()])
        self.assertEqual(validate_layout({"items": []}), [])

    def test_missing_array_and_invalid_records(self):
        for payload in [None, [], {}, {"items": None}, {"items": [None]}]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_layout(payload)

    def test_bad_ids_and_types(self):
        for changes in [{"id": ""}, {"id": " "}, {"id": "a" * 101}, {"id": 1},
                        {"type": "spaceship"}, {"type": []}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_layout({"items": [piece(**changes)]})
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            validate_layout({"items": [piece(), piece(position=[3, 0, 3])]})

    def test_bad_coordinates_and_rotations(self):
        changes = [
            {"position": [0, 0]}, {"position": [0, 1, 0]}, {"position": [True, 0, 0]},
            {"position": [None, 0, 0]}, {"position": [math.inf, 0, 0]},
            {"position": [10 ** 1000, 0, 0]}, {"rotation": math.nan},
            {"rotation": False}, {"rotation": 0.2}, {"rotation": -math.pi / 2},
            {"rotation": 2 * math.pi},
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_layout({"items": [piece(**change)]})

    def test_all_four_quarter_turns_are_accepted(self):
        for turn in range(4):
            item = piece(rotation=turn * math.pi / 2)
            self.assertEqual(validate_layout({"items": [item]}), [item])

    def test_wall_bounds_overlap_and_rotated_footprint(self):
        with self.assertRaisesRegex(ValueError, "inside"):
            validate_layout({"items": [piece(position=[5, 0, 0])]})
        with self.assertRaisesRegex(ValueError, "between"):
            validate_layout({"items": [piece(), piece(id="chair-2", position=[0.5, 0, 0])]})
        self.assertEqual(len(validate_layout({"items": [piece(type="bed", position=[3.7, 0, 0])]})), 1)
        with self.assertRaisesRegex(ValueError, "inside"):
            validate_layout({"items": [piece(type="bed", position=[3.7, 0, 0], rotation=math.pi / 2)]})

    def test_large_layout_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "200"):
            validate_layout({"items": [piece()] * 201})


if __name__ == "__main__":
    unittest.main()
