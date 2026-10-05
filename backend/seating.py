"""Temporary, server-owned seat reservations on the existing player connections."""

from .auth import require_live_session

import math

from flask import request
from flask_socketio import emit
from sqlalchemy import select

from .database import SessionLocal
from .models import PlacedFurniture
from .realtime import socketio, players, players_lock, validate_pose, hall_limits
from .validation import bounds, PLAYER_RADIUS, OBJECTS


def seat_pose(item, slot):
    offsets = (
        [(0, 0.04)]
        if item.type == "chair"
        else [(-0.55, 0.1), (0.55, 0.1)] if item.type == "sofa" else []
    )
    if item.type in ("handChair", "plasticThrone"):
        offsets = [(0, 0.04)]
    if item.type == "chaiseLongue":
        # Match the front-edge cushion position used by src/seating.js.
        offsets = [(0, 0.16)]
    if type(slot) is not int or not 0 <= slot < len(offsets):
        return None
    x, z = [n * item.scale for n in offsets[slot]]
    angle = item.rotation
    return {
        "position": [
            item.position_x + x * math.cos(angle) + z * math.sin(angle),
            0,
            item.position_z - x * math.sin(angle) + z * math.cos(angle),
        ],
        "rotation": math.atan2(math.sin(angle), math.cos(angle)),
        "seated": True,
        "seatId": f"{item.id}:{slot}",
        "seatHeight": (
            0.69
            if item.type == "chair"
            else (
                0.72
                if item.type == "sofa"
                else 0.42 if item.type == "chaiseLongue" else OBJECTS[item.type]["seatHeight"]
            )
        )
        * item.scale,
        "seatPose": item.config.get("pose", "normal"),
        "crown": item.type == "plasticThrone",
    }


def can_stand(position, items, room_id):
    areas = hall_limits.get(room_id)
    if validate_pose({"position": position, "rotation": 0}, areas) is None:
        return False
    rectangles = [
        bounds(item.to_dict()) for item in items if OBJECTS.get(item.type, {}).get("blocking", True)
    ]
    x, _, z = position
    for min_x, max_x, min_z, max_z in rectangles:
        nearest_x = max(min_x, min(max_x, x))
        nearest_z = max(min_z, min(max_z, z))
        if (x - nearest_x) ** 2 + (z - nearest_z) ** 2 < PLAYER_RADIUS**2:
            return False
    return True


@socketio.on("player_sit")
@require_live_session
def sit_player(data):
    if not isinstance(data, dict) or not isinstance(data.get("itemId"), str):
        return {"ok": False, "error": "Choose a chair or sofa."}
    # Checking availability and assigning a seat must happen under the same lock.
    with players_lock:
        entry = players.get(request.sid)
        if entry is None or entry["pose"].get("seated"):
            return {"ok": False, "error": "Stand up before choosing another seat."}
        with SessionLocal() as session:
            item = session.scalar(
                select(PlacedFurniture).where(
                    PlacedFurniture.id == data["itemId"], PlacedFurniture.room_id == entry["roomId"]
                )
            )
            pose = seat_pose(item, data.get("slot")) if item is not None else None
        if pose is None:
            return {"ok": False, "error": "That seat is unavailable."}
        current = entry["pose"]["position"]
        if math.hypot(current[0] - pose["position"][0], current[2] - pose["position"][2]) > 1.8:
            return {"ok": False, "error": "Walk closer to the seat."}
        if any(
            other["roomId"] == entry["roomId"]
            and other["pose"].get("seated")
            and other["pose"].get("seatId") == pose["seatId"]
            for other in players.values()
        ):
            return {"ok": False, "error": "Someone is already sitting there."}
        entry["seatReturn"] = list(current)
        entry["pose"] = {**entry["pose"], **pose}
        emit("player_posture_changed", entry["pose"], to=f"room:{entry['roomId']}")
        return {"ok": True, "player": entry["pose"]}


@socketio.on("player_stand")
@require_live_session
def stand_player(_data=None):
    with players_lock:
        entry = players.get(request.sid)
        if entry is None:
            return {"ok": False, "error": "Reconnect to the room first."}
        if not entry["pose"].get("seated"):
            return {"ok": True, "player": entry["pose"]}
        with SessionLocal() as session:
            items = session.scalars(
                select(PlacedFurniture).where(PlacedFurniture.room_id == entry["roomId"])
            ).all()
        x, _, z = entry["pose"]["position"]
        candidates = [entry["seatReturn"]]
        # Try nearby floor if an owner moved furniture into the original standing spot.
        for radius in (0.8, 1.1, 1.4, 1.7, 2):
            for step in range(8):
                angle = step * math.pi / 4
                candidates.append([x + math.sin(angle) * radius, 0, z + math.cos(angle) * radius])
        for xi in range(-9, 10):
            for zi in range(-9, 10):
                candidates.append([xi / 2, 0, zi / 2])
        position = next(
            (point for point in candidates if can_stand(point, items, entry["roomId"])), None
        )
        if position is None:
            return {
                "ok": False,
                "error": "There is no clear floor nearby. Ask the owner to leave some space.",
            }
        entry["pose"] = {
            **entry["pose"],
            "position": position,
            "seated": False,
            "seatId": None,
            "seatHeight": 0,
            "crown": False,
            "seatPose": "normal",
        }
        entry.pop("seatReturn", None)
        emit("player_posture_changed", entry["pose"], to=f"room:{entry['roomId']}")
        return {"ok": True, "player": entry["pose"]}
