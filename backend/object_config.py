"""The registry declares what exists; this validator declares what clients may save."""

import re
from .validation import OBJECTS, FOOTPRINTS, finite_number

IMAGE_TYPES = {"poster", "photoFrame", "crookedPicture"}


def validate_config(kind, config):
    if not isinstance(config, dict):
        raise ValueError("La configuración debe ser un objeto JSON.")
    allowed = set(OBJECTS.get(kind, {}).get("defaults", {}))
    if set(config) - allowed:
        raise ValueError("Esta configuración no pertenece al objeto.")
    result = {**OBJECTS.get(kind, {}).get("defaults", {}), **config}
    for key, value in result.items():
        if key in ("color", "frameColor") and (
            not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value)
        ):
            raise ValueError("Usa un color hexadecimal válido.")
        if key == "intensity" and (not finite_number(value) or not 0 <= value <= 2):
            raise ValueError("La intensidad debe estar entre 0 y 2.")
        if key == "interval" and (not finite_number(value) or not 2 <= value <= 60):
            raise ValueError("El intervalo debe estar entre 2 y 60 segundos.")
        if key in ("ambient", "slideshow") and type(value) is not bool:
            raise ValueError("El interruptor debe ser verdadero o falso.")
        if key == "fit" and value not in ("contain", "cover"):
            raise ValueError("El ajuste debe ser contain o cover.")
        if key == "crop" and (
            not isinstance(value, list)
            or len(value) != 2
            or not all(finite_number(x) and 0 <= x <= 1 for x in value)
        ):
            raise ValueError("El recorte debe estar entre 0 y 1.")
        if key == "scene" and value not in ("space", "rain", "beach", "sea"):
            raise ValueError("Paisaje desconocido.")
        if key == "pose" and value not in ("normal", "relaxed", "wave"):
            raise ValueError("Pose desconocida.")
        if key == "fishNames" and (
            not isinstance(value, list)
            or len(value) != 3
            or not all(isinstance(x, str) and 1 <= len(x.strip()) <= 24 for x in value)
        ):
            raise ValueError("Escribe tres nombres de 1 a 24 caracteres.")
        if key == "destination" and value is not None and (type(value) is not int or value < 1):
            raise ValueError("Selecciona una habitación válida.")
        if key in ("slots", "accessories") and (
            not isinstance(value, list)
            or len(value) > 3
            or not all(
                (
                    x is None
                    or isinstance(x, str)
                    and x in FOOTPRINTS
                    and x not in ("memoryCabinet", "dartRack")
                )
                for x in value
            )
        ):
            raise ValueError("Selecciona hasta tres objetos disponibles de la colección gratuita.")
        if key == "images" and (
            not isinstance(value, list)
            or len(value) > (20 if kind == "photoFrame" else 1)
            or not all(valid_media_url(x) for x in value)
        ):
            raise ValueError("Selecciona imágenes subidas al almacenamiento de esta habitación.")
        if key == "tracks" and (
            not isinstance(value, list)
            or len(value) > 10
            or not all(
                isinstance(x, dict)
                and {"url", "title"} <= set(x) <= {"url", "title", "duration"}
                and (
                    "duration" not in x
                    or finite_number(x["duration"])
                    and 0 < x["duration"] <= 21600
                )
                and valid_media_url(x["url"])
                and isinstance(x["title"], str)
                and 1 <= len(x["title"]) <= 100
                for x in value
            )
        ):
            raise ValueError("Selecciona hasta diez archivos de audio con título.")
    return result


def valid_media_url(value):
    return isinstance(value, str) and re.fullmatch(r"/api/media/[a-f0-9]{32}", value) is not None


def validate_media_references(session, room_id, kind, config):
    from .models import MediaAsset, Room
    from .visitors import can_enter_room

    urls = config.get("images", []) + [t["url"] for t in config.get("tracks", [])]
    for url in urls:
        asset = session.get(MediaAsset, url.rsplit("/", 1)[1])
        expected = "audio/" if kind == "retroRadio" else "image/"
        if asset is None or asset.room_id != room_id or not asset.mime.startswith(expected):
            raise ValueError("El archivo no existe o no pertenece a esta habitación.")
    if kind == "friendPortal" and config.get("destination") is not None:
        destination = config["destination"]
        if session.get(Room, destination) is None or not can_enter_room(session, destination):
            raise ValueError("La habitación de destino no existe o no permite acceso.")
