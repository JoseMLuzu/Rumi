import math
from sqlalchemy import text

from .database import Base, SessionLocal, engine
from .models import PlacedFurniture, Room, Space
from .validation import validate_layout

# Explicit seed data mirrors the frontend starter room; it never runs on HTTP startup.
STARTER_ITEMS = [
    {"id": "starter-bed", "type": "bed", "position": [-3.2, 0, -2.7], "rotation": 0},
    {"id": "starter-sofa", "type": "sofa", "position": [2.6, 0, -3.6], "rotation": 0},
    {"id": "starter-table", "type": "table", "position": [2.6, 0, -1.65], "rotation": 0},
    {"id": "starter-chair", "type": "chair", "position": [2.6, 0, 0.1], "rotation": math.pi},
    {"id": "starter-plant", "type": "plant", "position": [-3.6, 0, 3.7], "rotation": 0},
    {"id": "starter-lamp", "type": "lamp", "position": [4.45, 0, -3.4], "rotation": 0},
]

# Keep a clear route across the front of a central seating area to both hallways.
CENTRAL_ITEMS = [
    {"id": "living-room-book-table", "type": "bookTable", "position": [0, 0, 3.25], "rotation": 0},
    {"id": "central-sofa", "type": "sofa", "position": [0, 0, -2.4], "rotation": 0},
    {"id": "central-table", "type": "table", "position": [0, 0, -0.4], "rotation": 0},
    {
        "id": "central-chair-left",
        "type": "chair",
        "position": [-2.4, 0, -0.6],
        "rotation": math.pi / 2,
    },
    {
        "id": "central-chair-right",
        "type": "chair",
        "position": [2.4, 0, -0.6],
        "rotation": 3 * math.pi / 2,
    },
    {"id": "central-plant-left", "type": "plant", "position": [-3.9, 0, -3.9], "rotation": 0},
    {"id": "central-plant-right", "type": "plant", "position": [3.9, 0, -3.9], "rotation": 0},
    {"id": "central-plant-front-left", "type": "plant", "position": [-4.2, 0, 4.2], "rotation": 0},
    {"id": "central-plant-front-right", "type": "plant", "position": [3.9, 0, 3.9], "rotation": 0},
    {"id": "central-lamp-left", "type": "lamp", "position": [-2.1, 0, -2.6], "rotation": 0},
    {"id": "central-lamp-right", "type": "lamp", "position": [2.1, 0, -2.6], "rotation": 0},
    {
        "id": "central-lounge-sofa",
        "type": "sofa",
        "position": [-3.15, 0, 2.85],
        "rotation": math.pi / 2,
    },
    {"id": "central-lounge-chair", "type": "chair", "position": [2.8, 0, 3.1], "rotation": math.pi},
    {
        "id": "central-lounge-chair-right",
        "type": "chair",
        "position": [3.8, 0, 1.95],
        "rotation": 3 * math.pi / 2,
    },
    {"id": "central-reading-lamp", "type": "lamp", "position": [-1.8, 0, 4.2], "rotation": 0},
]


def seed():
    # create_all creates missing tables; it does not migrate existing table definitions.
    Base.metadata.create_all(engine)
    with SessionLocal.begin() as session:
        # Initialization must not race a visitor's room INSERT while fixing the sequence.
        session.execute(text("LOCK TABLE rooms IN SHARE ROW EXCLUSIVE MODE"))
        if session.get(Space, 1) is None:
            session.add(Space(id=1, name="gci"))
            session.flush()
        room = session.get(Room, 1)
        if room is None:
            items = validate_layout({"items": CENTRAL_ITEMS})
            session.add(Room(id=1, name="Living room", space_id=1, is_central=True))
            session.flush()
            session.add_all(PlacedFurniture.from_record(1, item) for item in items)
            print("Created shared living room 1.")
        else:
            room.name = "Living room"
            room.is_central = True
            print("Room 1 is now the central room. Its saved furniture was left unchanged.")
        session.execute(
            text(
                "SELECT setval(pg_get_serial_sequence('spaces','id'), GREATEST((SELECT MAX(id) FROM spaces),nextval(pg_get_serial_sequence('spaces','id'))),true)"
            )
        )
        # Explicitly seeding ID 1 did not advance PostgreSQL's auto-increment sequence.
        # Move it beyond existing IDs without rewinding it; gaps in IDs are harmless.
        session.execute(text("""
            SELECT setval(pg_get_serial_sequence('rooms', 'id'),
                GREATEST((SELECT COALESCE(MAX(id), 1) FROM rooms),
                         nextval(pg_get_serial_sequence('rooms', 'id'))), true)
        """))


if __name__ == "__main__":
    seed()
