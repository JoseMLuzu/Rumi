"""Add accounts without deleting or assigning ownership of existing bedrooms."""

import json
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import text
from .database import engine
from .models import AuthSession


def migrate():
    with engine.begin() as connection:
        snapshot = {}
        for table in ("rooms", "visitors", "placed_furniture", "media_assets"):
            snapshot[table] = [
                dict(row) for row in connection.execute(text(f"SELECT * FROM {table}")).mappings()
            ]
        # Preserve room data; credentials and session tokens must never enter this backup.
        snapshot["visitors"] = [
            {"id": row["id"], "room_id": row["room_id"]} for row in snapshot["visitors"]
        ]
        directory = Path(__file__).parent / "backups"
        directory.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = directory / f"before-accounts-{stamp}.json"
        backup.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
        for definition in (
            "password_hash TEXT",
            "is_host BOOLEAN NOT NULL DEFAULT false",
            "activation_hash TEXT",
            "activation_expires_at DOUBLE PRECISION",
        ):
            connection.execute(text(f"ALTER TABLE visitors ADD COLUMN IF NOT EXISTS {definition}"))
        AuthSession.__table__.create(connection, checkfirst=True)
    print(f"Accounts schema ready. Existing bedrooms remain reserved. Backup: {backup}")


if __name__ == "__main__":
    migrate()
