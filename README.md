# Rumi

La guía actual de los 24 objetos interactivos, pruebas, arquitectura y límites está en [INTERACTIVE_OBJECTS.md](INTERACTIVE_OBJECTS.md).

A small 3D social app built with React, Vite, Three.js, React Three Fiber, and Drei. React owns the editor state; Flask, SQLAlchemy, and PostgreSQL persist accounts, spaces, bedrooms, furniture, and membership. Read [Spaces](SPACES.md) for the current create/invite/join flow and learning walkthrough, and [Accounts](ACCOUNTS.md) for login and reserved-bedroom activation. The original house is preserved as **gci**.

The [named-house walkthrough](backend/NAMED_HOUSE.md) describes the earlier saved-name milestone; its entry and reset instructions are historical. The [main-hall](backend/MAIN_HALL.md), [room-travel](backend/ROOM_TRAVEL.md), and [personal-room](backend/PERSONAL_ROOMS.md) guides describe earlier milestones. Use [the backend setup and HTTP walkthrough](backend/README.md). The frontend requires the room API to load its scene.

The [proximity-voice walkthrough](backend/PROXIMITY_VOICE.md) explains avatar names,
opt-in microphone controls, WebRTC signaling, distance-based volume, and optional TURN.

Log in with different accounts in two browsers, accept an invitation to the same space, then meet in its living room.
Follow [the multiplayer learning guide](backend/MULTIPLAYER.md)
for the new backend startup command, data flow, tests, limitations, and exercises.

To share a temporary public link with someone on another network, follow
[the public playtest guide](backend/PUBLIC_PLAYTEST.md). It serves the built app
through Gunicorn and Cloudflare Tunnel with owner-only personal-room saves.

## Run it

```bash
npm install
npm run dev
```

Start PostgreSQL, seed room 1, and run Flask on port 5001 using the backend guide. Then open the URL Vite prints. `npm run build` builds the application, and `npm test` runs the layout and API tests with Node's built-in test runner.

## Try the MVP

- Use WASD to walk. Directions are relative to the camera.
- Create an account, then create a space or accept an invitation. Existing users keep their gci bedrooms.
- Use **Spaces** to switch houses or generate a shareable invitation as a host.
- Walk to your bedroom's front doorway and press **E** to reach the shared living room beside your named entrance.
- Follow the cozy hallways past bedroom previews. Press **E** near a door to load its saved interior.
- Use **Find Bedrooms / Find My Door** to highlight a destination, then walk there. Only your personal room is editable.
- Players in the same hall or room see each other; guests receive saved furniture updates.
- Chosen names appear above the avatars. Both players can click **Join Voice** to
  talk nearby; mute or leave with the panel controls. Room travel stops the mic.
- Click **Edit Room**. Movement pauses and the camera opens to an overview.
- Choose one of six pieces. Move its preview over the floor and click to place it.
- Green outlines mean a placement fits; red outlines come with a reason in the panel.
- Click existing furniture to select it. Use **Move**, **Rotate 90°**, or **Delete**.
- After clicking **Move**, click the destination on the floor. **Cancel** restores the original piece.
- Click **Done decorating** to walk again.
- Click **Save Room** to persist committed furniture to PostgreSQL, then refresh to reload it. Cursor previews are never saved.

The room begins with a bed, sofa, table, chair, plant, and lamp. An intentionally empty room also stays empty after refreshing. Furniture cannot overlap other pieces or your character. Rotation is restricted to quarter turns to keep placement and collision calculations simple.

## Learning walkthrough

### 1. Project structure

The existing Vite configuration and React entry point remain in place. The source stays mostly flat because this is a small application:

```text
src/
  main.jsx
  api.js
  App.jsx
  Room.jsx
  Player.jsx
  PlayerAvatar.jsx
  RemotePlayer.jsx
  useRoomConnection.js
  CameraController.jsx
  Furniture.jsx
  RoomUI.jsx
  roomLayout.js
  styles.css
  data/
    furniture.js
tests/
  roomLayout.test.js
```

