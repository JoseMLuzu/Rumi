"""Persistent configuration and authoritative, bounded room-object interactions."""

from .auth import require_live_session

import math
import random
import time
from uuid import uuid4
from flask import Blueprint, request, current_app
from flask_socketio import emit
from sqlalchemy import select
from .database import SessionLocal
from .models import PlacedFurniture, MediaAsset, Room, radio_status
from .validation import OBJECTS, finite_number
from .object_config import validate_config, validate_media_references
from .visitors import can_edit_room, can_enter_room, current_visitor
from .realtime import socketio, players, players_lock

objects_api = Blueprint("objects", __name__)
COOLDOWNS = {
    "toggle": 1,  # Prevent rapid light changes even if a client bypasses the UI.
    "feed": 8,
    "greet": 5,
    "surprise": 5,
    "open": 5,
    "squeak": 2,
    "wave": 2,
    "water": 4,
    "toast": 5,
    "straighten": 4,
    "step": 3,
    "snack": 3,
}
DURATIONS = {
    "feed": 5,
    "greet": 3,
    "surprise": 4,
    "open": 3,
    "squeak": 1,
    "wave": 2,
    "water": 3,
    "toast": 3,
    "straighten": 3,
    "step": 1,
    "snack": 2,
    "consume": 1,
    "darts": 2,
}


def object_record(session, room_id, item_id, lock=False):
    statement = select(PlacedFurniture).where(
        PlacedFurniture.room_id == room_id, PlacedFurniture.id == item_id
    )
    return session.scalar(statement.with_for_update() if lock else statement)


@objects_api.patch("/api/rooms/<int:room_id>/objects/<item_id>")
def configure(room_id, item_id):
    if current_app.config["ROOM_READ_ONLY"]:
        return {"error": "La decoración está desactivada."}, 403
    payload = request.get_json()
    with SessionLocal.begin() as session:
        if not can_edit_room(session, room_id):
            return {"error": "Solo el propietario puede configurar este objeto."}, 403
        item = object_record(session, room_id, item_id, True)
        if item is None:
            return {"error": "Guarda el objeto en la habitación antes de configurarlo."}, 404
        if (
            not isinstance(payload, dict)
            or type(payload.get("revision")) is not int
            or payload["revision"] != item.revision
        ):
            return {
                "error": "El objeto cambió en otra sesión. Cierra y vuelve a abrir el panel para cargar la versión actual."
            }, 409
        try:
            config = validate_config(item.type, payload.get("config"))
            validate_media_references(session, room_id, item.type, config)
        except ValueError as error:
            return {"error": str(error)}, 400
        previous_config = item.config
        item.config = config
        state = dict(item.state)
        if item.type == "photoFrame":
            state["photoAt"] = time.time()
        if item.type == "retroRadio" and config.get("tracks") != (previous_config or {}).get(
            "tracks"
        ):
            state.pop("radio", None)
        item.state = state
        item.revision += 1
        session.flush()
        result = item.to_dict()
        kind = item.type
    if kind in ("handChair", "plasticThrone"):
        with players_lock:
            for entry in players.values():
                if (
                    entry["roomId"] == room_id
                    and entry["pose"].get("seated")
                    and entry["pose"].get("seatId") == f"{item_id}:0"
                ):
                    entry["pose"]["seatPose"] = config["pose"]
                    socketio.emit(
                        "player_posture_changed", dict(entry["pose"]), to=f"room:{room_id}"
                    )
    socketio.emit("object_update", result, to=f"room:{room_id}")
    return result


@objects_api.get("/api/inventory")
def inventory():
    with SessionLocal() as session:
        if not current_visitor(session):
            return {"error": "Entra con tu nombre."}, 403
    # This is the existing free decoration collection, not an invented economy.
    from .validation import FOOTPRINTS

    return {
        "items": [
            {
                "type": key,
                "name": OBJECTS.get(key, {}).get("label", key),
                "description": OBJECTS.get(key, {}).get("description", "Mueble de la colección"),
                "provenance": "Colección gratuita de Social Rooms",
            }
            for key in FOOTPRINTS
        ]
    }


