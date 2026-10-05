"""Local file storage: PostgreSQL keeps references, never image base64 or audio bytes."""

import io
import os
import warnings
from pathlib import Path
from uuid import uuid4
from flask import Blueprint, current_app, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select, func
from .database import SessionLocal
from .models import MediaAsset, Room
from .visitors import can_edit_room, can_enter_room, current_visitor

media_api = Blueprint("media", __name__)
UPLOAD_DIR = Path(
    os.environ.get("SOCIAL_ROOMS_UPLOAD_DIR", str(Path(__file__).resolve().parent / "uploads"))
)
IMAGE_LIMIT = 10 * 1024 * 1024
AUDIO_LIMIT = 20 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000


def optimize_image(raw):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as original:
                original.seek(0)  # Animated uploads become one lightweight still image.
                image = ImageOps.exif_transpose(original)
                image.load()
                image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
                image = image.convert("RGBA" if alpha else "RGB")
                output = io.BytesIO()
                image.save(output, format="WEBP", quality=85, method=4)
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        raise ValueError(
            "La imagen está dañada, es demasiado grande al decodificarla o su formato no se puede convertir. Prueba JPG, PNG o WebP."
        ) from error


def audio_format(raw):
    if raw.startswith(b"RIFF") and raw[8:12] == b"WAVE":
        return "wav", "audio/wav"
    if raw.startswith(b"OggS"):
        return "ogg", "audio/ogg"
    if raw.startswith(b"fLaC"):
        return "flac", "audio/flac"
    if raw.startswith(b"ID3") or (len(raw) > 2 and raw[0] == 255 and raw[1] & 224 == 224):
        return "mp3", "audio/mpeg"
    if raw[4:8] == b"ftyp" and raw[8:12] in (b"M4A ", b"M4B "):
        return "m4a", "audio/mp4"
    raise ValueError(
        "Audio no compatible. Usa MP3, WAV, OGG, FLAC o M4A reproducible en tu navegador."
    )


@media_api.post("/api/rooms/<int:room_id>/media")
def upload_media(room_id):
    with SessionLocal.begin() as session:
        visitor = current_visitor(session)
        # Visitors may upload board drawings, but cannot turn them into owner configuration.
        purpose = request.form.get("purpose", "image")
        allowed = can_edit_room(session, room_id) or (
            purpose == "drawing" and visitor and can_enter_room(session, room_id)
        )
        if not allowed or current_app.config["ROOM_READ_ONLY"]:
            return {
                "error": "Solo el propietario puede subir imágenes o audio; los visitantes pueden aportar dibujos."
            }, 403
        if purpose not in ("image", "drawing", "audio"):
            return {"error": "Tipo de subida desconocido."}, 400
        room = session.scalar(select(Room).where(Room.id == room_id).with_for_update())
        if room is None:
            return {"error": "La habitación no existe."}, 404
        file = request.files.get("file")
        if file is None:
            return {"error": "Selecciona un archivo."}, 400
        limit = AUDIO_LIMIT if purpose == "audio" else IMAGE_LIMIT
        raw = file.read(limit + 1)
        if not raw or len(raw) > limit:
            return {
                "error": f"El archivo supera el límite de {limit // 1024 // 1024} MB o está vacío."
            }, 413
        count, total = session.execute(
            select(func.count(MediaAsset.id), func.coalesce(func.sum(MediaAsset.size), 0)).where(
                MediaAsset.room_id == room_id
            )
        ).one()
        if count >= 300 or total + len(raw) > 150 * 1024 * 1024:
            return {
                "error": "Esta habitación alcanzó su límite de almacenamiento (300 archivos / 150 MB)."
            }, 413
        try:
            if purpose == "audio":
                extension, mime = audio_format(raw)
            else:
                raw, extension, mime = optimize_image(raw), "webp", "image/webp"
        except ValueError as error:
            return {"error": str(error)}, 400
        asset_id = uuid4().hex
        filename = asset_id + "." + extension
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        path = UPLOAD_DIR / filename
        path.write_bytes(raw)
        try:
            session.add(
                MediaAsset(
                    id=asset_id,
                    room_id=room_id,
                    uploader=visitor.id,
                    filename=filename,
                    mime=mime,
                    size=len(raw),
                )
            )
            session.flush()
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {
            "id": asset_id,
            "url": "/api/media/" + asset_id,
            "mime": mime,
            "size": len(raw),
        }, 201


@media_api.get("/api/media/<asset_id>")
def get_media(asset_id):
    with SessionLocal() as session:
        asset = session.get(MediaAsset, asset_id)
        if asset is None:
            return {"error": "Archivo no encontrado."}, 404
        if not can_enter_room(session, asset.room_id):
            return {"error": "No tienes acceso a este archivo."}, 403
        response = send_from_directory(
            UPLOAD_DIR, asset.filename, mimetype=asset.mime, conditional=True
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
