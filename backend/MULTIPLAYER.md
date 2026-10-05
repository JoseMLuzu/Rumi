# First multiplayer exercise: two players, one room

This guide records the earlier one-room milestone. See [Personal rooms](PERSONAL_ROOMS.md)
for the current architecture. Open the app in two browsers and choose Central Room
in both; that shared space is room 1.
Each tab controls its own green avatar with WASD; other players appear in coral.
Both start at the same spawn, so move one away to see the two avatars clearly.
The header reports the player count. Close a tab and its avatar disappears.
Refresh it and a new connection joins again.

This is a local networking test, not a published internet app. There are no
accounts, login, chat, or additional rooms. Another database room would create
another saved layout; it would not make players meet in real time.

The next step now supports [temporary public playtests](PUBLIC_PLAYTEST.md) from
this Mac. Use that guide for the public server command and shareable URL.

## Start the services

Keep PostgreSQL running and preserve the existing room. From the project root:

```bash
export DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms'
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m backend.run
```

In another terminal:

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Stop the old backend before starting the new one on port 5001. Use `backend.run`
instead of `flask run`: Socket.IO has its own runner for WebSockets. Both services
bind only to localhost. The runner uses Werkzeug development serving with the
debugger/reloader off; `allow_unsafe_werkzeug` explicitly permits that development
server. This is not a production deployment setting.

Dependencies added: `socket.io-client` in React, `Flask-SocketIO` and
`simple-websocket` in Python. Socket.IO is an event protocol using a WebSocket
transport here; a raw WebSocket client cannot exchange its events directly.
No database tables, migrations, physics engine, or shared state library were added.

## Learning walkthrough

1. **Load furniture first.** The existing GET loads room 1 from PostgreSQL. React
   finds a clear spawn, then mounts the editor and opens its live connection.
2. **Send connection data.** `useRoomConnection` sends `roomId`, `position`, and
   `rotation`. Socket.IO calls this payload `auth`, but ours does not authenticate
   anyone. It simply identifies which development room to join and the initial pose.
3. **Assign an identity.** Flask uses `request.sid` as the temporary player ID.
   Refresh/reconnection gets a new ID. It is not a user account.
4. **Send a snapshot.** Flask adds the player to its in-memory dictionary and
   `room:1` Socket.IO channel. `room_state` gives the newcomer all current poses;
   `player_joined` tells the other connections about that newcomer.
5. **Move locally.** `Player` still reads keys, calculates camera-relative movement,
   multiplies speed by delta, and checks walls/furniture every animation frame.
   Networking does not delay local controls or change the camera follow code.
6. **Publish a pose.** The movement loop calls `publishPose`. The hook sends changed
   poses at most once every 50 milliseconds (20 per second), rather than every render
   frame. A ref retains the latest pose even while disconnected. No pose is emitted
   during an outage, so offline movement does not build up a send backlog.
7. **Relay movement.** Flask checks finite numbers, ground height, rotation, and room
   bounds. It updates the sending connection's pose and sends `player_moved` to the
   others. Any client-supplied ID is ignored. A lock protects snapshots and updates
   because different connections can run on different Python threads.
8. **Render peers.** The hook updates React's peer records. `RemotePlayer` reads one
   record each frame and interpolates its mesh toward the latest position.
   Exponential smoothing uses delta to behave similarly at different frame rates.
   Rotation takes the shortest turn when crossing -π/π.
9. **Leave/reconnect.** Flask removes disconnected players and sends `player_left`.
   The hook clears peers during an outage. Socket.IO retries; reconnection sends
   the latest local pose and receives a fresh snapshot.
10. **Clean up.** The React effect removes listeners and disconnects on unmount.
    This also handles StrictMode's development setup/cleanup cycle without leaving
    a duplicate live connection behind.

```text
Durable layout:
React -> HTTP GET/PUT -> Flask -> SQLAlchemy -> PostgreSQL

Live movement:
WASD -> Player/useFrame -> connection hook -> Vite WebSocket proxy
     -> Flask/players dictionary -> other connection -> peers state
     -> RemotePlayer/useFrame -> interpolated mesh
```

A live record is `{ id, position: [x, 0, z], rotation }`. Three.js groups and vectors
never cross the network. Movement never writes database rows. Restarting Flask
empties live presence; the furniture stays in PostgreSQL.