def apply_action(session, entry, item, data):
    action = data.get("action")
    if not isinstance(action, str):
        raise ValueError("Selecciona una acción válida.")
    owner = can_edit_room(session, entry["roomId"])
    visitor = current_visitor(session)
    if visitor is None:
        raise ValueError("Entra con tu nombre para interactuar.")
    if action in ("deleteEntry", "clearBoard", "deleteDrawing"):
        if not owner:
            raise ValueError("Solo el propietario puede borrar aportaciones.")
        if item.type not in ("guestBook", "visitorBoard"):
            raise ValueError("Este objeto no tiene aportaciones.")
    elif action not in OBJECTS.get(item.type, {}).get("actions", []):
        raise ValueError("Esta acción no pertenece al objeto.")
    now = time.time()
    if action == "pause" and data.get("ended") is True:
        radio = item.state.get("radio", {})
        # An automatic end may arrive after the listener walks away, but cannot stop a live track early.
        if radio.get("playing") and (
            not radio.get("duration") or radio_status(radio, now).get("playing")
        ):
            raise ValueError("La pista todavía no ha terminado.")
        item.state = {**item.state, "radio": {**radio_status(radio, now), "playing": False}}
        item.revision += 1
        session.flush()
        return {"item": item.to_dict()}
    position = entry["pose"]["position"]
    reach = 1.9 + max(OBJECTS[item.type]["width"], OBJECTS[item.type]["depth"]) * item.scale / 2
    if math.hypot(position[0] - item.position_x, position[2] - item.position_z) > reach:
        raise ValueError("Acércate al objeto para usarlo.")
    now = time.time()
    state = dict(item.state)
    cooldowns = dict(state.get("cooldowns", {}))
    if now < cooldowns.get(action, 0):
        raise ValueError("Espera un momento antes de volver a usarlo.")
    if action in COOLDOWNS:
        cooldowns[action] = now + COOLDOWNS[action]
    if action in DURATIONS:
        active_effects = [
            other
            for other in session.scalars(
                select(PlacedFurniture).where(PlacedFurniture.room_id == entry["roomId"])
            ).all()
            if other.id != item.id and other.state.get("effect", {}).get("expires", 0) > now
        ]
        if len(active_effects) >= 4:
            raise ValueError("Ya hay varias reacciones activas. Espera a que termine una reacción.")
    state["cooldowns"] = cooldowns
    result = {}
    if action in ("draw", "message"):
        if current_app.config["ROOM_READ_ONLY"]:
            raise ValueError("Las aportaciones están desactivadas.")
        if type(data.get("revision")) is not int or data["revision"] != item.revision:
            raise ValueError(
                "Otra persona guardó antes. Recarga las aportaciones antes de guardar tu dibujo o mensaje."
            )
        text = data.get("text", "").strip() if isinstance(data.get("text", ""), str) else None
        if text is None or len(text) > 300 or (action == "message" and not text):
            raise ValueError("Escribe un mensaje de 1 a 300 caracteres.")
        key = "drawings" if action == "draw" else "entries"
        posts = list(state.get(key, []))
        if len(posts) >= (10 if action == "draw" else 100):
            raise ValueError("El propietario debe borrar aportaciones antes de añadir más.")
        post = {"id": uuid4().hex, "author": entry["pose"]["name"], "date": now, "text": text}
        if action == "draw":
            url = data.get("url", "")
            asset = (
                session.get(MediaAsset, url.rsplit("/", 1)[-1]) if isinstance(url, str) else None
            )
            if (
                not asset
                or asset.room_id != entry["roomId"]
                or asset.uploader != visitor.id
                or not asset.mime.startswith("image/")
            ):
                raise ValueError("Sube primero un dibujo válido para esta habitación.")
            post["url"] = "/api/media/" + asset.id
        posts.append(post)
        state[key] = posts
    elif action in ("deleteEntry", "deleteDrawing", "clearBoard"):
        key = "entries" if item.type == "guestBook" else "drawings"
        state[key] = (
            []
            if action == "clearBoard"
            else [p for p in state.get(key, []) if p["id"] != data.get("entryId")]
        )
    elif action == "toggle":
        state["active"] = not state.get("active", False)
    elif action in ("play", "pause"):
        tracks = item.config.get("tracks", [])
        if not tracks:
            raise ValueError("El propietario debe subir un archivo de audio primero.")
        if (
            action == "play"
            and sum(
                other.type == "retroRadio"
                and other.id != item.id
                and radio_status(other.state.get("radio", {}), now).get("playing", False)
                for other in session.scalars(
                    select(PlacedFurniture).where(PlacedFurniture.room_id == entry["roomId"])
                ).all()
            )
            >= 4
        ):
            raise ValueError("Pausa otra radio antes de reproducir más de cuatro pistas a la vez.")
        previous = radio_status(state.get("radio", {}), now)
        index = data.get("index", previous.get("index", 0))
        position = data.get(
            "position",
            previous.get("position", 0)
            + (now - previous.get("updatedAt", now) if previous.get("playing") else 0),
        )
        if (
            type(index) is not int
            or not 0 <= index < len(tracks)
            or not finite_number(position)
            or not 0 <= position <= 21600
        ):
            raise ValueError("Pista o posición no válida.")
        duration = tracks[index].get("duration")
        if action == "play" and duration and position >= duration:
            position = 0
        state["radio"] = {
            "index": index,
            "position": position,
            "playing": action == "play",
            "updatedAt": now,
            **({"duration": duration} if duration else {}),
        }
    elif action == "next":
        count = len(item.config.get("images", []))
        state["photoIndex"] = (
            state.get("photoIndex", 0) + (-1 if data.get("direction") == -1 else 1)
        ) % max(1, count)
        state["photoAt"] = now
    elif action == "visit":
        destination = item.config.get("destination")
        room = session.get(Room, destination) if destination else None
        if room is None or not can_enter_room(session, destination):
            raise ValueError("El destino está cerrado, no existe o todavía no está configurado.")
        result["destination"] = {"id": room.id, "name": room.name}
    elif action == "darts":
        hits = data.get("hits")
        if (
            not isinstance(hits, list)
            or len(hits) != 3
            or not all(
                isinstance(h, list)
                and len(h) == 2
                and all(finite_number(x) and abs(x) <= 1.5 for x in h)
                for h in hits
            )
        ):
            raise ValueError("Lanza exactamente tres dardos.")
        scores = []
        for x, y in hits:
            r = math.hypot(x, y)
            scores.append(
                50
                if r < 0.08
                else (
                    25
                    if r < 0.16
                    else (
                        20 if r < 0.3 else 10 if r < 0.52 else 5 if r < 0.72 else 1 if r <= 1 else 0
                    )
                )
            )
        result.update(scores=scores, total=sum(scores))
    elif action in ("mirror", "removeEffect"):
        effect = data.get("effect", "hat")
        if effect not in ("hat", "glasses", "color"):
            raise ValueError("Efecto desconocido.")
        entry["pose"]["cosmetic"] = effect if action == "mirror" else None
        entry["pose"]["cosmeticExpires"] = now + 120 if action == "mirror" else 0
        result["player"] = dict(entry["pose"])
    elif action == "snack":
        snack = data.get("snack")
        if snack not in ("chips", "juice", "cookie"):
            raise ValueError("Selecciona un snack disponible.")
        entry["pose"]["snack"] = snack
        entry["pose"]["snackExpires"] = now + 30
        result["player"] = dict(entry["pose"])
    elif action == "consume":
        if not entry["pose"].get("snack") or now >= entry["pose"].get("snackExpires", 0):
            raise ValueError("Primero recoge un snack.")
        entry["pose"]["snack"] = None
        entry["pose"]["snackExpires"] = 0
        entry["pose"]["reaction"] = {"kind": "happy", "expires": now + 1}
        result["player"] = dict(entry["pose"])
    if action in DURATIONS:
        state["effect"] = {
            "action": action,
            "at": now,
            "expires": now + DURATIONS[action],
            "seed": random.randrange(100000),
            "actor": entry["pose"]["id"],
            "name": entry["pose"]["name"],
            "variant": (
                random.choice(["confetti", "ducks", "lights"])
                if action == "surprise"
                else (
                    (state.get("effect", {}).get("variant", -1) + 1) % 3
                    if action == "greet"
                    else random.randrange(3)
                )
            ),
            **({"total": result["total"]} if action == "darts" else {}),
        }
    item.state = state
    item.revision += 1
    session.flush()
    return {**result, "item": item.to_dict()}