`App` first loads the room through `api.js`, then mounts the editor that owns committed furniture and editor state. Scene components draw the room and animate the player. The UI calls App's action functions. `roomLayout.js` contains placement and collision rules plus retained legacy browser-storage helpers. See the backend guide for the added Python files.

### 2. How Canvas creates the 3D environment

React DOM mounts App into the HTML root. App includes Fiber's Canvas, which creates the Three.js renderer, scene, default camera, and animation loop. The children inside Canvas describe Three.js objects. Ordinary HTML controls sit in a separate overlay outside Canvas.

The camera configuration is a constant so editor rerenders do not reset it. Shadows are enabled on Canvas; the directional light casts them, and surfaces use `castShadow` and `receiveShadow` where appropriate.

### 3. How the room is constructed

Room combines a floor, plank strips, four walls, baseboards, a window, and a rug. All are basic geometry. Two front walls are low to provide a cutaway view. The coordinate system uses X/Z for the floor and Y for height. Floor pointer events supply the world-space point under the cursor.

### 4. How player movement works

Player records held keys in a ref. Its frame callback projects the camera's forward direction onto the floor, calculates a right direction, and combines those with the keyboard input. Normalizing the resulting vector prevents faster diagonal movement. Distance is speed multiplied by elapsed seconds.

Keyboard listeners are installed only while walking is enabled. Cleanup, window blur, and visibility changes clear the keys, avoiding duplicate listeners and stuck input. The visual character turns toward its travel direction and bobs slightly while moving.

### 5. How useFrame is used

Player updates its Three.js group position before each rendered frame. CameraController then updates the camera. Player's negative callback priority makes that ordering explicit without taking over rendering. No React state setter runs in these frame callbacks.

Frames longer than 0.1 seconds are capped to avoid a jump after pausing; movement deliberately slows during exceptionally slow frames.

### 6. How the camera follows the player

CameraController reads the shared player ref and calculates a desired camera position above and behind it. Both camera position and look target ease toward their destinations with `lerp`. The blend `1 - exp(-5 * delta)` makes smoothing consistent across frame rates. Edit Mode uses a fixed overview target, slightly offset to leave space for the inventory.

### 7. How collisions and boundaries work

The player has a circular footprint. Furniture has rectangular footprints from the catalog. A nearest-point calculation detects whether the player's circle intersects a rectangle. Room boundaries account for the player's radius. Movement checks X and Z separately, allowing sliding along obstacles, and uses small substeps to avoid crossing obstacles in slow frames.

Quarter-turn furniture rotations swap width and depth. Placement checks the whole footprint against the walls, other furniture, and the player. These are intentionally conservative floor footprints: the character cannot walk under a table.

### 8. How Edit Mode works

App holds `isEditing`, `selectedId`, and a separate `placement` preview. Toggling Edit Mode clears selection and unfinished previews. RoomUI shows the inventory and selected-piece actions; Player receives `enabled={false}` while editing. Exiting during a move cancels it and retains the original record.

### 9. How furniture placement works

An inventory click starts an add preview. A floor pointer event provides X/Z, which are snapped to a half-unit grid and clamped inside the room. The preview shows a validity outline. A valid floor click inserts a new record or replaces the record being moved. Selected furniture stops click propagation so the floor behind it cannot deselect it on the same click.

Furniture translates each type into basic meshes. Its group position and Y rotation come directly from the plain record. The small BoxPart helper uses Drei RoundedBox to keep edges and materials consistent.

### 10. How state flows through the application

```text
UI action or floor click
  -> App validates the action
  -> App updates the furniture array immutably
  -> Furniture components receive new records
  -> unsaved indicator
  -> Save Room sends the committed array to Flask
  -> PostgreSQL transaction commits the layout

Keyboard event
  -> held-key ref
  -> Player frame callback
  -> Three.js position
  -> CameraController reads that position
```

State is for changes that should rerender React: furniture, selection, previews, and edit mode. Refs are for continuously changing animation data and Three.js objects. All shared state has one clear owner, so Zustand is unnecessary here.

