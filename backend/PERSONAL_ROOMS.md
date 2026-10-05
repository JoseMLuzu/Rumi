# Personal rooms and one central room

Historical milestone: random visitor IDs have been replaced by saved names.
See [Named House](NAMED_HOUSE.md) for the current entry and ownership rules.

Each browser now gets a random anonymous visitor ID and its own saved room.
**My Room** opens that personal room; **Central Room** opens room 1, where everyone
can meet. Personal furniture is editable only by its owner. The central room is
read-only. The next milestone adds visiting, travel doors, live guest layout updates,
and a garden lounge: see [Room travel](ROOM_TRAVEL.md). No new dependencies were required.

## Try it

1. Refresh the public app. It opens your personal room with six starter pieces.
2. Decorate, commit the placement, and click Save Room. Refresh to verify persistence.
3. Click Central Room. Your personal layout stays saved; the shared layout loads.
4. Have your friend click Central Room using the same public hostname. You can meet
   there and see movement. Return home with My Room.
5. Try another browser or private-browsing session: it gets a different personal
   room. Two ordinary tabs in the same browser share the same visitor cookie/room.

Finish/cancel placement and save committed changes before traveling. Navigation
is disabled while those changes are pending so switching cannot silently discard
them. There is still no autosave. Furniture edits are not collaborative; two tabs
of the same visitor should coordinate saves because the last successful PUT wins.

## Three different IDs

| ID | Lifetime | Purpose |
|---|---|---|
| Visitor UUID | Stored in a browser cookie for up to one year | Recognizes the anonymous owner |
| Room integer | Stored in PostgreSQL | Selects a saved layout; room 1 is central |
| Socket.IO connection ID | Changes on reconnect or room travel | Identifies a live avatar |

The visitor ID is an unguessable room key. It is not a name, email, or verified
person. Possession of its cookie grants editing rights to that room. It is never returned
in room JSON or live player events. `HttpOnly` prevents frontend JavaScript from
reading it; HTTPS responses set `Secure`, and `SameSite=Lax` limits cross-site use.

The browser sends the cookie automatically on same-origin HTTP and WebSocket
requests. Clearing cookies, using another browser/device, or changing the public
hostname gives you a new identity. The old room remains in PostgreSQL, but this
milestone has no account recovery. A new Cloudflare quick-tunnel URL has a new
cookie origin. This is a temporary identity model for learning/testing.

## Database structure

```text
visitors                         rooms                      placed_furniture
id (random UUID, primary key)     id (integer, primary key)   id (unique text)
room_id (unique foreign key) ---> name                        room_id -> rooms.id
                                                             type, x, y, z, rotation
```

The unique room_id gives each visitor one personal room and each personal room
one owner. Room 1 has no visitor owner and is treated as central. We added the
`visitors` table without changing existing room/furniture columns. `create_all`
creates that missing table; it is not a general schema migration tool.

The original seed inserted room ID 1 explicitly. That did not move PostgreSQL's
automatic ID sequence, so the next automatic insert could collide with 1. The
seed now locks room initialization and advances the sequence beyond existing IDs,
without rewinding it. Sequence gaps are normal. It renames room 1 to Central room
while preserving furniture and existing personal rooms.

Each personal room receives a starter layout with new furniture UUIDs. Furniture
IDs are globally unique, so copying the central room's `starter-bed` ID would fail.
Server validation also rejects submitted IDs already belonging to another room.

## HTTP flow and ownership

```text
App startup
  -> POST /api/visitor, including any existing visitor cookie
  -> Flask recognizes that ID, or creates Visitor + Room + starter furniture
  -> one PostgreSQL transaction commits the new records
  -> response sets the cookie and returns personalRoomId + centralRoomId
  -> GET /api/rooms/<personalRoomId>
  -> room JSON becomes editor state and 3D furniture

Save
  -> PUT /api/rooms/<personalRoomId>, with cookie and { items }
  -> Flask checks ownership, validates, and commits the replacement

Travel
  -> change selected room ID -> GET the target layout
  -> old editor unmounts -> old socket disconnects
  -> new editor/spawn mounts -> new socket joins the target room channel
```

POST returns 201 for a new visitor or 200 for a recognized visitor. It returns
`{ personalRoomId, centralRoomId: 1 }`, not the secret visitor ID. All API responses
use `Cache-Control: no-store` because access and editing permissions depend on the
cookie, not only the URL.

GET allows the central room and, for initialized visitors, every personal room.
Guests receive `readOnly: true`, owners receive `readOnly: false`, and nonexistent
rooms return 404. GET supplies `readOnly` for the UI. PUT rejects central room writes and
other visitors' rooms before modification. The existing full-layout validation
and atomic replacement still apply to an authorized personal room.

## React lifecycle and live room isolation

`App` initializes the visitor before loading furniture. A ref keeps the initial
POST promise so StrictMode's development effect check does not create two visitors.
The effect ignores an obsolete result instead of assuming aborting an HTTP POST
would undo its server-side changes.

When available, a browser Web Lock serializes initialization across same-origin
tabs. After the first request sets a cookie, the next tab recognizes it. No library
was added. Without Web Locks, normal use works, but simultaneous first visits can
create an extra anonymous room before the final cookie is shared.

