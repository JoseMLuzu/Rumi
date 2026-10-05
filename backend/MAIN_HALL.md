# A visible main hall with room corridors

This guide records the earlier apartment-style corridor milestone. The current
house design and saved-name identity are explained in [Named House](NAMED_HOUSE.md).

Room 1 is now a shared lobby with east and west corridor wings. Every saved
personal room has a visible exterior and a numbered door along those corridors.
Leaving a personal room loads this shared scene and places you beside that room's
door. You can then walk to the lobby or another entrance.

## Try the trip

1. Refresh the application. Walk to your room's front door and press E.
2. You arrive in the hall outside **My Room #<number>**, with neighboring rooms visible.
3. Walk along the corridor using WASD. Its green floor strip leads toward the lobby.
4. **Find Rooms** opens a directory. Choosing a room highlights its gold doorway
   and shows its wing/bay. It keeps you in the hall so you can walk there.
5. Near the destination door, press E. Its saved furniture loads and you arrive
   near the interior entrance. Owner-only editing still applies.
6. Leave the visited room to return to its hall doorway. **Find My Door** highlights
   your own entrance so you can walk home.

The **Leave for Main Hall** button is an alternative to pressing E at an interior
door. Both choose the same arrival position. Rooms and the hall have a loading
boundary at their doors. Visible exteriors are simple room shells; saved interiors
are loaded on entry rather than rendering every visitor's furniture at once.

## One floor plan shared by client and server

`backend/hall.py` builds the plan from rooms ordered by database ID, excluding room 1.
Four rooms fit in each corridor bay:

| Slot within a bay | Wing | Side of corridor | First-bay door X/Z |
|---|---|---|---|
| 0 | West | North | -10.5, -1.9 |
| 1 | East | North | 10.5, -1.9 |
| 2 | West | South | -10.5, 1.9 |
| 3 | East | South | 10.5, 1.9 |

The next bay is 10.5 units farther out. Sparse room IDs do not leave huge gaps:
the sorted directory index determines the slot, while the database ID determines
which saved interior to open. New rooms append slots and preserve existing door
positions. There is no room deletion UI; manually deleting old room records would
change later slots, so permanent world coordinates would need a future schema field.

The hall response adds plain data to the existing GET:

```text
GET /api/rooms/1
  id, name, readOnly, items (saved lobby furniture)
  hall:
    halfLength
    walkAreas: [lobby rectangle, corridor rectangle]
    doors: [{roomId, name, position, rotation, arrival}]
```

React renders that plan instead of independently calculating doorway positions.
The lobby rectangle overlaps the corridor rectangle, creating continuous floor
through their connection. Collision checks shrink each rectangle by player radius;
the player must fit on a floor area and avoid furniture footprints.

Personal rooms retain their 10×10 movement bounds. Hall positions may extend far
beyond those bounds. The live server chooses the correct areas from the player's
server-owned room ID, so including `roomId: 1` in a personal-room move cannot bypass
its boundaries. It caches the hall areas under the existing player lock to avoid
querying PostgreSQL on every movement packet. New rooms expand those bounds.

No tables, migrations, dependencies, or physics engine were added. Saved personal
layouts and the lobby furniture were preserved.

## Arrival and scene flow

```text
Personal-room door -> record source room ID -> GET room 1 with its hall plan
  -> find source room's hall door -> spawn at its corridor arrival position
  -> connect to the shared room:1 channel

Walk down corridor -> approach a numbered door -> E with that target room ID
  -> GET the saved personal room -> choose a clear position near its entrance
  -> connect to that personal room's channel

Leave again -> record the visited room ID -> spawn at its matching hall door
```

`findHallArrival` copies the selected door's arrival array. A copy matters because
moving the player should never mutate the server's floor-plan record. If no source
door exists, arrival falls back to the lobby. `findRoomEntry` searches near the
interior doorway and then inward, avoiding furniture the owner may have placed
there. The camera starts near this arrival, so far corridor entrances are visible
immediately rather than waiting for a camera to travel from the origin.

