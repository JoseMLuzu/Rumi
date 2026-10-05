"""Password accounts and revocable sessions; HTTP and Socket.IO share one identity."""

import hashlib
import secrets
import time
from collections import OrderedDict
from functools import wraps
from threading import Lock

from flask import Blueprint, jsonify, request, current_app
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from .database import SessionLocal
from .models import AuthSession, Visitor, Space, SpaceMembership

auth_api = Blueprint("auth", __name__, url_prefix="/api/auth")
SESSION_COOKIE = "social_rooms_session"
SESSION_SECONDS = 7 * 24 * 3600
ATTEMPT_WINDOW = 15 * 60
attempts = OrderedDict()
attempts_lock = Lock()
# Verify a real hash even for unknown names, so that login does not reveal account existence.
DUMMY_HASH = generate_password_hash(secrets.token_urlsafe(24))


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def current_session(session):
    token = request.cookies.get(SESSION_COOKIE, "")
    if not 20 <= len(token) <= 128:
        return None
    record = session.get(AuthSession, digest(token))
    return record if record and record.expires_at > time.time() else None


def current_user(session):
    record = current_session(session)
    return session.get(Visitor, record.user_id) if record and record.user_id else None


def user_data(user, session):
    from .spaces import central_room

    member = session.scalar(
        select(SpaceMembership)
        .where(SpaceMembership.user_id == user.id)
        .order_by(SpaceMembership.space_id)
    )
    central = central_room(session, member.space_id) if member else None
    return {
        "name": user.id,
        "displayName": user.display_name
        or (user.room.name.removesuffix("’s bedroom") if user.room else user.id),
        "personalRoomId": member.room_id if member else None,
        "centralRoomId": central.id if central else None,
        "roomName": member.room.name if member else None,
        "isHost": member.is_host if member else False,
    }


def disconnect_session(token_hash):
    from .realtime import players, players_lock, socketio

    with players_lock:
        connections = [
            sid for sid, entry in players.items() if entry.get("sessionHash") == token_hash
        ]
    # Disconnect invokes cleanup which acquires players_lock itself.
    for sid in connections:
        socketio.emit("auth_expired", to=sid)
        socketio.server.disconnect(sid, namespace="/")


def issue_session(session, user=None):
    old = current_session(session)
    old_hash = old.token_hash if old else None
    if old:
        session.delete(old)
    # Expired sessions are not credentials and can be safely removed on authentication.
    session.execute(delete(AuthSession).where(AuthSession.expires_at <= time.time()))
    token = secrets.token_urlsafe(32)
    record = AuthSession(
        token_hash=digest(token),
        user_id=user.id if user else None,
        csrf_token=secrets.token_urlsafe(32),
        expires_at=time.time() + (SESSION_SECONDS if user else 3600),
    )
    session.add(record)
    response = jsonify(
        {"user": user_data(user, session) if user else None, "csrfToken": record.csrf_token}
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_SECONDS if user else 3600,
        httponly=True,
        secure=request.is_secure,
        samesite="Lax",
        path="/",
    )
    response.delete_cookie("social_rooms_visitor", path="/")
    return response, old_hash


def protect_api():
    if not request.path.startswith("/api/") or request.path == "/api/health":
        return None
    with SessionLocal() as session:
        record = current_session(session)
        if not request.path.startswith("/api/auth/") and not current_user(session):
            return {"error": "Please log in to enter the house."}, 401
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("Origin")
            if origin and origin != request.host_url.rstrip("/"):
                return {"error": "This request must come from the application."}, 403
            supplied = request.headers.get("X-CSRF-Token", "")
            if not record or not secrets.compare_digest(
                supplied.encode(), record.csrf_token.encode()
            ):
                return {"error": "Your form session expired. Refresh and try again."}, 403


@auth_api.get("/session")
def get_session():
    with SessionLocal.begin() as session:
        record = current_session(session)
        if record:
            user = session.get(Visitor, record.user_id) if record.user_id else None
            return {
                "user": user_data(user, session) if user else None,
                "csrfToken": record.csrf_token,
            }
        response, _ = issue_session(session)
        return response


