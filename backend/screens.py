"""One temporary projector per living room. Full video travels browser-to-browser."""

import math
import re
from time import monotonic
from uuid import uuid4
from flask import request
from flask_socketio import emit
from sqlalchemy import select
from .auth import require_live_session
from .realtime import socketio, players, players_lock, parse_media_signal
from .database import SessionLocal
from .models import PlacedFurniture

VIEW_DISTANCE = 2.5
PREVIEW_INTERVAL_SECONDS = 4.5
# Room keys isolate presenters, preview frames and viewers in different spaces.
projectors = {}


def screen_snapshot(room_id=1):
    state = projectors.get(room_id)
    return {
        "share": state["share"] if state else None,
        "preview": state["preview"] if state else None,
    }


def clear_share_locked(room_id=1):
    projectors.pop(room_id, None)
    socketio.emit("screen_state", screen_snapshot(room_id), to=f"room:{room_id}")


def leave_screen_locked(player_id):
    # The presence handler may already have removed the player entry.
    for room_id, state in list(projectors.items()):
        if state["share"]["id"] == player_id:
            clear_share_locked(room_id)
        elif player_id in state["viewers"]:
            state["viewers"].remove(player_id)
            emit(
                "screen_viewer_left",
                {"id": player_id, "sessionId": state["share"]["sessionId"]},
                to=state["share"]["id"],
            )


def central_player(player_id):
    entry = players.get(player_id)
    return entry if entry and entry["isCentral"] and entry["canVoice"] else None


def near_projector(entry):
    with SessionLocal() as session:
        table = session.scalar(
            select(PlacedFurniture)
            .where(PlacedFurniture.room_id == entry["roomId"], PlacedFurniture.type == "table")
            .order_by(PlacedFurniture.id)
            .limit(1)
        )
        if table is None:
            return False
        projector_x, projector_z = table.position_x, table.position_z
    x, _, z = entry["pose"]["position"]
    return math.hypot(x - projector_x, z - projector_z) <= VIEW_DISTANCE


@socketio.on("screen_start")
@require_live_session
def start_screen(_data=None):
    with players_lock:
        entry = central_player(request.sid)
        if entry is None:
            return {"ok": False, "error": "Screen sharing is available in the living room."}
        if not near_projector(entry):
            return {"ok": False, "error": "Walk closer to the projector to share your screen."}
        room_id = entry["roomId"]
        if room_id in projectors:
            return {"ok": False, "error": "Someone is already using the projector."}
        share = {"id": request.sid, "name": entry["pose"]["name"], "sessionId": str(uuid4())}
        projectors[room_id] = {
            "share": share,
            "preview": None,
            "lastPreviewAt": 0,
            "viewers": set(),
        }
        emit("screen_state", screen_snapshot(room_id), to=f"room:{room_id}")
        return {"ok": True, "share": share}


@socketio.on("screen_stop")
@require_live_session
def stop_screen(data):
    with players_lock:
        entry = central_player(request.sid)
        state = projectors.get(entry["roomId"]) if entry else None
        if (
            not isinstance(data, dict)
            or not state
            or state["share"]["id"] != request.sid
            or data.get("sessionId") != state["share"]["sessionId"]
        ):
            return {"ok": False}
        clear_share_locked(entry["roomId"])
        return {"ok": True}


@socketio.on("screen_preview")
@require_live_session
def update_preview(data):
    if not isinstance(data, dict):
        return {"ok": False}
    frame = data.get("frame")
    if (
        not isinstance(frame, str)
        or len(frame) > 12000
        or not re.fullmatch(r"data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}", frame)
    ):
        return {"ok": False}
    with players_lock:
        entry = central_player(request.sid)
        state = projectors.get(entry["roomId"]) if entry else None
        if (
            not state
            or state["share"]["id"] != request.sid
            or data.get("sessionId") != state["share"]["sessionId"]
        ):
            return {"ok": False}
        now = monotonic()
        if state["lastPreviewAt"] and now - state["lastPreviewAt"] < PREVIEW_INTERVAL_SECONDS:
            return {"ok": False}
        state.update(preview=frame, lastPreviewAt=now)
        emit(
            "screen_preview",
            {"sessionId": state["share"]["sessionId"], "frame": frame},
            to=f"room:{entry['roomId']}",
        )
        return {"ok": True}


@socketio.on("screen_watch")
@require_live_session
def watch_screen(data):
    if not isinstance(data, dict) or type(data.get("watching")) is not bool:
        return {"ok": False}
    with players_lock:
        entry = central_player(request.sid)
        state = projectors.get(entry["roomId"]) if entry else None
        if not state or data.get("sessionId") != state["share"]["sessionId"]:
            return {"ok": False, "error": "This screen share has ended."}
        if not data["watching"]:
            if request.sid != state["share"]["id"]:
                leave_screen_locked(request.sid)
            return {"ok": True}
        if not near_projector(entry):
            return {"ok": False, "error": "Walk closer to the projector to view the screen."}
        if request.sid != state["share"]["id"] and request.sid not in state["viewers"]:
            state["viewers"].add(request.sid)
            emit(
                "screen_viewer_joined",
                {"id": request.sid, "sessionId": state["share"]["sessionId"]},
                to=state["share"]["id"],
            )
        return {"ok": True}


@socketio.on("screen_signal")
@require_live_session
def relay_screen_signal(data):
    if not isinstance(data, dict) or not isinstance(data.get("to"), str):
        return {"ok": False}
    signal = parse_media_signal(data)
    if signal is None:
        return {"ok": False}
    with players_lock:
        sender, target = central_player(request.sid), central_player(data["to"])
        if not sender or not target or sender["roomId"] != target["roomId"]:
            return {"ok": False}
        state = projectors.get(sender["roomId"])
        if not state or data.get("sessionId") != state["share"]["sessionId"]:
            return {"ok": False}
        pair = {request.sid, data["to"]}
        if (
            len(pair) != 2
            or state["share"]["id"] not in pair
            or not (pair - {state["share"]["id"]}).issubset(state["viewers"])
        ):
            return {"ok": False}
        emit(
            "screen_signal",
            {"from": request.sid, "sessionId": state["share"]["sessionId"], **signal},
            to=data["to"],
        )
        return {"ok": True}