Movement still uses normalized directions, delta time, small collision substeps,
and axis-by-axis sliding. `TravelDoor` runs one proximity check over all doors,
updating React only when the active doorway changes. One E listener handles the
active doorway and is removed on unmount. The underlying frame callback is provided
by [React Three Fiber's useFrame](https://r3f.docs.pmnd.rs/api/hooks#useframe).

## New rooms while players are in the hall

After a new visitor's room commits, Flask updates the hall bounds and sends
`hall_changed` to room 1. Connected hall clients GET the updated plan and render
the new entrance without leaving their scene. Reconnection also reloads it.
The hall performs a fallback GET every 15 seconds, covering rooms created through
another local server process sharing the database. Live players still need the
same server/origin to meet because their positions remain process-local.

Selecting a directory entry sets a local target ID. It does not fetch that room's
interior or change the current socket channel. The corresponding arch and floor
marker turn gold; entering its door performs the actual travel request.

## File responsibilities

| File | Receives | Changes or produces | Why it exists |
|---|---|---|---|
| `backend/hall.py` | Ordered room records | Door positions, arrivals and floor areas | Gives every client one shared world plan |
| `backend/app.py` | HTTP requests and visitor cookies | Hall metadata, hall notifications after room creation | Connects the existing API to the visible world |
| `backend/realtime.py` | Connection room ID and pose | Validated hall/room movement and cached hall bounds | Lets multiplayer work beyond the old square |
| `src/hallLayout.js` | Hall data, source ID or furniture | Validated plan and safe arrival positions | Keeps spatial arrival rules understandable and testable |
| `src/MainHall.jsx` | Hall metadata | Lobby, corridors, visible room shells and signage | Replaces the former garden-only environment |
| `src/Room.jsx` | Central flag and hall data | Appropriate room/hall scene | Keeps the personal room construction separate |
| `src/App.jsx` | Room data and travel actions | Source room, destination marker, hall state and refreshes | Coordinates loading and per-scene state |
| `src/TravelDoor.jsx` | Door records, player ref and callbacks | Active door, E interaction and highlighted arches | Reuses the doorway model for many destinations |
| `src/Player.jsx`, `src/roomLayout.js` | Furniture and optional floor areas | Frame-independent movement constrained to the current floor | Shares personal-room movement with corridor walking |
| `src/CameraController.jsx` | Arrival position, player ref and hall flag | A follow camera starting near the arrival | Makes distant corridor spawns usable |
| `src/RoomUI.jsx`, `src/RoomDirectory.jsx` | Location, ownership and destination | Finding controls, doorway hints and room markers | Supports navigation through a visible neighborhood |
| `src/api.js`, `src/useRoomConnection.js` | HTTP data and hall events | Validated metadata and refresh revisions | Connects networking to scene updates |
| `src/styles.css` | Destination UI classes | The wing/bay hint | Makes the current walking destination readable |
| `tests/hallLayout.test.js`, `backend/tests/test_hall.py` | Sample layouts | Geometry and arrival regression checks | Exercises continuous walking, sparse IDs and blocked entries |
| Existing API/live tests | Dedicated test DB or running server | Expanded-floor and visiting checks | Verifies permissions and actual corridor movement |

`CentralGarden.jsx` was replaced by `MainHall.jsx`; the old garden-only component
would duplicate the central scene responsibility.

## Verification and practice

Passed: 26 frontend tests, 27 backend tests against the dedicated PostgreSQL test
database, and the production build. A browser drove actual WASD input from a room
door into the hall, along a corridor, into a neighbor's saved room, and back to its
hall doorway. Walking from that corridor into the furnished lobby also passed
without changing scenes. The directory was verified to highlight a destination without
entering it, and guest editing remained disabled. No browser runtime exceptions
or console errors occurred. The existing Vite large-bundle warning remains visible.
Actual HTTP/WebSocket checks passed locally and through the existing public HTTPS
URL, including hall positions outside the original square and personal rooms
rejecting those same coordinates.

Useful exercises:

1. Recalculate the four doorway slots by hand for six rooms, then check the response.
2. Change corridor width and explain which server floor bounds and rendered geometry
   must change together. Keep tests for the player's radius at both edges.
3. Rewrite the room-entry spawn search and test an owner placing a sofa near the door.
4. Add a distance display to the selected door, updating it a few times per second
   rather than rerendering React on every movement frame.
5. Explain the difference between selecting a destination marker and changing the
   current scene/live channel. Trace both paths through App.

For an interview, be able to explain shared coordinate data, local versus scene
coordinates, geometry versus persisted furniture, safe spawns, immutable arrays,
continuous floor regions, and why frontend/server movement limits must agree.
