"""Explicit one-time reset requested for the name-based house milestone."""

from sqlalchemy import delete, text

from .database import SessionLocal
from .models import PlacedFurniture, Room, Visitor, AuthSession, SpaceMembership, Space
from .seed import CENTRAL_ITEMS
from .validation import validate_layout


def reset_house():
    items = validate_layout({"items": CENTRAL_ITEMS})
    # Run with the application servers stopped, after making a database backup.
    # This is intentionally a command, never an automatic startup or HTTP action.
    with SessionLocal.begin() as session:
        session.execute(delete(AuthSession))
        session.execute(delete(SpaceMembership))
        session.query(Space).update({"owner_id": None})
        session.execute(delete(Visitor))
        session.execute(delete(PlacedFurniture))
        session.execute(delete(Room))
        session.execute(delete(Space))
        session.add(Space(id=1, name="gci"))
        session.flush()
        session.add(Room(id=1, name="Living room", space_id=1, is_central=True))
        session.flush()
        session.add_all(PlacedFurniture.from_record(1, item) for item in items)
        session.execute(text("SELECT setval(pg_get_serial_sequence('rooms', 'id'), 1, true)"))
    print("Old rooms and visitor IDs removed. Only shared living room 1 remains.")


if __name__ == "__main__":
    reset_house()
