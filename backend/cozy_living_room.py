"""Apply only the requested living-room additions; preserve all personal rooms."""

import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from .database import SessionLocal
from .models import PlacedFurniture, Room
from .seed import CENTRAL_ITEMS
from .validation import validate_layout


def upgrade():
    changes = [
        item
        for item in CENTRAL_ITEMS
        if item["id"].startswith("central-lounge-")
        or item["id"] in ("central-reading-lamp", "central-plant-front-left")
    ]
    with SessionLocal.begin() as session:
        room = session.get(Room, 1)
        if room is None:
            raise RuntimeError("Seed the living room first.")
        existing = session.scalars(
            select(PlacedFurniture).where(PlacedFurniture.room_id == 1)
        ).all()
        records = {item.id: item.to_dict() for item in existing}
        previous = room.to_dict()
        records.update((item["id"], item) for item in changes)
        # The book table is now an ordinary saved furniture record.
        validate_layout({"items": list(records.values())})
        backup_dir = Path(__file__).parent / "backups"
        backup_dir.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = backup_dir / f"before-cozy-living-room-{stamp}.json"
        backup.write_text(json.dumps(previous, indent=2) + "\n")
        for record in changes:
            item = session.get(PlacedFurniture, record["id"])
            if item is not None and item.room_id != 1:
                raise RuntimeError("A furniture ID belongs to another room.")
            if item is None:
                session.add(PlacedFurniture.from_record(1, record))
            else:
                item.type = record["type"]
                item.position_x, item.position_y, item.position_z = record["position"]
                item.rotation = record["rotation"]
    print(f"Updated shared living room. Backup: {backup}")


if __name__ == "__main__":
    upgrade()
