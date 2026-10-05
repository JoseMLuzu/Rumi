# First backend milestone

The editor uses username/password accounts with PostgreSQL sessions. Read
[the accounts walkthrough](../ACCOUNTS.md) for signup, login, reserved bedroom
activation, HTTP/Socket.IO permissions, migration and learning exercises. Room 1
is gci’s preserved living room. Read [Spaces](../SPACES.md) for multiple houses,
membership and invitation links. Each living room is editable by hosts of its space.
Earlier named-house guides describe the previous name-only identity system.
Los 24 objetos y sus pruebas están documentados en [INTERACTIVE_OBJECTS.md](../INTERACTIVE_OBJECTS.md).
Floor, wallpaper and backdrop customization is described in [Room appearance](../ROOM_APPEARANCE.md).

The earlier live milestone is described in [the multiplayer guide](MULTIPLAYER.md).
See [proximity voice](PROXIMITY_VOICE.md) for current names, audio signaling, and ICE settings.
To share it across networks, use [the temporary public playtest guide](PUBLIC_PLAYTEST.md).

## Run locally on your Mac

The local setup was completed after command permissions were updated: PostgreSQL
18.6 and the Python dependencies are installed, both databases exist, and room 1
is seeded. Flask and Vite were started on ports 5001 and 5173. The commands below
document how to set up another machine or restart the services later.

### 1. Install and start PostgreSQL

If you already have a running PostgreSQL server, use that connection and skip
installation. For a new Homebrew installation:

```bash
brew install postgresql@18
brew services start postgresql@18
export PATH="$(brew --prefix postgresql@18)/bin:$PATH"
createdb social_rooms
```

Homebrew initializes the server's data directory. `createdb` creates an empty
application database; it does not create our tables. The PATH change applies only
to this terminal. The service command starts PostgreSQL and starts it at login.
An existing `social_rooms` database should be kept, not deleted or recreated.

