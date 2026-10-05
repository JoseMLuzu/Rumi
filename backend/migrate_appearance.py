"""Run explicitly: back up room metadata and add appearance without touching furniture."""

import json
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import text
from .database import engine


def migrate():
    with engine.begin() as connection:
        rooms = connection.execute(text("SELECT * FROM rooms")).mappings().all()
        folder = Path(__file__).resolve().parent / "backups"
        folder.mkdir(exist_ok=True)
        target = (
            folder
            / f'before-room-appearance-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")}.json'
        )
        target.write_text(json.dumps([dict(room) for room in rooms], ensure_ascii=False, indent=2))
        connection.execute(
            text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS appearance JSON NOT NULL DEFAULT '{}'")
        )
        connection.execute(
            text(
                "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS appearance_revision INTEGER NOT NULL DEFAULT 0"
            )
        )
    print("Room style schema ready. Room metadata backup:", target)


if __name__ == "__main__":
    migrate()
