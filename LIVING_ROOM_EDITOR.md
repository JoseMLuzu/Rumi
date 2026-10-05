# Editing the shared living room

Log in with a **host account** (the existing `jose` account can be activated as a host), go to the living room, and click **Edit Living Room**. Use the
existing collection to add furniture. Click an existing piece to move, rotate,
scale, or delete it. Click **Save Room** to commit the layout for everyone.
**Discard edits & reload** restores the saved layout when you want to cancel.

The book and its stand now belong to a **Book table** furniture instance. You can
remove or replace it through the collection. The projector is attached to the
first plain table in saved ID order: deleting the last plain table removes the
projector and wall screen. Adding a plain table restores them. Moving, scaling,
or replacing the projector table ends any current share; visitors can start a
new share at the updated position. Rugs, windows, fairy lights, walls, and
hallways remain part of the existing house shell, not editable furniture.

Deleting unneeded furniture unmounts its meshes, lights, and per-object effects.
The book model is requested only when a book table is rendered. Shared GLB
geometry stays in the loader cache for reuse. Removing the projector disposes its
preview texture. This gives you control over scene complexity; it is not a
complete performance overhaul, and the existing large JavaScript bundle warning
remains. No furniture is automatically deleted from your layout.

## Permissions

Accounts now use passwords and revocable sessions. The `is_host` account flag
allows living-room edits; public signup cannot grant it. For a reserved bedroom,
the local administrator can activate it with host access:

```bash
DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms' \
  backend/.venv/bin/python -m backend.accounts jose --host --base-url 'http://localhost:5173'
```

The command prints a private activation link so its owner can choose a password.
See [Accounts](ACCOUNTS.md) for the complete flow and session/CSRF checks. The old
`LIVING_ROOM_EDITORS` name whitelist is retired. `ROOM_READ_ONLY=true` still disables
edits. Other logged-in visitors can sit, use objects and view shares. Hosts cannot
close the living room to visitors or change its fixed house-shell appearance.
The same host permission protects layout saves, media uploads and object configuration.

## Data flow and safety

1. `GET /api/rooms/1` returns furniture, hallway data, permissions, and a
   `layoutVersion`. The version is a hash of saved IDs/types/transforms, not a new
   database column. Messages and playback do not change it.
2. `App.jsx` holds a draft array in React state. Editing changes that array;
   visitors continue seeing the last committed layout.
3. `PUT /api/rooms/1` sends `{ items, layoutVersion }`. Flask checks host
   permissions, furniture bounds, overlaps, clear hallway entrances, and seat
   occupancy. It locks the room row and rejects an obsolete version with HTTP 409.
4. PostgreSQL replaces the furniture records in one transaction. Object
   configuration/state is preserved for unchanged IDs and types.
5. After commit, Socket.IO sends `room_layout_changed`. Other browsers reload the
   room through HTTP. A host's pending edits are kept, with a conflict message if
   someone saved a newer layout. Bedroom doors still refresh during decoration.

An occupied seat cannot be deleted, moved, or scaled until its occupant stands.
The server's existing player lock protects that check from simultaneous seating.
Removing/moving the projector table clears its shared session and viewers.

## Files and responsibilities

- `src/App.jsx`: draft/saved layouts, version sent on save, live reloads, discard
  action, and projector selection. Receives the loaded room; changes React state.
- `src/Room.jsx` and `src/MainHall.jsx`: forward editor callbacks and add one
  invisible floor hit surface above the rugs. Only the living-room floor accepts
  placement; corridor and bedroom shells keep their current design.
- `src/RoomUI.jsx`: exposes the existing furniture controls to permitted hosts,
  explains projector removal, and offers discard/reload. It calls callbacks;
  it does not write to the database.
- `src/BookTable.jsx`, `src/FurnitureModel.jsx`, `src/data/furniture.js`: reuse the
  book model and table geometry as one catalog type under the standard furniture
  transform wrapper. No hardcoded book collision remains.
- `src/Projector.jsx`: scales/rotates with its table, supports selecting the table
  while decorating, and cleans up proximity/texture state when removed.
- `src/useRoomConnection.js`: receives saved-layout notifications without making
  everyone stand up for an unrelated decoration change; occupied seats are now
  protected by the server's save check.
- `src/api.js` and `src/roomLayout.js`: send the reviewed version and validate
  placement against the same hallway entrance zones as the server.
- `backend/visitors.py`, `backend/app.py`, `backend/living_room.py`, and
  `backend/models.py`: host permission, transactional saves, layout version, and
  shared-room validation/response. No new tables or dependencies.
- `backend/validation.py`, `backend/seating.py`, `backend/screens.py`: understand
  the book-table footprint, remove its former fixed collision, and clear screen
  sharing from an HTTP save as well as a socket disconnect.
- `backend/seed.py` and `backend/migrate_book_table.py`: fresh-room defaults and
  a one-time conversion for the existing fixed book table. The migration backs
  up room 1 before inserting one record; it does not touch personal rooms.
  `backend/cozy_living_room.py` validates the saved book record rather than adding
  a second fixed collision fixture.
- `tests/livingRoom.test.js`, `backend/tests/test_living_room.py`, and updated
  `backend/tests/test_api.py`: entrance, collision, permission, persistence,
  notification, conflict, seat occupancy, and media-cleanup coverage.

## Migration and checks

For an existing pre-editor database, run **once**:

```bash
DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms' \
  backend/.venv/bin/python -m backend.migrate_book_table
```

It skips a book table already present. Do not rerun after deliberately deleting
that record: it would restore the original book table. Fresh databases get it
from `backend.seed`; the migration never runs automatically on startup.

```bash
npm test
npm run build
TEST_DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms_test' \
  backend/.venv/bin/python -m unittest discover -s backend/tests -q
```

Manual checks: use a second browser with another saved name to observe a saved
addition/deletion; refresh to check persistence. Have that visitor sit and try
deleting their chair. Start a screen share and remove its table. Finally, use
two host tabs, edit in both, save in one, and verify that the other's stale save
is rejected and its draft remains available to discard.

Learning exercises: trace the draft → PUT → transaction → live notification → GET
flow; explain why a version check needs a room-row lock; change the allowed
entrance zones consistently in Python and JavaScript; add another simple catalog
item using the book-table pattern.
