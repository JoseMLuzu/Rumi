# Connected rooms and Central Garden

This records the earlier visiting milestone. The current central scene has visible
room exteriors and walkable corridors; see [Main Hall](MAIN_HALL.md) for the active
navigation and architecture. `MainHall.jsx` replaces the former `CentralGarden.jsx`.

Your personal room, other visitors' rooms, and room 1 now belong to one browsable
neighborhood. The identity remains the existing random browser cookie.

## Try it

1. Refresh the application. In your room, walk to the front doorway and press E.
2. You arrive in Central Garden, a lounge with stone paving, plants, two seating
   areas, string lights, and an open path through the center.
3. Walk to the garden doorway and press E to browse the neighborhood. The
   **Visit Rooms** button opens the same directory from any room.
4. Choose a neighbor's room. You can walk there and see anyone in that room.
5. Invite your friend to your room number through the same directory. Your green
   avatar and their coral avatar share movement events.
6. Only the owner can decorate and save. When the owner saves, guests reload the
   saved furniture. **My Room** always returns you home.

Save committed changes and finish/cancel placement before traveling. The directory
pauses movement while open. Escape closes it, and its **Refresh rooms** button
loads newly created rooms. Room numbers identify neighbors until names/accounts
are introduced. All persisted rooms are listed, including rooms created by API
playtests and rooms left behind after a visitor loses their cookie.

## What changed and why

Previously, one ownership check controlled both GET and PUT. That prevented visiting.
Now `can_enter_room` permits initialized visitors to enter every existing room;
`can_edit_room` permits only the cookie's own personal room. The central room can
be entered without a cookie, but its layout remains protected. Both HTTP GET and
the live connection use the entry rule. PUT uses the stricter editing rule.

The directory is `GET /api/rooms`, returning `{ rooms: [{ id, name }] }`. It requires
an initialized visitor and never includes the secret visitor UUIDs. No tables or
dependencies were added. Existing `rooms`, `visitors`, and `placed_furniture`
already represent the information we need.

## Travel and data flow

```text
Walk near a door + E, or click a travel control
  -> choose the target room ID
  -> unmount the previous RoomEditor and disconnect its socket
  -> GET /api/rooms/<id> with the visitor cookie
  -> receive saved furniture + this visitor's readOnly permission
  -> mount a new RoomEditor with a safe spawn
  -> connect Socket.IO to room:<id>
  -> receive the room's players and render their avatars
```

Rooms are connected by travel destinations. Each scene still has its own bounded
10×10 floor; crossing the doorway loads the next scene. The door is a visual arch
and an interaction trigger. Walls continue to use the existing movement bounds.
`TravelDoor` checks distance using `useFrame`, but calls React's setter only when
the player changes between near/far. Its E listener is removed on unmount.
The proximity radius is 1.6 units. An intentionally decorated room could block
access to its doorway with furniture; the navigation buttons remain available.

React's `key={room.id}` makes travel understandable: each room receives fresh
editor state, camera/player refs, and a socket connection. Socket cleanup makes
the old avatar leave. A movement packet always stays in the server's stored room;
the client cannot redirect it by sending a different room ID.

## Saved furniture updates

```text
Owner edits -> PUT -> ownership + layout validation -> PostgreSQL commit
  -> room_layout_changed notification to room:<id>
  -> guest GETs the latest room records
  -> guest replaces furniture state -> React rebuilds the scene
```