def credentials():
    from .visitors import normalize_name

    payload = request.get_json()
    if not isinstance(payload, dict):
        raise ValueError("Send a username and password.")
    username, display = normalize_name(payload.get("username"))
    password = payload.get("password")
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise ValueError("Use a password with 12–128 characters. A phrase works well.")
    return username, display, password, payload


def limit_attempts():
    # One worker for this MVP. A bounded in-memory limiter avoids a new service dependency.
    key = request.remote_addr
    now = time.time()
    with attempts_lock:
        recent = [stamp for stamp in attempts.pop(key, []) if stamp > now - ATTEMPT_WINDOW]
        attempts[key] = recent
        if len(recent) >= 20:
            return True
        recent.append(now)
        while len(attempts) > 2048:
            attempts.popitem(last=False)
    return False


def throttled():
    return {"error": "Too many attempts. Try again in 15 minutes."}, 429, {"Retry-After": "900"}


@auth_api.post("/register")
def register():
    if limit_attempts():
        return throttled()
    try:
        username, display, password, payload = credentials()
    except ValueError as error:
        return {"error": str(error)}, 400
    password_hash = generate_password_hash(password)
    joined_gci = False
    try:
        with SessionLocal.begin() as session:
            user = session.scalar(select(Visitor).where(Visitor.id == username).with_for_update())
            if user:
                code = payload.get("activationCode", "")
                if (
                    user.password_hash
                    or not isinstance(code, str)
                    or not 20 <= len(code) <= 128
                    or not user.activation_hash
                    or not user.activation_expires_at
                    or user.activation_expires_at <= time.time()
                    or not secrets.compare_digest(digest(code), user.activation_hash)
                ):
                    return {
                        "error": "This name is unavailable. Existing bedrooms require a private activation link."
                    }, 409
                user.password_hash = password_hash
                user.activation_hash = user.activation_expires_at = None
            else:
                user = Visitor(id=username, display_name=display, password_hash=password_hash)
                session.add(user)
                session.flush()
                if current_app.config["AUTO_JOIN_GCI"]:
                    from .spaces import add_member

                    space = session.get(Space, 1)
                    if not space:
                        return {"error": "Initialize gci first."}, 503
                    member, _ = add_member(session, space, user)
                    user.room_id = member.room_id
                    joined_gci = True
            response, old_hash = issue_session(session, user)
    except IntegrityError:
        # Rollback also removes the losing request's room and furniture.
        return {"error": "This name is unavailable. Choose another name."}, 409
    if old_hash:
        disconnect_session(old_hash)
    if joined_gci:
        from .spaces import notify_hall

        notify_hall(1)
    return response, 201


@auth_api.post("/login")
def login():
    if limit_attempts():
        return throttled()
    try:
        username, _, password, _ = credentials()
    except ValueError as error:
        return {"error": str(error)}, 400
    with SessionLocal.begin() as session:
        user = session.get(Visitor, username)
        valid = check_password_hash(
            user.password_hash if user and user.password_hash else DUMMY_HASH, password
        )
        if not valid or not user or not user.password_hash:
            return {"error": "Incorrect username or password."}, 401
        response, old_hash = issue_session(session, user)
    if old_hash:
        disconnect_session(old_hash)
    return response


@auth_api.post("/logout")
def logout():
    with SessionLocal.begin() as session:
        response, old_hash = issue_session(session)
    if old_hash:
        disconnect_session(old_hash)
    return response


def require_live_session(handler):
    @wraps(handler)
    def guarded(*args, **kwargs):
        from .realtime import players, players_lock, socketio

        with players_lock:
            entry = players.get(request.sid)
            token_hash = entry.get("sessionHash") if entry else None
        with SessionLocal() as session:
            record = session.get(AuthSession, token_hash) if token_hash else None
            valid = record and record.user_id and record.expires_at > time.time()
        # Validate revocation on every event: logout also works across local/public processes.
        if not valid:
            socketio.emit("auth_expired", to=request.sid)
            socketio.server.disconnect(request.sid, namespace="/")
            return {"ok": False, "error": "Please log in again."}
        return handler(*args, **kwargs)

    return guarded