### 11. How persistence works

Startup calls GET /api/auth/session, then GET /api/spaces to choose a membership, then GET /api/rooms/<personalRoomId>. After loading succeeds, App initializes the editor and calculates a clear player spawn. Save Room calls PUT on that personal room with `{ items }`; Flask checks the authenticated session and membership permissions, then validates the entire layout and saves it in one PostgreSQL transaction. Failure keeps the unsaved edits in React for retry. No meshes, refs, camera positions, or cursor previews are serialized. See the backend guide for the request/response flow and transaction walkthrough.

The previous `social-rooms:layout:v1` entry remains untouched. Its helper functions are retained for legacy format tests and manual migration; the running editor uses the API. An unavailable server shows an error rather than silently loading browser defaults.

## Responsibilities and data

| File | Receives/reads | Changes/produces | Why it exists |
|---|---|---|---|
| `App.jsx` | API-loaded layout and action callbacks | React furniture/editor state; explicit save and request status | One owner connects scene, controls, and persistence |
| `Room.jsx` | Dimensions, edit flag, floor callbacks | Room geometry; emits floor coordinates | Separates static environment and floor interactions |
| `Player.jsx` | Enabled flag, furniture records, spawn, player ref | Key refs and the player group's position/visual orientation | Owns input and movement |
| `CameraController.jsx` | Player ref, edit flag, viewport size | Camera position and look direction | Separates camera motion from character motion |
| `Furniture.jsx` | One record, selection/preview flags, select callback | Meshes and outlines; emits selection | Reconstructs every piece from plain data |
| `RoomUI.jsx` | Editor state, save status, action callbacks | HTML controls; invokes callbacks | Keeps UI markup out of game components |
| `roomLayout.js` | Records, candidate positions, legacy storage | Bounds, validity, spawn, legacy JSON | Shares testable rules between movement and editing |
| `api.js` | Committed furniture or an abort signal | GET/PUT requests, response validation, errors | Keeps networking separate from editor actions |
| `data/furniture.js` | No runtime input | Catalog and starter records | One readable source for furniture dimensions/types |
| `styles.css` | UI classes and viewport | Overlay layout, colors, and feedback styles | Keeps page styling separate from rendering |
| `tests/roomLayout.test.js` | Actual layout helpers and fake storage | Assertions | Protects geometry rules and persistence behavior |

The React packages, lockfile, entry point, and HTML setup were reused. `vite.config.js` adds a development API proxy; `.gitignore` excludes the Python environment, caches, and local environment files. Backend dependencies are declared separately in `backend/requirements.txt`.

## Five learning exercises

1. Change player speed and explain why travel distance remains consistent at different frame rates.
2. Change camera offsets and smoothing strength; compare a slower follow with a closer view.
3. Reimplement `getFootprint` and test all four rotations of the bed.
4. Change the placement grid to quarter units and keep the visible grid aligned with it.
5. Add a small bookshelf: catalog dimensions, a geometry model, an inventory icon, and a placement test.

For an interview, practice explaining state versus refs, immutable updates, effect cleanup, normalized vectors, delta time, collision footprints, event propagation, and serializing plain data.

## Verification notes

The spaces milestone passes 48 frontend and 84 backend tests, plus a production build and isolated browser create/invite/join/switch checks. See [Spaces](SPACES.md). The notes below describe the earlier MVP verification.

All 26 frontend tests and the production build passed. Python source compiles, and
all 27 backend tests pass against PostgreSQL, including HTTP transactions and live
player events. Two actual WebSocket clients verified room isolation, visiting, owner-only saves, central joins, movement in both
directions, leaving, and reconnection through Vite. Safari rendered the room with
connected green/coral avatars. See [the multiplayer guide](backend/MULTIPLAYER.md)
for details. The saved furniture was preserved. Flask and Vite run on ports 5001
and 5173. Vite's large-bundle warning remains visible; npm audit reports zero
vulnerabilities after two transitive patch updates.