The notification happens after commit so GET sees saved records. HTTP remains the
source of room data; the live channel only announces that it changed. This use of
`socketio.emit` from a normal HTTP handler is supported by the
[Flask-SocketIO API](https://flask-socketio.readthedocs.io/en/latest/api.html#flask_socketio.SocketIO.emit).
Guests also reload after reconnection to catch saves they missed offline.

If a saved piece overlaps a guest's current position, the frontend moves that
guest to a clear spawn rather than trapping them inside the piece. Preview edits
are local until Save Room. Multiple owner tabs still use the last successful PUT;
this milestone does not implement simultaneous collaborative decorating. Local
and public servers each have their own live player memory, so meeting and live
layout notifications require the same application origin/server.

## Important files

| File | Receives | Changes or produces | Responsibility |
|---|---|---|---|
| `backend/visitors.py` | Cookie, DB session, target ID | Entry/edit decisions | Separates visiting from ownership |
| `backend/app.py` | HTTP, cookie, furniture records | Directory, per-visitor readOnly, saves, live invalidation | API and transactions |
| `backend/seed.py` | New DB | Garden furniture for a new central room | Initialization; keeps existing layouts |
| `backend/redesign_central.py` | Existing room 1 | JSON backup and replacement central furniture | Explicit redesign without changing personal rooms |
| `src/api.js` | Room ID, abort signal | Validated room summaries | HTTP boundary for the directory |
| `src/App.jsx` | Visitor, selected room, live revision | Room state, travel, guest reloads | Coordinates the existing scene/editor |
| `src/Room.jsx` | Central flag, size, editing callbacks | Personal room or garden geometry | Selects the room design |
| `src/CentralGarden.jsx` | Floor size, wall thickness | Stone courtyard, low walls, lights, signage | Shared environment made from basic geometry |
| `src/TravelDoor.jsx` | Player ref, enabled flag, callbacks | Near/far state and E interaction | Door proximity and travel trigger |
| `src/RoomSign.jsx` | Title, subtitle, dimensions | Canvas texture on a plane | Text inside the 3D scene with no external font or DOM overlay |
| `src/RoomDirectory.jsx` | Current room, visitor IDs, travel/close callbacks | Modal and list request state | Destination selection and keyboard focus |
| `src/RoomUI.jsx` | Room, ownership, dirty state, proximity | Labels, visiting controls and prompts | Explains where the visitor is and what they can do |
| `src/useRoomConnection.js` | Room ID, spawn | Peers, status, layout revision | Room-scoped events and reconnection |
| `src/styles.css` | New UI classes | Directory, door prompts/signs | Readable controls over the 3D scene |
| `backend/tests/test_api.py`, `tests/api.test.js`, `tests/liveRooms.mjs` | Dedicated test DB or running server | Regression checks | Visiting, ownership, isolation, notifications and directory validation |
| `bruno/*.yml` | Initialized cookie | GET directory and missing-room checks | Manual HTTP practice |

The central garden furniture remains normal database records and uses the existing
collision logic. The paving and perimeter decoration are scene geometry, outside
the furniture inventory. The ordinary seed preserves saved data; redesigning an
existing room is an explicit separate command:

```bash
DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms' \
  backend/.venv/bin/python -m backend.redesign_central
```

It backs up room 1 to `backend/backups/central-room-<timestamp>.json` first. The
requested redesign was applied to development room 1; personal layouts were kept.
The script should not run automatically at server startup.

## Verification and exercises

Automated checks: 22 frontend tests, 23 backend tests against the dedicated
PostgreSQL test database, production build, and real two-client HTTP/WebSocket
checks locally and through the existing public HTTPS URL. Bruno passed 9 requests,
18 assertions and 1 script test. An isolated browser verified the garden rendering,
walking to the door and pressing E, visiting, returning home, owner-only controls,
and blocked travel during placement, with no runtime exceptions or console errors.
The existing Vite warning about a large 3D bundle remains visible.

Practice these small changes yourself:

1. Change the door's interaction radius and explain why squared distance works.
2. Add a directory filter for room numbers without changing the backend endpoint.
3. Add a central chair through `CENTRAL_ITEMS`, checking its footprint before
   running the redesign command.
4. Write a test showing that a guest can GET/join a room but cannot PUT its layout.
5. Trace an owner save, commit, notification, guest GET and React rerender. Explain
   why sending the notification before commit would be incorrect.

For an interview, explain authentication versus authorization, entry versus edit
permissions, keyed remounts, effect cleanup, HTTP as persisted state, and live
notifications as triggers for reloading it.
