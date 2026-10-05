import os
import json
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException

from .database import SessionLocal
from .models import PlacedFurniture, Room
from .validation import validate_layout
from .realtime import socketio, update_hall_limits, players, players_lock
from .living_room import layout_version, validate_entrances, projector_table
from . import screens  # Register screen-sharing events on the existing Socket.IO server.
from .media import media_api
from .objects import objects_api
from .object_config import validate_media_references
from . import seating  # Seat reservations share the existing player connections.
from .hall import build_hall
from .spaces import spaces_api, space_rooms, membership, central_room
from .visitors import (
    can_edit_room,
    can_enter_room,
    current_visitor,
)

FRONTEND_DIR = Path(
    os.environ.get(
        "SOCIAL_ROOMS_FRONTEND_DIR", str(Path(__file__).resolve().parent.parent / "dist")
    )
)
# Serving the compiled frontend and API together avoids cross-origin configuration.
app = Flask(__name__, static_folder=str(FRONTEND_DIR / "assets"), static_url_path="/assets")
app.config["MAX_CONTENT_LENGTH"] = 22 * 1024 * 1024
app.config["ROOM_READ_ONLY"] = os.environ.get("ROOM_READ_ONLY", "false").lower() == "true"
# Forwarded headers are trusted only on the loopback server behind our tunnel.
if os.environ.get("TRUST_PROXY_HEADERS", "false").lower() == "true":
    from werkzeug.middleware.proxy_fix import ProxyFix

    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
from .auth import auth_api, protect_api

app.register_blueprint(auth_api)
app.before_request(protect_api)
socketio.init_app(app)
app.register_blueprint(media_api)
app.register_blueprint(objects_api)
app.register_blueprint(spaces_api)
app.config["AUTO_JOIN_GCI"] = os.environ.get("AUTO_JOIN_GCI", "false").lower() == "true"

# Configure an optional TURN relay here rather than hardcoding credentials into JS.
app.config["VOICE_ICE_SERVERS"] = json.loads(
    os.environ.get("VOICE_ICE_SERVERS", '[{"urls": "stun:stun.l.google.com:19302"}]')
)


@app.after_request
def disable_api_caching(response):
    # A room's permissions depend on its authenticated session, not just its URL.
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def frontend():
    if not (FRONTEND_DIR / "index.html").is_file():
        return {"error": "Build the frontend with npm run build before serving this URL."}, 503
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/api/health")
def health():
    # This checks HTTP only; GET /api/rooms/1 also checks the database connection.
    return {"status": "ok"}


@app.get("/api/voice-config")
def voice_config():
    with SessionLocal() as session:
        if current_visitor(session) is None:
            return {"error": "Log in before joining voice."}, 403
    # ICE credentials necessarily reach participating browsers; never return DB secrets.
    return {"iceServers": app.config["VOICE_ICE_SERVERS"]}


@app.get("/api/rooms/<int:room_id>")
def get_room(room_id):
    with SessionLocal() as session:
        if not can_enter_room(session, room_id):
            return {"error": "The bedroom is closed to visitors or you need to log in."}, 403
        room = session.get(Room, room_id)
        if room is None:
            return {"error": "Room not found."}, 404
        result = {
            **room.to_dict(),
            "readOnly": app.config["ROOM_READ_ONLY"] or not can_edit_room(session, room_id),
        }
        if room.is_central:
            result["hall"] = build_hall(space_rooms(session, room.space_id), room_id)
            update_hall_limits(result["hall"]["walkAreas"], room_id)
        return result


@app.patch("/api/rooms/<int:room_id>/access")
def room_access(room_id):
    payload = request.get_json()
    if (
        not isinstance(payload, dict)
        or set(payload) != {"isOpen"}
        or type(payload["isOpen"]) is not bool
    ):
        return {"error": "Indica si la habitación permite visitas."}, 400
    with SessionLocal.begin() as session:
        if (
            bool(session.get(Room, room_id) and session.get(Room, room_id).is_central)
            or app.config["ROOM_READ_ONLY"]
            or not can_edit_room(session, room_id)
        ):
            return {"error": "Solo el propietario puede cambiar el acceso."}, 403
        room = session.get(Room, room_id)
        room.is_open = payload["isOpen"]
    # Closing prevents NEW arrivals; visitors already inside can finish their visit.
    return {"isOpen": payload["isOpen"]}


@app.patch("/api/rooms/<int:room_id>/appearance")
def save_appearance(room_id):
    from .appearance import validate_appearance

    payload = request.get_json()
    with SessionLocal.begin() as session:
        if (
            bool(session.get(Room, room_id) and session.get(Room, room_id).is_central)
            or app.config["ROOM_READ_ONLY"]
            or not can_edit_room(session, room_id)
        ):
            return {"error": "Only the owner can change this room's style."}, 403
        room = session.scalar(select(Room).where(Room.id == room_id).with_for_update())
        if (
            not isinstance(payload, dict)
            or set(payload) != {"appearance", "revision"}
            or type(payload["revision"]) is not int
        ):
            return {"error": "Send room appearance and its saved revision."}, 400
        # A second owner session must review a newer style instead of silently overwriting it.
        if payload["revision"] != room.appearance_revision:
            return {
                "error": "The room style changed in another session. Reload the saved style before applying yours."
            }, 409
        try:
            room.appearance = validate_appearance(session, room_id, payload["appearance"])
        except ValueError as error:
            return {"error": str(error)}, 400
        room.appearance_revision += 1
        result = {
            "roomId": room_id,
            "appearance": room.appearance,
            "revision": room.appearance_revision,
        }
    # Publish only committed settings; a furniture PUT never writes these fields.
    socketio.emit("room_appearance", result, to=f"room:{room_id}")
    return result


