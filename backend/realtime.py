import math
import secrets
from threading import Lock

from flask import request
from flask_socketio import SocketIO, emit, join_room
from sqlalchemy import select

from .validation import PLAYER_RADIUS, ROOM_EDGE, finite_number, OBJECTS
from .database import SessionLocal
from .models import Room, PlacedFurniture
from .hall import build_hall
from .visitors import can_enter_room, current_visitor
from .auth import current_session, require_live_session
from .spaces import space_rooms

# Use ordinary Python threads, without adding eventlet/gevent for this small server.
socketio = SocketIO(async_mode="threading", async_handlers=False, max_http_buffer_size=16384)
players = {}
players_lock = Lock()
hall_walk_areas = build_hall([])["walkAreas"]
hall_limits = {1: hall_walk_areas}


def update_hall_limits(areas, room_id=1):
    with players_lock:
        # Each living room has different members/corridors; never share its bounds.
        if room_id == 1:
            hall_walk_areas[:] = areas
        hall_limits[room_id] = areas if room_id != 1 else hall_walk_areas


def validate_pose(data, walk_areas=None):
    if not isinstance(data, dict):
        return None
    position, rotation = data.get("position"), data.get("rotation")
    edge = ROOM_EDGE - PLAYER_RADIUS
    if (
        not isinstance(position, list)
        or len(position) != 3
        or not all(finite_number(value) for value in position)
        or position[1] != 0
        or not finite_number(rotation)
        or abs(rotation) > math.pi
    ):
        return None
    x, _, z = position
    if walk_areas is None:
        if abs(x) > edge or abs(z) > edge:
            return None
    elif not any(
        area["minX"] + PLAYER_RADIUS <= x <= area["maxX"] - PLAYER_RADIUS
        and area["minZ"] + PLAYER_RADIUS <= z <= area["maxZ"] - PLAYER_RADIUS
        for area in walk_areas
    ):
        return None
    return {"position": list(position), "rotation": rotation}


@socketio.on("connect")
def connect_player(auth):
    if not isinstance(auth, dict) or type(auth.get("roomId")) is not int or auth["roomId"] < 1:
        return False
    room_id = auth["roomId"]
    with SessionLocal() as session:
        if not can_enter_room(session, room_id) or session.get(Room, room_id) is None:
            return False
        visitor = current_visitor(session)
        auth_session = current_session(session)
        csrf = auth.get("csrfToken", "")
        if (
            not visitor
            or not auth_session
            or not isinstance(csrf, str)
            or not secrets.compare_digest(csrf.encode(), auth_session.csrf_token.encode())
        ):
            return False
        session_hash = auth_session.token_hash
        name = visitor.display_name or (
            visitor.room.name.removesuffix("’s bedroom") if visitor.room else visitor.id
        )
        can_voice = visitor is not None
        room = session.get(Room, room_id)
        is_central = room.is_central
        space_id = room.space_id
        hall = build_hall(space_rooms(session, space_id), room_id) if is_central else None
    if hall:
        update_hall_limits(hall["walkAreas"], room_id)
    pose = validate_pose(auth, hall["walkAreas"] if hall else None)
    if pose is None:
        return False
    # The connection owns its ID; clients cannot move another player's avatar.
    player = {"id": request.sid, "name": name, "voiceEnabled": False, "voiceMuted": False, **pose}
    channel = f"room:{room_id}"
    join_room(channel)
    # Different connections run on different threads; protect snapshot/update ordering.
    with players_lock:
        players[request.sid] = {
            "roomId": room_id,
            "spaceId": space_id,
            "isCentral": is_central,
            "pose": player,
            "canVoice": can_voice,
            "sessionHash": session_hash,
        }
        snapshot = [entry["pose"] for entry in players.values() if entry["roomId"] == room_id]
        emit("room_state", {"roomId": room_id, "players": snapshot})
        with SessionLocal() as session:
            object_snapshot = [
                piece.to_dict()
                for piece in session.scalars(
                    select(PlacedFurniture).where(PlacedFurniture.room_id == room_id)
                ).all()
                if piece.type in OBJECTS
            ]
            saved_room = session.get(Room, room_id).to_dict()
            emit(
                "room_appearance",
                {
                    "roomId": room_id,
                    "appearance": saved_room["appearance"],
                    "revision": saved_room["appearanceRevision"],
                },
            )
        emit("object_snapshot", {"items": object_snapshot})
        if is_central:
            from .screens import screen_snapshot

            emit("screen_state", screen_snapshot(room_id))
        emit("player_joined", player, to=channel, include_self=False)


