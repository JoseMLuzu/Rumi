import unicodedata


from .models import Room, SpaceMembership

CENTRAL_ROOM_ID = 1


def normalize_name(value):
    if not isinstance(value, str):
        raise ValueError("Enter a name for your bedroom.")
    display_name = " ".join(unicodedata.normalize("NFKC", value).split())
    if (
        not 1 <= len(display_name) <= 24
        or len(display_name.casefold()) > 24
        or not all(character.isalnum() or character in " -_" for character in display_name)
    ):
        raise ValueError("Use 1–24 letters, numbers, spaces, hyphens or underscores.")
    # One database key for 'Jose', 'JOSE', and '  Jose  ', on every browser.
    return display_name.casefold(), display_name


def current_visitor(session):
    # Existing room/object code uses this helper; its identity now requires authentication.
    from .auth import current_user

    return current_user(session)


def can_enter_room(session, room_id):
    visitor = current_visitor(session)
    if visitor is None:
        return False
    room = session.get(Room, room_id)
    if room is None:
        return True  # The handler returns 404 without disclosing any room data.
    member = session.get(SpaceMembership, (room.space_id, visitor.id))
    return bool(member and (room.is_central or room.is_open or member.room_id == room_id))


def can_edit_room(session, room_id):
    visitor = current_visitor(session)
    room = session.get(Room, room_id)
    if visitor is None or room is None:
        return False
    member = session.get(SpaceMembership, (room.space_id, visitor.id))
    return bool(member and (member.is_host if room.is_central else member.room_id == room_id))
