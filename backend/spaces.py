"""Small houses with explicit membership and reusable, revocable invitation links."""

import secrets
import time
from uuid import uuid4
from flask import Blueprint, current_app, request
from sqlalchemy import select, func
from .database import SessionLocal
from .models import Space, SpaceMembership, Room, PlacedFurniture
from .auth import current_user, digest

spaces_api = Blueprint("spaces", __name__, url_prefix="/api/spaces")


def space_rooms(session, space_id):
    return session.scalars(select(Room).where(Room.space_id == space_id).order_by(Room.id)).all()


def central_room(session, space_id):
    return session.scalar(select(Room).where(Room.space_id == space_id, Room.is_central.is_(True)))


def membership(session, space_id, user_id):
    return session.get(SpaceMembership, (space_id, user_id))


def space_data(session, space, member):
    central = central_room(session, space.id)
    return {
        "id": space.id,
        "name": space.name,
        "personalRoomId": member.room_id,
        "centralRoomId": central.id,
        "roomName": member.room.name,
        "isHost": member.is_host,
        "isOwner": space.owner_id == member.user_id,
        "memberCount": session.scalar(
            select(func.count())
            .select_from(SpaceMembership)
            .where(SpaceMembership.space_id == space.id)
        ),
    }


def add_member(session, space, user, is_host=False):
    existing = membership(session, space.id, user.id)
    if existing:
        return existing, False
    from .seed import STARTER_ITEMS

    display = user.display_name or (
        user.room.name.removesuffix("’s bedroom") if user.room else user.id
    )
    room = Room(name=f"{display}’s bedroom", space_id=space.id)
    session.add(room)
    session.flush()
    session.add_all(
        PlacedFurniture.from_record(room.id, {**item, "id": str(uuid4())}) for item in STARTER_ITEMS
    )
    member = SpaceMembership(space_id=space.id, user_id=user.id, room_id=room.id, is_host=is_host)
    session.add(member)
    session.flush()
    return member, True


def notify_hall(space_id):
    from .realtime import socketio, update_hall_limits
    from .hall import build_hall

    with SessionLocal() as session:
        central = central_room(session, space_id)
        hall = build_hall(space_rooms(session, space_id), central.id)
        room_id = central.id
    update_hall_limits(hall["walkAreas"], room_id)
    socketio.emit("hall_changed", {"roomId": room_id}, to=f"room:{room_id}")


@spaces_api.get("")
def list_spaces():
    with SessionLocal() as session:
        user = current_user(session)
        memberships = session.scalars(
            select(SpaceMembership)
            .where(SpaceMembership.user_id == user.id)
            .order_by(SpaceMembership.space_id)
        ).all()
        return {
            "spaces": [
                space_data(session, session.get(Space, member.space_id), member)
                for member in memberships
            ]
        }


@spaces_api.post("")
def create_space():
    if current_app.config["ROOM_READ_ONLY"]:
        return {"error": "Space creation is disabled for this playtest."}, 403
    payload = request.get_json()
    name = (
        " ".join(payload.get("name", "").split())
        if isinstance(payload, dict) and isinstance(payload.get("name"), str)
        else ""
    )
    if not 1 <= len(name) <= 48 or any(ord(char) < 32 for char in name):
        return {"error": "Use a space name with 1–48 characters."}, 400
    with SessionLocal.begin() as session:
        user = current_user(session)
        # Serialize creation for one account to enforce this small playtest limit.
        session.refresh(user, with_for_update=True)
        count = session.scalar(
            select(func.count()).select_from(Space).where(Space.owner_id == user.id)
        )
        if count >= 10:
            return {"error": "You can own up to 10 spaces in this playtest."}, 409
        space = Space(name=name, owner_id=user.id)
        session.add(space)
        session.flush()
        room = Room(name="Living room", space_id=space.id, is_central=True)
        session.add(room)
        session.flush()
        from .seed import CENTRAL_ITEMS

        session.add_all(
            PlacedFurniture.from_record(room.id, {**item, "id": str(uuid4())})
            for item in CENTRAL_ITEMS
        )
        member, _ = add_member(session, space, user, is_host=True)
        result = space_data(session, space, member)
    return result, 201


@spaces_api.post("/<int:space_id>/invitation")
def generate_invitation(space_id):
    token = secrets.token_urlsafe(32)
    with SessionLocal.begin() as session:
        user = current_user(session)
        member = membership(session, space_id, user.id)
        if not member or not member.is_host:
            return {"error": "Only a space host can create invitations."}, 403
        space = session.scalar(select(Space).where(Space.id == space_id).with_for_update())
        space.invitation_hash = digest(token)
        space.invitation_expires_at = time.time() + 7 * 24 * 3600
        result = {"token": token, "expiresAt": space.invitation_expires_at}
    return result, 201


@spaces_api.delete("/<int:space_id>/invitation")
def revoke_invitation(space_id):
    with SessionLocal.begin() as session:
        user = current_user(session)
        member = membership(session, space_id, user.id)
        if not member or not member.is_host:
            return {"error": "Only a space host can revoke invitations."}, 403
        space = session.scalar(select(Space).where(Space.id == space_id).with_for_update())
        space.invitation_hash = space.invitation_expires_at = None
    return {"revoked": True}


def invited_space(session, payload, lock=False):
    token = payload.get("token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not 20 <= len(token) <= 128:
        return None
    statement = select(Space).where(Space.invitation_hash == digest(token))
    space = session.scalar(statement.with_for_update() if lock else statement)
    return (
        space
        if space and space.invitation_expires_at and space.invitation_expires_at > time.time()
        else None
    )


@spaces_api.post("/invitations/preview")
def preview_invitation():
    with SessionLocal() as session:
        space = invited_space(session, request.get_json())
        if not space:
            return {"error": "This invitation is invalid, expired or revoked."}, 404
        user = current_user(session)
        return {
            "id": space.id,
            "name": space.name,
            "alreadyMember": membership(session, space.id, user.id) is not None,
        }


@spaces_api.post("/join")
def join_space():
    with SessionLocal.begin() as session:
        # Lock the space so concurrent accepts cannot create duplicate bedrooms,
        # and invitation revocation cannot race an accepted membership.
        space = invited_space(session, request.get_json(), lock=True)
        if not space:
            return {"error": "This invitation is invalid, expired or revoked."}, 404
        user = current_user(session)
        member, created = add_member(session, space, user)
        result = space_data(session, space, member)
        space_id = space.id
    if created:
        notify_hall(space_id)
    return result, 201 if created else 200
