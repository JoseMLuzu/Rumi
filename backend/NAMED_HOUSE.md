# A shared house with saved-name bedrooms

The center is a living room with a sofa, chairs, coffee table, plants, and lamps.
Compact wooden hallways connect it to bedrooms. Rugs, baseboards, warm walls,
curtains, wooden doors, and bed silhouettes make the shared cutaway feel like a house.
The bedroom previews are decorative; each owner's actual saved furniture still
loads when entering a door. The interior editor and its room dimensions are unchanged.

## Try it

1. Open or refresh the app. It asks for a saved name before creating any room.
2. Enter a new name to create one bedroom. Enter the same name again to reopen it.
3. Save a furniture change, refresh, and enter that name to check that it survives.
4. Walk to the front door and press E, or click **Go to Living Room**.
5. You arrive in the hallway beside your named door. Walk to the central seating area.
6. **Find Bedrooms** highlights another named door. Walk there and press E to visit.

`Jose`, `JOSE`, and `  Jose  ` identify the same bedroom. Repeated spaces collapse;
Unicode names are normalized. Names contain 1–24 letters, numbers, spaces, hyphens,
or underscores. Accent differences remain meaningful: `Jose` and `José` are different.
The first spelling supplies the bedroom's display label; later entry does not rename it.

The name is a temporary room key, **not a password or account**. Anyone submitting
that name can reopen and decorate its bedroom. Choosing a different name changes
the browser's current room identity. Cookies are shared across tabs on one host.
People using distinct names can visit each other, but cannot save each other's rooms.

## What happens to the data

```text
NameEntry form -> POST /api/visitor {name: "Jose"}
  -> Flask validates and normalizes -> Visitor primary key "jose"
  -> existing Visitor? return its room ID without touching furniture
  -> new Visitor? create Room + Visitor + starter furniture in one transaction
  -> JSON {name, roomName, personalRoomId, centralRoomId} + HTTP-only cookie
  -> App GETs that room -> editor renders the saved furniture
```

We reuse the existing `visitors.id` Text column instead of adding accounts or
another table. It now holds the normalized name. `rooms.id` remains numeric because
the room API and live channels already use it. This separates a human room key
from a database room ID and a connection's temporary Socket.IO ID.

Submitting the name is the only creation trigger: React mounting, StrictMode, and
loading the landing screen never create a bedroom. The browser remembers the last
typed name in localStorage to prefill the form. Room identity and furniture remain
in PostgreSQL, so clearing browser storage or using another computer does not lose
the bedroom when you enter the same name.