@socketio.on("object_action")
@require_live_session
def interact(data):
    if not isinstance(data, dict) or not isinstance(data.get("itemId"), str):
        return {"ok": False, "error": "Selecciona un objeto."}
    if data.get("action") == "sit":
        from .seating import sit_player

        return sit_player({"itemId": data["itemId"], "slot": data.get("slot", 0)})
    # The player lock protects identity/position while the row lock serializes concurrent edits.
    with players_lock:
        entry = players.get(request.sid)
        if entry is None:
            return {"ok": False, "error": "Reconecta con la habitación."}
        previous_pose = dict(entry["pose"])
        try:
            with SessionLocal.begin() as session:
                item = object_record(session, entry["roomId"], data["itemId"], True)
                if item is None or item.type not in OBJECTS:
                    raise ValueError("Este objeto ya no está en la habitación.")
                result = apply_action(session, entry, item, data)
        except ValueError as error:
            entry["pose"] = previous_pose
            return {"ok": False, "error": str(error)}
        except Exception:
            entry["pose"] = previous_pose
            current_app.logger.exception("Object action failed")
            return {"ok": False, "error": "No se pudo guardar la interacción. Inténtalo de nuevo."}
        emit("object_update", result["item"], to=f"room:{entry['roomId']}")
        if result.get("player"):
            emit("player_posture_changed", result["player"], to=f"room:{entry['roomId']}")
        return {"ok": True, **result}
