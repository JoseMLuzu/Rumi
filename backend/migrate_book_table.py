"""One-time conversion of the previously hardcoded living-room book table."""

import json
from datetime import datetime, timezone
from pathlib import Path

from .database import SessionLocal
from .models import Room, PlacedFurniture
from .seed import CENTRAL_ITEMS
from .validation import validate_layout
from .living_room import validate_entrances


def upgrade():
    record = next(item for item in CENTRAL_ITEMS if item["type"] == "bookTable")
    with SessionLocal.begin() as session:
        room = session.get(Room, 1)
        if room is None:
            raise RuntimeError("Seed the living room first.")
        if session.get(PlacedFurniture, record["id"]) is not None:
            print("The book table is already a saved item; nothing changed.")
            return
        before = room.to_dict()
        items = validate_layout({"items": [*before["items"], record]})
        validate_entrances(items)
        backups = Path(__file__).parent / "backups"
        backups.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = backups / f"before-editable-living-room-{stamp}.json"
        backup.write_text(json.dumps(before, indent=2) + "\n")
        session.add(PlacedFurniture.from_record(1, record))
    print(f"Saved the book table without changing other furniture. Backup: {backup}")


if __name__ == "__main__":
    upgrade()
