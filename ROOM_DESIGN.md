# Enclosed bedrooms and a tabletop projector

The hallway shows bedroom exteriors with full walls, closed doors, and opaque
ceilings. It no longer renders placeholder beds or rugs. Entering a door still
loads that room's saved furniture and switches to the existing interior view.
No saved room layouts were changed for this visual update.

The projector sits on the existing living-room table. Its feet touch the tabletop,
and Share/View controls appear when the player is nearby. The five-second JPEG
preview and explicit 720p viewing keep their existing behavior.

## Files and responsibilities

| File | Receives | Changes | Why it exists |
|---|---|---|---|
| `src/MainHall.jsx` | Hall dimensions and named door records | Exterior meshes only | Full-height walls and ceilings hide bedrooms from the hallway |
| `src/Projector.jsx` | Saved table, screen state, connection state, player ref | Texture and nearby flag | Positions the projector on furniture and anchors its controls |
| `src/App.jsx` | Loaded room/furniture | Passes the table and central-room flag to components | Coordinates existing components without adding shared state |
| `src/CameraController.jsx` | Player ref, room type, edit flag, arrival position | Camera position and direction each frame | Looks along corridors so enclosed rooms cannot obstruct the hallway view |
| `src/TravelDoor.jsx` | Named doors and proximity | Door/sign meshes | Keeps door signs flat against the new walls and closes gaps around doors |
| `backend/screens.py` | Connected player pose and saved furniture | Authorizes Share/View | Uses the same table position as the frontend rather than an outdated fixed coordinate |
| `backend/tests/test_api.py` | Dedicated test database | Test fixtures only | Checks missing/moved tables and proximity permissions |
| `tests/browserScreen.mjs`, `tests/browserVoice.mjs` | Isolated browser and test server | Temporary simulated media/browser contexts | Exercise camera-relative keyboard movement, door travel, and media cleanup |
| `backend/SCREEN_SHARING.md` | Existing screen-sharing behavior | Documentation only | Describes the projector’s table placement and updated exterior responsibilities |

## Three concepts to understand

**Mesh positions describe their centers.** The table's surface is at
`0.84 + 0.16 / 2 = 0.92`. The projector's feet are `0.04` high and its body is
`0.32` high, so the body center is `0.92 + 0.04 + 0.32 / 2 = 1.12`.
Changing only the center's Y value without accounting for height makes an object
float or sink.

**An exterior and a loaded interior are separate views.** Bedroom shells use the
hall's dimensions and door positions. Their 2.8-unit walls and ceilings are opaque;
saved furniture is rendered only after the room request completes on entry. This
keeps the hallway simple and avoids drawing hidden furniture.

**The camera's sightline matters.** The previous isometric camera could sit beyond
a bedroom roof while looking at a player in the corridor. Hallway camera offsets
now point along the corridor toward the living room, with no sideways offset into
bedrooms. Existing interpolation smoothly moves between that view and the living
room view. WASD continues using the current camera direction.

The server reads the table from PostgreSQL on Share/View actions, not on every
animation frame or movement packet. Both frontend and backend choose the first
table in the room's ordered furniture records. If no table exists, the projector
device is not rendered and the server rejects sharing there.

Interview explanation: "Saved room data supplies furniture placement. Geometry
uses center positions and half-height offsets. Opaque exterior shells hide rooms
until entry, while the camera stays within the corridor's sightline. Client
proximity shows controls; server proximity authorizes the action independently."

## Exercises

- Change the projector body height and recalculate where its center must be.
- Add a small decorative trim around bedroom ceilings without changing walk areas.
- Adjust the corridor camera height and explain when walls begin blocking the view.
- Trace what happens from pressing E to the room's saved furniture appearing.

The opt-in browser fixtures observe camera matrices as they are uploaded to WebGL,
without querying the GPU synchronously. They use the perspective camera rather
than the shadow camera to steer keyboard input. That instrumentation exists only
inside tests; the app does not publish test-only camera globals.
