# Imported models: book display and pool doll

The living room has a fixed reading table with the supplied book displayed on a
wooden stand. Its original cover faces the normal diagonal camera so the title is
readable. Bedrooms have a new **Pool doll** inventory item that uses the supplied
model and the existing placement, move, rotation, deletion, and save controls.

## Files and responsibilities

| File | Responsibility | Data received or changed |
|---|---|---|
| `src/assets/models/kamasutra-lowpoly.glb` | Original book geometry and embedded cover | Copied from the supplied Downloads file |
| `src/assets/models/pool-doll.glb` | Original pool doll geometry and materials | Copied from the supplied Downloads file |
| `src/BookTable.jsx` | Table, display stand, book loading and orientation | Exports a fixed table record; creates a transformed book instance |
| `src/MainHall.jsx` | Living-room composition | Includes the book table in the shared hall |
| `src/App.jsx` | Connects scene and movement | Adds the fixed table to walking obstacles in the hall |
| `src/PoolDoll.jsx` | Loads a floor-centered model instance | Clones the cached scene and adjusts its origin |
| `src/Furniture.jsx` | Draws furniture from its type | Renders `PoolDoll` inside the existing position/rotation/selection wrapper |
| `src/data/furniture.js` | Inventory catalogue and floor footprints | Adds `poolDoll`, with a 1.1 × 0.45 footprint |
| `src/RoomUI.jsx` | Inventory buttons and editing controls | Adds the pool doll icon; existing catalogue iteration supplies its button |
| `backend/validation.py` | Validates records before saving | Accepts `poolDoll` with the same 1.1 × 0.45 footprint |

## How the model becomes furniture

1. Choosing **Pool doll** creates an ordinary placement record:
   `{ id, type: 'poolDoll', position, rotation }`.
2. `Furniture` applies that position and rotation to its outer group.
3. `PoolDoll` loads the GLB through Drei's `useGLTF`. The loader caches the asset.
4. Each instance clones the scene's object hierarchy. Its geometry and materials
   remain shared, while each placed doll has independent transforms. `dispose={null}`
   prevents removing an instance from disposing those shared resources.
5. `Box3` measures the model. Subtracting its minimum Y makes its feet touch the
   floor; subtracting the X/Z center aligns it with the editor's collision rectangle.
6. The existing editor sends plain records to Flask. Flask validates the type and
   footprint, then saves the records in PostgreSQL. Reloading reconstructs the same
   model from the saved type, position, and rotation.

The doll keeps its original height of about 1.76 units. The footprint includes a
small margin around its roughly 1.02 × 0.37 geometry. Quarter turns swap the width
and depth through the existing collision and placement code. No database schema
change is needed because furniture types are already stored as strings.

## Why the book needs a different placement

The book originally lies flat and is only 0.12 × 0.17 units. Scaling by 7.5 makes
its cover readable in the room. It tilts 45 degrees and turns 45 degrees around Y
to face the camera. Measuring its bounding box **after** those transforms gives
the correct height offset, so its lower edge rests on the stand rather than floats.

The table is a fixed hall fixture, like the hall's floor and walls. Its record joins
saved furniture only for walking collisions; it does not enter the bedroom editor
or the room-save payload. Both draw the same existing table model and footprint.

## Why import GLB files with `?url`

Vite copies imported models into the production `/assets` directory with hashed
filenames. Flask already serves that directory. This lets local development and
the public application load the same models without adding a server route. The
small `Suspense` boundaries wait for just the relevant model, while the rest of
the room remains visible.

## Practice exercises

- Change the book's tilt and explain why measuring its bounds must happen afterward.
- Reduce the doll's scale and update both frontend and backend footprints to match.
- Place two dolls and rotate one; explain why cloning prevents the other from moving.
- Trace a doll from the inventory button to its database record and back after refresh.

Interview explanation: "The database stores furniture data, not Three.js objects.
The renderer chooses a cached model from the type, creates an independent instance,
and applies the saved transform. Asset bounds align the mesh with the same footprint
used by client collision checks and server validation."

Validation: the production build, 29 frontend tests, and 41 backend tests passed.
One isolated browser verified the book cover and the doll's placement, movement,
rotation, saving, reload, selection, and deletion without runtime errors. Both GLB
assets also returned HTTP 200 through the existing public URL. Vite's existing
large-bundle warning remains.