@app.get("/api/rooms")
def list_rooms():
    with SessionLocal() as session:
        if current_visitor(session) is None:
            return {"error": "Log in before loading the bedroom directory."}, 403
        space_id = request.args.get("spaceId", 1, type=int)
        visitor = current_visitor(session)
        if not membership(session, space_id, visitor.id):
            return {"error": "Join this space before viewing its rooms."}, 403
        rooms = space_rooms(session, space_id)
        return {"rooms": [{"id": room.id, "name": room.name} for room in rooms]}


@app.post("/api/visitor")
def initialize_visitor():
    return {"error": "Name-only entry has been replaced by account login."}, 410


@app.put("/api/rooms/<int:room_id>")
def save_room(room_id):
    # Enforce this on the server too: hiding a button cannot protect a database write.
    if app.config["ROOM_READ_ONLY"]:
        return {"error": "Furniture saving is disabled for this public playtest."}, 403
    with SessionLocal() as session:
        if not can_edit_room(session, room_id):
            return {
                "error": "Only a living-room host or the bedroom owner can save this layout."
            }, 403
        is_central = session.get(Room, room_id).is_central
    payload = request.get_json()
    try:
        items = validate_layout(payload)
        if is_central:
            validate_entrances(items)
    except ValueError as error:
        return {"error": str(error)}, 400

    # One transaction covers the entire replacement. Exceptions roll it all back.
    # Share the seat lock so nobody can sit between the occupancy check and the commit.
    with players_lock:
        with SessionLocal.begin() as session:
            room = session.scalar(select(Room).where(Room.id == room_id).with_for_update())
            if room is None:
                return {"error": "Room not found."}, 404
            item_ids = [item["id"] for item in items]
            if item_ids and session.scalar(
                select(PlacedFurniture.id)
                .where(PlacedFurniture.id.in_(item_ids), PlacedFurniture.room_id != room_id)
                .limit(1)
            ):
                return {"error": "Furniture IDs must be unique across rooms."}, 400
            previous = {
                piece.id: piece
                for piece in session.scalars(
                    select(PlacedFurniture)
                    .where(PlacedFurniture.room_id == room_id)
                    .order_by(PlacedFurniture.id)
                    .with_for_update()
                ).all()
            }
            previous_records = [piece.to_dict() for piece in previous.values()]
            if is_central and payload.get("layoutVersion") != layout_version(previous_records):
                return {
                    "error": "The living room changed in another session. Discard your edits and reload before saving."
                }, 409
            proposed = {item["id"]: item for item in items}
            for player in players.values():
                if player["roomId"] != room_id or not player["pose"].get("seated"):
                    continue
                seat_id = player["pose"]["seatId"].rsplit(":", 1)[0]
                before, after = previous.get(seat_id), proposed.get(seat_id)
                if before is not None and (
                    after is None or layout_version([before.to_dict()]) != layout_version([after])
                ):
                    return {
                        "error": "Someone is sitting on a changed seat. Ask them to stand before saving."
                    }, 409
            for item in items:
                try:
                    validate_media_references(
                        session, room_id, item["type"], item.get("config", {})
                    )
                except ValueError as error:
                    return {"error": str(error)}, 400
                old = previous.get(item["id"])
                # Layout edits cannot erase visitors' drawings, messages, playback or cooldowns.
                if old and old.type == item["type"]:
                    item["state"] = old.state
                    item["config"] = old.config or item.get("config", {})
                    item["revision"] = old.revision
            # Finish deletes before inserts so unchanged IDs cannot collide with old rows.
            session.execute(delete(PlacedFurniture).where(PlacedFurniture.room_id == room_id))
            session.add_all(PlacedFurniture.from_record(room_id, item) for item in items)
            session.flush()
            result = room.to_dict()
            if is_central:
                result["hall"] = build_hall(space_rooms(session, room.space_id), room_id)

        if is_central and projector_table(previous_records) != projector_table(items):
            # A removed/moved projector table invalidates its live media session too.
            screens.clear_share_locked(room_id)

    # Reaching here means commit succeeded; only then report a successful save.
    socketio.emit("room_layout_changed", {"roomId": room_id}, to=f"room:{room_id}")
    return {**result, "readOnly": False}


@app.errorhandler(SQLAlchemyError)
def database_error(error):
    app.logger.exception("Database operation failed")
    return {
        "error": "Database operation failed. Check the Flask terminal and PostgreSQL connection."
    }, 503


@app.errorhandler(HTTPException)
def http_error(error):
    # JSON errors let React handle malformed JSON, missing routes, and wrong methods alike.
    return {"error": error.description}, error.code