The primary key prevents duplicate names. Two simultaneous first submissions might
both initially find no record. One transaction commits; the other's duplicate-key
error rolls back its new room and starter furniture. Flask then reads the winning
record. There is no orphan bedroom left behind. See
[SQLAlchemy transaction behavior](https://docs.sqlalchemy.org/en/20/orm/session_transaction.html).

## Shared house coordinates

The living room is centered at X/Z = 0/0. Each bedroom preview is 6.4 by 7 units,
with a 3.2-unit hallway. The first entrances are at X = ±8.2, Z = ±1.5; the next
pair is 6.4 units farther along. Four bedrooms fit per bay. Numeric room IDs can
have gaps; sorted directory order determines their compact slots.

`backend/hall.py` returns the dimensions, door names, wing/bay labels, arrival
positions, and two overlapping walking rectangles. React renders those dimensions;
both the player and server use the walking rectangles with the player's radius.
The living-room seating leaves a clear front route between the two hallways.
`TravelDoor` chooses the closest entrance so opposing doors remain distinguishable.
Arrival at a visited bedroom still searches for a clear spot near its interior door.

No new library, table, physics engine, authentication, or networking system was added.
The established public URL still serves the built frontend with the same backend.
The shared living room remains read-only; only a name's own bedroom is editable.

## Reset performed

The old development database contained 22 rooms, including the shared room, and
21 random visitors. The app servers were stopped, and a full PostgreSQL backup
was saved to `backend/backups/before-named-house-20261003.dump` (gitignored).
The reset deleted visitor records, furniture, and rooms in foreign-key order,
then recreated only living room 1 with its new furniture. The room sequence was
reset so the first named bedroom receives ID 2. The servers were restarted.

`backend/reset_house.py` is an explicit destructive command, never a startup hook
or API endpoint. Do not rerun it to start the app; use the normal server commands.
New visits now add bedrooms only for genuinely new saved names.

## File responsibilities

| File | Receives | Changes or produces | Why |
|---|---|---|---|
| `src/NameEntry.jsx` (new) | Typed name, `onEnter` callback | Entry request, busy/error feedback, last-name prefill | Makes creating/reopening a bedroom deliberate |
| `src/App.jsx` | Returned identity and room data | Mounts entry first; loads the bedroom; supplies named doors | Coordinates entry and scene travel |
| `src/api.js` | Saved name | JSON POST and validated identity response | Keeps HTTP outside the form |
| `backend/visitors.py` | Typed name or cookie | Normalized name key; current visitor and edit checks | Uses the same identity rules for entry and saving |
| `backend/models.py` | Existing schema | Updated Visitor ID explanation | The Text primary key now stores names instead of UUIDs |
| `backend/app.py` | POST name | Creates/reuses bedroom atomically, sets cookie, notifies hall on creation | Prevents returning visitors from adding rooms |
| `backend/hall.py` | Ordered room records | Compact dimensions, labeled doors, floor limits | Keeps the rendered house and live movement consistent |
| `src/hallLayout.js` | Hall response | Validated dimensions/labels and safe arrivals | Rejects malformed scene data before rendering |
| `src/MainHall.jsx` | Hall dimensions and doors | Living-room shell, wooden hallways, bedroom previews | Draws the house using understandable repeated geometry |
| `src/TravelDoor.jsx` | Door list and player position | Closest-door interaction and wooden doors | Supports narrower indoor hallways |
| `src/RoomUI.jsx`, `src/RoomDirectory.jsx` | Room names and destinations | Named navigation, bedroom directory, living-room labels | Replaces apartment numbers with people’s bedrooms |
| `src/CameraController.jsx` | Player/arrival refs | Closer follow view | Keeps the smaller house readable |
| `src/styles.css` | Entry form and existing UI | Name form styling | Makes first entry usable and coherent |
| `backend/seed.py` | Explicit seed command | New living-room name and central seating layout | Initializes missing room 1 without resetting saved bedrooms |
| `backend/reset_house.py` (new) | Explicit command | Deletes existing data and recreates room 1 | Performs the requested one-time clean start |
| API/layout tests and `tests/liveRooms.mjs` | Test fixtures or isolated server | Recovery, concurrent entry, persistence, boundaries and visiting checks | Verifies behavior across requests and connections |
| Bruno entry request/environment | `savedName` | Sends the new JSON entry contract | Lets you practice name entry with the API client |
| READMEs and this guide | — | Updated current workflow and historical-guide links | Keeps the learning path accurate |

## Verification and exercises

27 frontend tests, 32 PostgreSQL backend tests, and the production build passed.
HTTP/WebSocket checks covered named-room recovery, visiting, owner-only saves,
and walking beyond personal-room bounds. An isolated browser verified the name
form creates no room until submission, cookie loss followed by case-insensitive
name entry restores saved furniture, and actual WASD walking connects the living
room and bedroom doors. No browser runtime exceptions or console errors occurred.
These mutation checks used the separate test database, leaving development with
only room 1 after the reset. The updated Bruno collection also passed all 9 requests,
18 assertions, and its script test against that isolated server. The public URL
was checked for the current build, living-room layout, empty bedroom directory,
and rejection of an empty name without creating a room.
The existing Vite large-bundle warning is still visible.

Try these yourself:

1. Write examples of names that should match and names that should differ; extend
   the normalization test before changing the rule.
2. Trace why an existing name returns HTTP 200, while a new name returns 201.
3. Sketch the four door positions and calculate a safe arrival using player radius.
4. Change the hallway runner or bedroom blanket colors in MainHall without touching
   the persisted furniture records.
5. Explain the two-browser race: why must the losing transaction roll back its Room
   as well as its Visitor? Read the concurrent-entry test and remove that guarantee
   only in the test database to see what could go wrong.

For an interview, explain unique keys, name normalization, transaction rollback,
HTTP cookies versus localStorage, room identity versus connection identity, and
why name-based access is intentionally not authentication.