Installation reference: [PostgreSQL on macOS](https://www.postgresql.org/download/macosx/)
and [Homebrew's PostgreSQL formula](https://formulae.brew.sh/formula/postgresql@18).

### 2. Install Python dependencies and configure the connection

From the project root:

```bash
cd /Users/josemanuel/Developer/experiments/social-rooms
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
export DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms'
```

This local connection uses your macOS account as the database role. If your server
uses a different role, password, host, or port, set DATABASE_URL accordingly.
The variable must be set in every terminal that starts the backend or seed script.
There is no automatic `.env` loader. Credentials belong to the backend environment,
never frontend code or a VITE-prefixed variable.

The virtual environment keeps this project's packages separate from system Python.
Flask handles HTTP, SQLAlchemy handles models and transactions, and psycopg talks
to PostgreSQL. Flask-SocketIO and simple-websocket support the new live player path. The binary extra avoids requiring a local compiler for the driver.

### 3. Update an existing database, or initialize a new one

For an existing Social Rooms database, run the non-destructive object migration first:

```bash
backend/.venv/bin/python -m backend.migrate_objects
backend/.venv/bin/python -m backend.migrate_appearance
backend/.venv/bin/python -m backend.migrate_auth
backend/.venv/bin/python -m backend.migrate_spaces
```

It backs up saved furniture and adds scale/config/state/revision, the room access flag,
and media metadata. Install the current requirements first (they now include Pillow).
User files live in `backend/uploads/`; back them up separately from PostgreSQL.

For a fresh database, initialize the central room:

```bash
backend/.venv/bin/python -m backend.seed
```

This creates missing tables (including visitors), labels room 1 as central, and
prepares its automatic ID sequence. Running it again preserves saved furniture.
Personal rooms are created when an account creates or joins a space. Signup alone
does not grant membership. Flask startup never resets data.

`create_all` is suitable for this first schema. It does not migrate existing table
definitions; introduce migrations when we actually change the schema.

Inspect the result directly:

```bash
psql -d social_rooms -c 'SELECT id, name FROM rooms;'
psql -d social_rooms -c 'SELECT id, type, position_x, position_z FROM placed_furniture ORDER BY id;'
```

### 4. Start Flask

```bash
backend/.venv/bin/python -m backend.run
```

Port 5001 also avoids the common macOS AirPlay conflict on 5000. This is a local
development server. Use a second terminal for:

```bash
curl -i http://127.0.0.1:5001/api/health
curl -i http://127.0.0.1:5001/api/rooms/1
```

Health proves HTTP is working. Room endpoints require an authenticated cookie;
a plain curl receives 401. Log in through the browser or Bruno to check the database path. Database failures return JSON with status 503 and a traceback in Flask's
terminal. Correct the connection or missing schema rather than suppressing it.

### 5. Start React

In another terminal, from the project root:

```bash
npm run dev
```

Open the address Vite prints. The existing configuration now forwards `/api`
requests to Flask on port 5001. If Vite was already running and did not pick up the
configuration, restart it. No Flask-CORS dependency is needed for this development
proxy. The proxy applies to the Vite development server, not the production build.

### 6. Verify a real save

1. Open the room and enter Edit Mode.
2. Move a piece and commit the placement by clicking the floor.
3. Click **Save Room**; wait for **Saved to database**.
4. Refresh and verify the position.
5. Stop and restart Flask, refresh again, and verify it still persists.
6. Stop Flask after loading the room, make another edit, and attempt to save.
   Verify the error appears and the editor retains the unsaved changes.

There is no autosave. Exiting Edit Mode does not save. An unfinished cursor preview
cannot be saved. The page asks the browser to warn before leaving with committed
unsaved changes; browser behavior determines whether that warning appears.

## API contract

`GET /api/rooms/1` returns status 200 with:

```json
{
  "id": 1,
  "name": "Central room",
  "readOnly": true,
  "items": [
    {"id": "starter-bed", "type": "bed", "position": [-3.2, 0, -2.7], "rotation": 0}
  ]
}
```

The example shows one piece; the seed contains six. Rotation is radians around Y.
First GET /api/auth/session, then POST /api/auth/login or /register with the returned
X-CSRF-Token and retained cookie. The response contains `user.personalRoomId`,
`user.centralRoomId` and a new CSRF token. Ordinary accounts cannot save room 1;
accounts with the host role can.
Living-room PUT requests include `layoutVersion` from the latest GET to reject stale edits.
`PUT /api/rooms/<personalRoomId>` requires the owner cookie, Content-Type
`application/json`, the current X-CSRF-Token header, and a body containing
the entire committed array: `{ "items": [...] }`. It returns the saved room in the
same shape after commit succeeds. Inaccessible personal IDs and unauthorized
saves return 403; missing login returns 401; a missing central room returns 404. PUT never creates rooms. Missing or invalid items return 400. Wrong content types return 415.

An empty items array deliberately clears the saved furniture. Items absent from
the submitted array are removed. Stable IDs make repeating a PUT idempotent: it
does not add duplicates. The room's id and name are not editable through this API.

Both HTTP errors and database errors return `{ "error": "..." }` for React to
display. A failed save leaves the frontend edits available for retry. A failed
load shows a retry screen rather than displaying and saving defaults.

## Learning walkthrough: what changed and why

### 1. Python environment and dependencies

`.venv` is an isolated Python installation for this project. `requirements.txt`
declares three direct dependencies; their supporting packages are installed
automatically. No Docker, Flask-SQLAlchemy, CORS package, or state library was added.

### 2. Flask and HTTP

`app.py` maps an HTTP method and URL to a Python function. A GET reads. A PUT
replaces this room's saved furniture. A POST would normally create a new resource,
which this milestone does not need. Flask serializes returned dictionaries to JSON.
The `<int:room_id>` segment passes an integer into the handler; only room 1 is seeded.

### 3. Database connection

`database.py` reads DATABASE_URL and creates the engine. An engine manages database
connections. `SessionLocal` creates a session for each request, so database work
does not leak between requests. A context manager closes the session even if the
operation fails. Creating the engine does not create tables or seed data.

### 4. Relational models

`models.py` defines `rooms` and `placed_furniture`. Room.id is a primary key.
PlacedFurniture.room_id is a foreign key referencing it. A relationship exposes a
room's furniture as Python objects; the foreign key is the actual database rule.
Furniture IDs are text because the existing starter IDs are not UUIDs.

Position becomes three database columns and is reconstructed as `[x, y, z]` in JSON.
The type selects frontend geometry; mesh data does not belong in the database.

### 5. Explicit initialization

`seed.py` creates the initial room only when you run it. Its existing-room check
prevents startup or repeated setup from erasing your work. The seed includes the
same six starter pieces as the frontend; it does not import Python from JavaScript.

### 6. GET and serialization

Flask opens a session, queries Room, and uses `to_dict` while the session is still
open. Accessing the relationship reads its furniture. The response contains plain
records that React can immediately render. Pieces are ordered by ID for predictable
responses; rendering does not depend on their original array order.

### 7. Server validation

`validation.py` validates the full submitted array before deletion begins. It
checks IDs, types, numeric coordinates, floor height, quarter turns, room boundaries,
overlap, and a free player spawn. It rejects the entire invalid request rather than
silently dropping records. It also rejects booleans as coordinates because Python
treats bool as a kind of integer. The development room accepts at most 200 pieces.

The six footprints and room constants mirror the frontend. Update both when
changing the room or catalog. This small duplication is explicit; a shared catalog
service would add complexity before this milestone needs it. Live player positions now travel over Socket.IO and remain outside this furniture
validator; this validator checks that a spawn exists, not a live avatar position.

### 8. PUT and transactions

After validation, Flask finds the room, deletes its old furniture, inserts the new
records, and commits once. The deletes execute before inserts to avoid conflicts
with unchanged primary keys. If insertion or commit fails, the context manager
rolls back the deletion too. Success is returned only after commit completes.

This complete-layout replacement is suitable for one development client. There
is no concurrent editor conflict handling: the last successful save wins.

### 9. React loading and explicit saving

`api.js` contains the HTTP details. App starts in a loading state, performs GET,
and mounts RoomEditor only after success. This ensures spawn calculation uses the
loaded furniture. AbortController cancels obsolete requests, including React
StrictMode's development mount/cleanup cycle.

RoomEditor keeps the existing furniture and edit state. Immutable updates create
a new items array; comparing it with the last saved array marks the room dirty.
Save captures the current array as a snapshot and sends PUT. If you edit while
that request is pending, those newer edits remain dirty when the older save ends.

`fetch` can resolve even for HTTP 400 or 503, so api.js checks `response.ok`. Invalid
JSON and invalid room records also become visible errors. No server outage silently
falls back to a different persistence system.

### 10. Complete data flow

```text
Startup:
App -> api.js GET -> Vite proxy -> Flask -> SQLAlchemy -> PostgreSQL
PostgreSQL rows -> room JSON -> App state -> Furniture meshes

Editing:
UI/floor actions -> committed items array -> unsaved indicator
Save Room -> api.js PUT -> Flask validation -> database transaction
Successful commit -> successful response -> saved indicator
```

Player movement is now relayed over Socket.IO, while camera animation, selection,
and placement previews remain local. There is no database request on every
animation frame or cursor movement. See MULTIPLAYER.md for the separate live path.

## Files and responsibilities

| File | Receives/reads | Changes/produces | Why it exists |
|---|---|---|---|
| `requirements.txt` | Dependency declarations | Packages installed into .venv | Repeatable setup |
| `__init__.py` | Python package import | Marks backend as a package | Supports module commands and relative imports |
| `database.py` | DATABASE_URL | Engine, sessions, shared Base | One database connection setup |
| `models.py` | Database columns / furniture records | ORM objects and JSON dictionaries | Describes and translates stored data |
| `validation.py` | Submitted layout | Validated records or ValueError | Keeps invalid layouts out of storage |
| `seed.py` | Starter records and current database | Creates missing schema and room 1 once | Safe, explicit first initialization |
| `app.py` | HTTP requests | JSON responses and committed DB changes | Defines the API boundary |
| `src/api.js` | Abort signal or committed furniture | HTTP requests, validated room, errors | Keeps networking out of editor actions |
| `src/App.jsx` | Loaded room, editor actions | Loading, furniture, dirty/saving/error state | Owns application state |
| `src/RoomUI.jsx` | State and callbacks | Save button and feedback | Makes persistence visible |
| `vite.config.js` | Development /api requests | Forwards requests to Flask | Connects local frontend and backend |
| `src/styles.css` | Loading and button classes | Loading screen and disabled controls | Clear loading/failure presentation |
| `.gitignore` | Local artifact paths | Excludes environment, caches, secrets | Keeps generated files out of source control |
| `src/roomLayout.js` | Furniture / optional browser storage | Existing geometry helpers; legacy storage utilities | Reuses frontend placement rules |
| `tests/api.test.js` | Mock HTTP responses | Frontend API assertions | Checks request format and error handling |
| `backend/tests/test_validation.py` | Valid and malformed payloads | Validation assertions | Runs without database or dependencies |
| `backend/tests/test_api.py` | Dedicated PostgreSQL test database | API/transaction assertions | Verifies real ORM and PostgreSQL behavior |

## Existing browser layouts

The old `social-rooms:layout:v1` localStorage entry was not deleted. The running
editor no longer reads or writes it. The old helpers and tests remain for reading
that format. PostgreSQL starts with the seed, not an automatic browser import.

If you want to carry your earlier browser layout across, first GET the database
room and review it. Then inspect the old entry in browser developer tools, copy its
`items`, and submit them as a PUT after choosing which layout to keep. This replaces
the database layout; do not import blindly. The server validates the same furniture
format. No Three.js objects or localStorage version field belong in the request.

## Tests

For hands-on HTTP testing, open the project's `bruno/` folder in Bruno and select
the Local environment. See [the Bruno walkthrough](../bruno/README.md) for GET,
PUT, validation errors, and response assertions. The save example replaces the
complete layout, so update its body from the latest GET before sending it.

Frontend and standalone Python validation:

```bash
npm test
npm run build
backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

API tests are skipped unless TEST_DATABASE_URL is set. They require installed
dependencies and a real, dedicated PostgreSQL database; there is no SQLite substitute.
The tests clear their database tables between cases, so never use your development
database for this variable. The test database name must end in `_test`.

```bash
createdb social_rooms_test
export TEST_DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms_test'
backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

API tests cover loading, missing rooms, replacement, repeated PUTs, empty rooms,
invalid input, malformed JSON, rollback after an insertion failure, and non-resetting
seeds. Read the Flask terminal for unexpected failures rather than hiding warnings.

Verification of the original HTTP milestone: all 12 backend tests passed against PostgreSQL, including the five
API tests previously blocked by setup restrictions. The prior 18 frontend tests,
Python compilation, and Vite build passed. A live GET/PUT check through Vite saved
a temporary furniture change, restarted Flask, confirmed persistence, and restored
the original six-piece layout. The frontend HTML was also served successfully.
Interactive browser controls have not been checked in this session.

Installed Python versions: Flask 3.1.3, SQLAlchemy 2.1.3, and psycopg 3.3.6. Homebrew
reported that macOS 27 is a pre-release version outside its supported configurations;
installation and the database tests still succeeded. Flask's development-server
notice is expected for this local setup. Vite's existing large-bundle warning
remains visible; it was not suppressed.

## Practice next

1. Rewrite the GET handler and explain why serialization happens before closing the session.
2. Add one validation rule with a failing test before changing the validator.
3. Reimplement dirty/saving/error feedback and explain how HTTP failures differ from network failures.
4. Change one furniture position through PUT, then inspect its row with psql.
5. Walk through the rollback test and explain why the old layout survives the failed insert.

For an interview, practice explaining an HTTP endpoint, GET versus PUT, primary and
foreign keys, ORM versus driver, transaction atomicity, asynchronous React loading,
and why client validation does not replace server validation.