@socketio.on("player_move")
@require_live_session
def move_player(data):
    with players_lock:
        if request.sid not in players:
            return {"ok": False}
        entry = players[request.sid]
        if entry["pose"].get("seated"):
            return {"ok": False}
        # Each player's server-owned room determines which floor bounds apply.
        pose = validate_pose(data, hall_limits.get(entry["roomId"]) if entry["isCentral"] else None)
        if pose is None:
            return {"ok": False}
        # Movement cannot replace the name or voice flags supplied by the server.
        player = {**entry["pose"], **pose}
        entry["pose"] = player
        emit("player_moved", player, to=f"room:{entry['roomId']}", include_self=False)
    return {"ok": True}


@socketio.on("voice_state")
@require_live_session
def set_voice_state(data):
    if (
        not isinstance(data, dict)
        or type(data.get("enabled")) is not bool
        or type(data.get("muted")) is not bool
    ):
        return {"ok": False}
    with players_lock:
        entry = players.get(request.sid)
        if entry is None or not entry["canVoice"]:
            return {"ok": False}
        flags = {
            "id": request.sid,
            "voiceEnabled": data["enabled"],
            "voiceMuted": data["enabled"] and data["muted"],
        }
        entry["pose"].update(flags)
        emit("player_voice_changed", flags, to=f"room:{entry['roomId']}")
    return {"ok": True}


def parse_media_signal(data):
    # Voice and screen sharing accept bounded descriptions/candidates, never arbitrary events.
    description, candidate = data.get("description"), data.get("candidate")
    if "description" in data and "candidate" not in data:
        if (
            not isinstance(description, dict)
            or description.get("type") not in ("offer", "answer")
            or not isinstance(description.get("sdp"), str)
            or not 0 < len(description["sdp"]) <= 12000
        ):
            return None
        signal = {"description": {"type": description["type"], "sdp": description["sdp"]}}
    elif "candidate" in data and "description" not in data:
        if (
            not isinstance(candidate, dict)
            or not isinstance(candidate.get("candidate"), str)
            or len(candidate["candidate"]) > 2048
            or not isinstance(candidate.get("sdpMid"), (str, type(None)))
            or (
                candidate.get("sdpMLineIndex") is not None
                and (
                    type(candidate["sdpMLineIndex"]) is not int
                    or not 0 <= candidate["sdpMLineIndex"] <= 10
                )
            )
        ):
            return None
        signal = {
            "candidate": {
                key: candidate.get(key) for key in ("candidate", "sdpMid", "sdpMLineIndex")
            }
        }
    else:
        return None
    return signal


@socketio.on("voice_signal")
@require_live_session
def relay_voice_signal(data):
    if not isinstance(data, dict) or not isinstance(data.get("to"), str):
        return {"ok": False}
    signal = parse_media_signal(data)
    if signal is None:
        return {"ok": False}
    with players_lock:
        sender, target = players.get(request.sid), players.get(data["to"])
        if (
            sender is None
            or target is None
            or request.sid == data["to"]
            or sender["roomId"] != target["roomId"]
            or not sender["pose"]["voiceEnabled"]
            or not target["pose"]["voiceEnabled"]
        ):
            return {"ok": False}
        a, b = sender["pose"]["position"], target["pose"]["position"]
        # Setup is restricted to nearby participants. Audio itself never passes through Flask.
        if math.hypot(a[0] - b[0], a[2] - b[2]) > 10:
            return {"ok": False}
        emit("voice_signal", {"from": request.sid, **signal}, to=data["to"])
    return {"ok": True}


@socketio.on("disconnect")
def disconnect_player(_reason):
    with players_lock:
        from .screens import leave_screen_locked

        leave_screen_locked(request.sid)
        entry = players.pop(request.sid, None)
        if entry is not None:
            emit(
                "player_left", {"id": request.sid}, to=f"room:{entry['roomId']}", include_self=False
            )
