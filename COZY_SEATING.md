# A cozier living room and shared seats

The shared living room now has two sofas, four chairs, a reading lamp, a lounge
rug, cushions, throws, and warm fairy lights. The book table and projector remain
part of the room. There are eight seats: one per chair and two per sofa.

Walk near an available chair or sofa and press **F**, or click **Sit on chair/sofa**.
Press **F** or click **Stand up** to return to walking. WASD pauses while sitting.
Seated players can use voice and the nearby projector. Projector controls move to
a screen corner while seated so they cannot cover the local character's face.

## Files and responsibilities

| File | Receives | Changes and purpose |
|---|---|---|
| `src/seating.js` | Furniture records, player position, occupied seat IDs | Calculates seat positions and finds the nearest available seat |
| `src/SeatControls.jsx` | Furniture, peers, player ref, posture, connection status, action callbacks | Samples proximity, shows F/button controls, and requests standing when a seat moves/disappears |
| `src/useRoomConnection.js` | Room ID and spawn position | Sends sit/stand requests, receives authoritative posture, stores pending/error state, and resets to a walking pose on disconnect |
| `src/Player.jsx` | Posture, movement input, furniture obstacles | Applies server seat/standing positions and disables movement while seated |
| `src/PlayerAvatar.jsx` | Seated flag, cushion height, shirt color | Bends legs and aligns the torso with the cushion; exports the hip-height constant |
| `src/RemotePlayer.jsx` | Another connection's pose | Smooths position/rotation and renders its seated posture |
| `src/PlayerNameTag.jsx` | Name, microphone flags, height offset | Keeps the label above either standing or seated heads |
| `src/App.jsx` | Room data and live connection state | Connects controls and renderers; avoids treating a seated player as stuck inside furniture during layout polling |
| `src/RoomUI.jsx` | Editing and seating state | Requires standing before editing and updates the living-room description |
| `src/styles.css` | Seat-control HTML | Places an accessible action button above the normal bottom controls |
| `src/Furniture.jsx` | Furniture type and optional cozy flag | Adds living-room cushions and throws while retaining existing footprints |
| `src/MainHall.jsx` | Hall geometry | Adds the reading-corner rug and decorative emissive lights |
| `src/Projector.jsx` | Screen state, proximity, seated flag | Keeps projector actions visible without covering seated faces |
| `backend/seating.py` | Connected player, item ID, sofa/chair slot | Validates proximity, reserves seats, broadcasts posture, and finds safe standing positions |
| `backend/realtime.py` | Movement packets | Rejects walking while seated; existing disconnect cleanup frees reservations |
| `backend/app.py` | Existing application startup | Registers seating events on the existing Socket.IO server |
| `backend/seed.py` | Initial room configuration | Adds the four new furniture records and relocates one plant |
| `backend/cozy_living_room.py` | Existing living-room records | Validates the combined layout, backs it up, and applies only the requested additions |
| `tests/seating.test.js` | Seat helpers | Checks rotated seat offsets, seat counts, and occupancy/proximity selection |
| `backend/tests/test_api.py` | Dedicated test database and socket clients | Checks exclusivity, late-join snapshots, invalid requests, safe standing, disconnect release, and media while seated |

## Follow one sit request

1. A chair has a local cushion offset; a sofa has two. `getSeats` rotates those
   offsets around Y and adds the furniture's position. The seated character faces
   the same direction as the furniture.
2. `SeatControls` checks proximity each frame. React updates only when the nearest
   available seat changes. Occupied seat IDs come from the other players' poses.
3. Pressing F sends `{ itemId, slot }` through `useRoomConnection`. The client does
   not decide the final seated position or cushion height.
4. Flask loads the item from the connection's current room. It checks the item type,
   slot, distance, and occupancy. Availability and assignment happen under the
   same lock, so simultaneous requests cannot both claim the same seat.
5. Flask broadcasts `player_posture_changed`. The local player applies the supplied
   position and rotation. Remote players receive the same seated flag and render
   bent legs while smoothing movement toward the seat.

## Ground position versus visual height

Player position Y remains zero, preserving the movement, voice-distance, and
networking conventions. The avatar's torso starts 0.38 units above its origin:
`0.67 - 0.58 / 2`. Moving the avatar geometry by `seatHeight - AVATAR_HIP_HEIGHT`
aligns its bottom with the cushion. The name label receives the same offset.
Chair cushions are 0.69 units high; sofa cushions are 0.72.

## Standing and cleanup

The server remembers where the player was standing before sitting. On Stand, it
checks that spot against room boundaries and furniture. If the layout changed,
it searches nearby clear floor instead. The fixed book table also participates
in this check.

A seated connection cannot submit ordinary walking packets. Movement resumes
only after an accepted Stand response. If an owner changes the room layout,
seated visitors request standing so they cannot remain floating above an old chair
position. On disconnect, removing the player entry releases its seat. Reconnection
starts from the client's last walking pose, rather than inside furniture.

Reservations are temporary connection state, not PostgreSQL rows. Furniture is
still persistent room data. No database schema, physics engine, or new dependency
was added for seating.

## Applying the room update

`backend.cozy_living_room` updates only the new lounge furniture, reading lamp,
and the relocated plant in room 1. It validates all existing room furniture plus
the fixed book table before writing, and creates a JSON backup under
`backend/backups/`. Personal rooms are outside this update. The command is
idempotent: rerunning it updates the same records rather than duplicating them.

## Practice exercises

- Rewrite the Y-rotation calculation in `getSeats` and explain its X/Z result.
- Add a third sofa slot on both client and server, then test two simultaneous claims.
- Change the avatar torso height and recalculate its hip offset and label position.
- Make standing prefer the front of the chair while preserving collision checks.

Interview explanation: "The renderer supplies interaction hints, but the server
owns seat reservations and checks proximity. Seat offsets rotate with furniture.
Sitting changes visual posture while ground coordinates stay compatible with the
existing movement and media code. Standing requires a clear floor position, and
disconnecting releases temporary occupancy."

Validation: production build, 32 frontend tests, and 47 backend tests passed.
One browser plus a second real socket connection checked F/button interactions,
occupied-seat rejection, seated movement suppression, simulated voice/screen
sharing while seated, sofa posture, and disconnect/reconnect cleanup. Browser
checks produced no runtime errors. The shared-room update created a backup;
the public URL serves the updated build. Temporary test processes were closed.
Vite's existing large-bundle warning remains.
