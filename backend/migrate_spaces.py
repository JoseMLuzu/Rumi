"""Preserve the existing house as gci, with every existing account as a member."""

import json
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import text
from .database import engine
from .models import Space, SpaceMembership


def migrate(backup_dir=None):
    with engine.begin() as connection:
        snapshot = {}
        for table in ("rooms", "placed_furniture", "media_assets"):
            snapshot[table] = [
                dict(row) for row in connection.execute(text(f"SELECT * FROM {table}")).mappings()
            ]
        snapshot["accounts"] = [
            dict(row)
            for row in connection.execute(
                text("SELECT id, room_id, is_host FROM visitors")
            ).mappings()
        ]
        directory = Path(backup_dir) if backup_dir else Path(__file__).parent / "backups"
        directory.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = directory / f"before-spaces-{stamp}.json"
        backup.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
        connection.execute(text("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS display_name TEXT"))
        connection.execute(text("ALTER TABLE visitors ALTER COLUMN room_id DROP NOT NULL"))
        connection.execute(
            text(
                "UPDATE visitors SET display_name = COALESCE((SELECT replace(name, '’s bedroom', '') FROM rooms WHERE rooms.id=visitors.room_id), id) WHERE display_name IS NULL"
            )
        )
        # Create spaces before assigning room foreign keys. The first space is permanent gci.
        Space.__table__.create(connection, checkfirst=True)
        # Table.create skips this deferred FK (needed to break the metadata cycle).
        connection.execute(text("""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_spaces_owner'
                             AND conrelid='spaces'::regclass) THEN
                ALTER TABLE spaces ADD CONSTRAINT fk_spaces_owner
                  FOREIGN KEY(owner_id) REFERENCES visitors(id);
              END IF;
            END $$;
        """))
        connection.execute(
            text(
                "INSERT INTO spaces(id,name,owner_id) VALUES(1,'gci',(SELECT id FROM visitors WHERE is_host=true ORDER BY id LIMIT 1)) ON CONFLICT(id) DO NOTHING"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS space_id INTEGER REFERENCES spaces(id) DEFAULT 1"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_central BOOLEAN NOT NULL DEFAULT false"
            )
        )
        connection.execute(text("UPDATE rooms SET space_id=1 WHERE space_id IS NULL"))
        connection.execute(text("UPDATE rooms SET is_central=true WHERE id=1"))
        connection.execute(text("ALTER TABLE rooms ALTER COLUMN space_id SET NOT NULL"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_rooms_space_id ON rooms(space_id)"))
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS one_living_room_per_space ON rooms(space_id) WHERE is_central"
            )
        )
        SpaceMembership.__table__.create(connection, checkfirst=True)
        connection.execute(
            text(
                "INSERT INTO space_memberships(space_id,user_id,room_id,is_host) SELECT 1,id,room_id,is_host FROM visitors WHERE room_id IS NOT NULL ON CONFLICT(space_id,user_id) DO NOTHING"
            )
        )
        connection.execute(
            text(
                "SELECT setval(pg_get_serial_sequence('spaces','id'), GREATEST((SELECT MAX(id) FROM spaces),nextval(pg_get_serial_sequence('spaces','id'))),true)"
            )
        )
    print(f"Spaces schema ready. Existing rooms/accounts retained in gci. Backup: {backup}")


if __name__ == "__main__":
    migrate()