Room loading still uses AbortController. `RoomEditor` is keyed by the room ID:
changing that key remounts its furniture, spawn, selection, dirty state, and live
connection. That prevents room A's editor state from leaking into room B. The
connection hook already cleaned up on unmount; no second connection manager was
needed. Room geometry, local movement, camera following, and interpolation remain
the same components.

Flask checks the cookie and target room when a live connection joins. Each entry
in the in-memory player dictionary contains its permitted room ID and pose.
Snapshots filter by that room; join, move, and leave events target only its
`room:<id>` channel. The client cannot redirect a movement event by supplying a
different room ID or player ID. Live positions still never write to PostgreSQL.

## Important files

| File | Receives | Changes/produces | Responsibility |
|---|---|---|---|
| `backend/models.py` | Database model declarations | Adds Visitor and its unique room FK | Describes ownership data |
| `backend/visitors.py` | Request cookie, DB session, target ID | Visitor lookup / access decision | Shares permission rules between HTTP and live joins |
| `backend/app.py` | HTTP, cookie, layout | Visitor creation, cookies, protected GET/PUT | Owns the API and database transactions |
| `backend/seed.py` | Existing DB and starter layout | Creates the visitor table, prepares ID sequence, labels central | Explicit initialization that preserves furniture |
| `backend/realtime.py` | Join/move/leave with a cookie | Room-filtered player snapshots and broadcasts | Prevents cross-room presence leakage |
| `src/api.js` | Room IDs, committed items | Visitor POST and dynamic room GET/PUT | Keeps HTTP/response validation out of UI |
| `src/App.jsx` | Visitor response, selected room, editor actions | Loading/navigation and per-room editor state | Coordinates initialization, travel, and saving |
| `src/RoomUI.jsx` | Room/visitor IDs, readOnly, dirty/placement state | Room buttons and appropriate controls | Makes ownership/travel understandable |
| `src/styles.css` | Navigation classes | Small travel controls/hint styling | Makes new controls clickable over the scene |
| `tests/api.test.js` | Mock responses | Dynamic-ID, cookie request, visitor validation checks | Verifies frontend HTTP behavior |
| `backend/tests/test_api.py` | Real dedicated PostgreSQL DB, multiple clients | Ownership, sequence, persistence and presence checks | Tests server boundaries rather than UI promises |
| `tests/liveRooms.mjs` | Running app URL | Two anonymous network clients | Tests creation/save/travel through actual HTTP and WebSockets |
| `bruno/*.yml`, `bruno/README.md` | Same API contract | Updated visitor/personal-room requests | Keeps hands-on API testing usable |
| READMEs and this guide | Current setup | Updated milestone instructions | Explains the final architecture |

## Run and verify

Initialize explicitly once, and safely repeat when needed:

```bash
DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms' \
  backend/.venv/bin/python -m backend.seed
```

The public Gunicorn command now uses `ROOM_READ_ONLY=false`. This enables saves
only when the visitor owns the personal room; room 1 remains protected regardless
of that setting. `ROOM_READ_ONLY=true` remains an emergency switch disabling all
furniture writes. Keep one Gunicorn worker for the in-memory live player state.

```bash
DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms' ROOM_READ_ONLY=false \
  backend/.venv/bin/gunicorn --worker-class gthread --workers 1 --threads 20 \
  --bind 127.0.0.1:5002 backend.app:app
```

Keep the existing tunnel running on this port to preserve its current hostname.
The existing localhost frontend/backend still run on 5173/5001.

Validation passed: 21 frontend tests, 20 backend tests, the production build,
and live multi-room checks locally and through the public HTTPS URL. The central
layout was verified unchanged. Safari also verified travel home/central, personal
editing, locked central controls, and blocking/canceling an unfinished placement. Bruno passed 8 requests, 16 assertions and 1 script
test. Vite's existing large-bundle warning remains visible.

```bash
TEST_SERVER_URL='https://YOUR-CURRENT-HOST.trycloudflare.com' node tests/liveRooms.mjs
```

That opt-in test creates two real anonymous test rooms, changes/restores one layout,
and leaves both starter layouts in the running database. For repeatable automatic
API tests, use the dedicated `_test` database described in backend/README.md.

## Practice yourself

1. Compare `can_enter_room` with `can_edit_room`. Test that another visitor can
   GET and join your room but their PUT is rejected.
2. Temporarily remove the RoomEditor key and observe stale furniture/editor state
   during travel. Restore it and explain why React remounts on a changed key.
3. Trace a central-to-personal trip: list the HTTP requests, disconnect, snapshot,
   and broadcasts. Explain why simply filtering meshes in React is insufficient.
4. Use two tabs versus two browsers and explain cookie sharing. Clear cookies in
   a disposable test browser and check that the earlier layout still exists in SQL.

For an interview, explain browser identity versus accounts, cookies versus local
React state, one-to-one foreign keys, sequences, server authorization, transactions,
effect cleanup, keyed component lifetimes, and room-scoped event broadcasting.

References: [Flask cookie protections](https://flask.palletsprojects.com/en/stable/web-security/),
[PostgreSQL sequence functions](https://www.postgresql.org/docs/current/functions-sequence.html),
and [Web Locks](https://www.w3.org/TR/web-locks/).
