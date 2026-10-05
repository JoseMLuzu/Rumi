import math
import json
from pathlib import Path

OBJECTS = json.loads((Path(__file__).resolve().parents[1] / "src/data/objects.json").read_text())


# These footprints match src/data/furniture.js. Keep them aligned when adding a type.
FOOTPRINTS = {
    "bed": (2.2, 3.2),
    "chair": (0.95, 1.05),
    "table": (1.8, 1.4),
    "bookTable": (1.8, 1.4),
    "sofa": (2.7, 1.15),
    "plant": (0.8, 0.8),
    "lamp": (0.65, 0.65),
    "poolDoll": (1.1, 0.45),
    "chaiseLongue": (2.05, 0.85),
}
FOOTPRINTS.update({key: (entry["width"], entry["depth"]) for key, entry in OBJECTS.items()})
ROOM_EDGE = 4.9
PLAYER_RADIUS = 0.35
QUARTER_TURN = math.pi / 2


def finite_number(value):
    # Python treats booleans as integers, but true/false are not coordinates.
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def bounds(item):
    width, depth = FOOTPRINTS[item["type"]]
    width *= item.get("scale", 1)
    depth *= item.get("scale", 1)
    if round(item["rotation"] / QUARTER_TURN) % 2:
        width, depth = depth, width
    x, _, z = item["position"]
    return x - width / 2, x + width / 2, z - depth / 2, z + depth / 2


def has_player_spawn(rectangles):
    # Match the frontend's spawn search so an accepted layout can be played.
    for step in range(10):
        for xi in range(-step, step + 1):
            for zi in range(-step, step + 1):
                if abs(xi) != step and abs(zi) != step:
                    continue
                x, z = xi / 2, zi / 2
                blocked = False
                for min_x, max_x, min_z, max_z in rectangles:
                    nearest_x = max(min_x, min(max_x, x))
                    nearest_z = max(min_z, min(max_z, z))
                    if (x - nearest_x) ** 2 + (z - nearest_z) ** 2 < PLAYER_RADIUS**2:
                        blocked = True
                        break
                if not blocked:
                    return True
    return False


def validate_layout(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("Send a JSON object with an items array.")
    if len(payload["items"]) > 200:
        raise ValueError("A development room supports at most 200 pieces.")

    items, ids, rectangles = [], set(), []
    for index, item in enumerate(payload["items"]):
        label = f"items[{index}]"
        if not isinstance(item, dict):
            raise ValueError(f"{label} must be an object.")
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id.strip() or len(item_id) > 100:
            raise ValueError(f"{label} needs a nonempty id of at most 100 characters.")
        if item_id in ids:
            raise ValueError(f"Duplicate furniture id: {item_id}.")
        furniture_type = item.get("type")
        if not isinstance(furniture_type, str) or furniture_type not in FOOTPRINTS:
            raise ValueError(f"{label} has an unknown furniture type.")
        position = item.get("position")
        if (
            not isinstance(position, list)
            or len(position) != 3
            or not all(finite_number(value) for value in position)
            or position[1] != 0
        ):
            raise ValueError(f"{label}.position must be three finite numbers with y = 0.")
        rotation = item.get("rotation")
        if not finite_number(rotation) or not 0 <= rotation < 2 * math.pi:
            raise ValueError(f"{label}.rotation must be between 0 and 2π radians.")
        turns = round(rotation / QUARTER_TURN)
        if not math.isclose(rotation, turns * QUARTER_TURN, abs_tol=1e-7):
            raise ValueError(f"{label}.rotation must be a quarter turn.")

        clean = {
            "id": item_id,
            "type": furniture_type,
            "position": list(position),
            "rotation": (turns % 4) * QUARTER_TURN,
        }
        scale = item.get("scale", 1)
        if not finite_number(scale) or not 0.5 <= scale <= 2:
            raise ValueError("Object scale must be between 0.5 and 2.")
        if scale != 1:
            clean["scale"] = scale
        if "config" in item:
            from .object_config import validate_config

            clean["config"] = validate_config(furniture_type, item["config"])
        rectangle = bounds(clean)
        min_x, max_x, min_z, max_z = rectangle
        if min_x < -ROOM_EDGE or max_x > ROOM_EDGE or min_z < -ROOM_EDGE or max_z > ROOM_EDGE:
            raise ValueError(f"{label} must fit inside the room.")
        if any(
            min_x < other[1] + 0.05
            and max_x > other[0] - 0.05
            and min_z < other[3] + 0.05
            and max_z > other[2] - 0.05
            for other in rectangles
        ):
            raise ValueError("Leave space between furniture pieces.")
        items.append(clean)
        rectangles.append(rectangle)
        ids.add(item_id)

    blocking_rectangles = [
        rectangle
        for item, rectangle in zip(items, rectangles)
        if OBJECTS.get(item["type"], {}).get("blocking", True)
    ]
    if not has_player_spawn(blocking_rectangles):
        raise ValueError("Leave enough space for the player to spawn.")
    return items