## Files and responsibilities

| File | Receives | Changes/produces | Why it exists |
|---|---|---|---|
| `backend/realtime.py` | Connection and pose events | In-memory players and room events | Owns live presence separately from saved layout |
| `backend/run.py` | Flask app | Local Socket.IO serving | Enables WebSocket transport |
| `backend/app.py` | Existing HTTP requests | Also initializes Socket.IO | Shares one backend with the durable API |
| `backend/requirements.txt` | Package constraints | Adds event server and transport | Repeatable Python installation |
| `src/useRoomConnection.js` | Room ID, spawn, poses, server events | Connection lifecycle, peers, status | Keeps networking out of editor actions |
| `src/Player.jsx` | Keys, furniture, spawn, publish callback | Local movement and outgoing pose | Retains responsive local controls |
| `src/PlayerAvatar.jsx` | Shirt color | Shared avatar geometry | Avoids duplicating character meshes |
| `src/RemotePlayer.jsx` | One peer's latest record | Interpolated mesh transform | Bridges network updates and rendering |
| `src/App.jsx` | Loaded room and live hook result | Mounts peers and passes callbacks | Connects live presence to the scene |
| `src/RoomUI.jsx`, `src/styles.css` | Connection state and player count | Live status and color hint | Makes networking visible |
| `src/api.js` | Furniture saves | Clarified comment only | Documents that poses use the live path |
| `vite.config.js` | `/socket.io` traffic | WebSocket upgrade forwarding | Keeps frontend traffic on one origin |
| `package.json`, `package-lock.json` | Browser dependency declaration | Socket.IO client; two transitive patch fixes | Reproducible frontend dependencies |
| `backend/tests/test_api.py` | Two test connections and test DB | Presence, validation, reconnection assertions | Checks identity, cleanup, and durable/live separation |
| `tests/liveMultiplayer.mjs` | Running Vite and Flask | Two real WebSocket clients | Checks the complete network path |
| Root/backend READMEs, this guide | Setup and learning instructions | Updated workflow | Keeps the project understandable |

## Tests and current limits

Run the frontend tests/build and the backend tests described in README.md.
With both services running, also run:

```bash
node tests/liveMultiplayer.mjs
```

This opt-in test checks actual WebSocket joins through Vite, movement in both
directions, leaving, reconnection snapshots, and unchanged saved furniture. It
sends no furniture PUT requests. Normal `npm test` stays independent of servers.
Verification: 18 frontend tests, 15 backend tests, the production build, and this
real network test passed. Safari also rendered connected green/coral avatars.

Test an outage by stopping/restarting Flask: status should change, stale peers
should disappear, and connections should rejoin with their current local poses.

The server trusts browser movement after basic validation. It does not simulate
speed or furniture collisions, and players can pass through each other. There is
one backend process; multiple workers would need shared presence/message handling.
Furniture editing is not collaborative: refresh the other tab after saving and
coordinate edits because the last PUT wins. This localhost runner is not an
internet deployment.

The npm audit reported two existing transitive advisories. Patch updates changed
cross-spawn 7.0.3 to 7.0.6 and nested fflate 0.6.10 to 0.6.11; the subsequent audit
reported zero vulnerabilities. The blocked optional fsevents install script warning
remains; no script permission was changed. Vite's large 3D bundle warning remains.

## Practice yourself

1. Change the send interval from 50 to 100 milliseconds and compare remote motion.
   Explain why local walking speed should stay unchanged.
2. Change smoothing from 15 to 5. Explain the delay/smoothness tradeoff and why
   the interpolation formula uses delta.
3. Rewrite `player_left` handling and effect cleanup. Repeated refreshes should
   never leave ghost avatars or duplicate connections.
4. Add a third tab. Trace its events and explain why it needs a snapshot instead
   of waiting for existing players to move.

For an interview, explain HTTP versus a persistent event connection, temporary IDs
versus accounts, durable versus ephemeral state, throttling versus frame rate,
interpolation, and client validation versus authoritative game simulation.

References: [Flask-SocketIO events and rooms](https://flask-socketio.readthedocs.io/en/stable/getting_started.html),
[threading and compatibility](https://flask-socketio.readthedocs.io/en/stable/intro.html),
and [Socket.IO connection options](https://socket.io/docs/v4/client-options/).
