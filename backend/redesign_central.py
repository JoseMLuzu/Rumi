"""Explicitly redesign room 1, keeping a JSON backup before changing its furniture."""
import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete

from .database import SessionLocal
from .models import PlacedFurniture, Room
from .seed import CENTRAL_ITEMS
from .validation import validate_layout


def redesign():
    items = validate_layout({"items": CENTRAL_ITEMS})
    with SessionLocal.begin() as session:
        room = session.get(Room, 1)
        if room is None:
            raise RuntimeError("Run python -m backend.seed first.")
        backup_dir = Path(__file__).resolve().parent / "backups"
        backup_dir.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = backup_dir / f"central-room-{stamp}.json"
        backup.write_text(json.dumps(room.to_dict(), indent=2) + "\n")
        session.execute(delete(PlacedFurniture).where(PlacedFurniture.room_id == 1))
        session.add_all(PlacedFurniture.from_record(1, item) for item in items)
    print(f"Central room redesigned. Previous layout saved to {backup}")


if __name__ == "__main__":
    redesign()
