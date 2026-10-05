"""Add object data without resetting or reseeding existing rooms. Run explicitly."""

import json
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import text
from .database import Base, engine
from . import models


def migrate():
    with engine.begin() as connection:
        rows = connection.execute(text("SELECT * FROM placed_furniture")).mappings().all()
        folder = Path(__file__).resolve().parent / "backups"
        folder.mkdir(exist_ok=True)
        target = (
            folder
            / f'before-interactive-objects-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")}.json'
        )
        target.write_text(json.dumps([dict(row) for row in rows], ensure_ascii=False, indent=2))
        for statement in [
            "ADD COLUMN IF NOT EXISTS scale DOUBLE PRECISION NOT NULL DEFAULT 1",
            "ADD COLUMN IF NOT EXISTS config JSON NOT NULL DEFAULT '{}'",
            "ADD COLUMN IF NOT EXISTS state JSON NOT NULL DEFAULT '{}'",
            "ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0",
        ]:
            connection.execute(text("ALTER TABLE placed_furniture " + statement))
        connection.execute(
            text("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT true")
        )
    Base.metadata.create_all(engine)
    print("Object schema ready. Saved layout backup:", target)


if __name__ == "__main__":
    migrate()
