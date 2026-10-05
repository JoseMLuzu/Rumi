# Custom room finishes

Open **Edit Room → Room style**. Choose **Floor**, **Walls** or **Background**.
Pick a preset or color, or choose/drop one image. Changes preview immediately in
3D. **Apply style** saves them; **Discard preview** returns to the latest saved
style. **Reset to original style** previews the original design and still needs
Apply to become permanent. Furniture continues to use **Save Room** independently.
Apply or discard an unfinished style preview before leaving the editor or traveling.

Floor options: warm wood, pale wood, walnut, stone tiles and terracotta. Wall
options: the original cream/sage combination, cream, sage, rose and dusty blue.
Background options: **City skyline** (the new default), cream, sky, lilac and evening. Custom images support fill with
crop, show entire image, and floor/wall repetition (1–8). The background is a
screen-sized image behind the 3D scene, not a panoramic environment or light source.
The city is a static golden-hour illustration with layered buildings and visible
rooftops, suggesting a high-rise apartment. It also appears in bedroom and
living-room windows. Saved color presets and uploaded backgrounds remain intact;
to change an already customized bedroom, choose **Background → City skyline →
Apply style**. Living rooms use the city backdrop by default. No room/furniture
records were rewritten for this visual change.

The SVG asset is about 8 KB. The existing image hook loads it, `RoomBackdrop`
composes a viewport-sized texture (capped at 2048 pixels), and window materials
reuse the same illustration. Both living-room panes share one texture. Unlit
window materials keep the distant view readable without adding shadow lights.
This creates the impression of a city without simulating buildings or reflections.
Textures are disposed through the existing cleanup when leaving the room.

One wallpaper configuration covers the interior wall faces; individual walls do
not have separate settings. Window frames, trim, rug, room geometry and collision rules
remain the existing design. The shared living room keeps its existing read-only rules.

## What happens when you apply

```text
File → existing prepareImage → oriented/resized WebP preview
Apply → existing multipart upload → files on disk + media_assets metadata
      → PATCH /api/rooms/id/appearance { appearance, revision }
      → owner + file-reference validation → lock room row → PostgreSQL commit
      → room_appearance Socket.IO event → each visitor updates the 3D finishes
Reload/reconnect → saved appearance + revision → rebuild the same textures
```

The room stores `appearance` and `appearance_revision`. Each of its three surface
records contains `preset`, `color`, `image`, `fit`, `crop` and `repeat`.
`image` is null or an `/api/media/<id>` reference; blob URLs are temporary previews,
and base64 data is never saved. Existing rooms default to their original appearance.
A furniture PUT cannot overwrite appearance. A stale style revision gets HTTP 409;
the editor preserves the preview and offers **Reload saved style** to review it.
Visitors cannot configure/upload room finishes. The server checks the authenticated
session and space membership; bedroom owners configure their own rooms. See
[Accounts](ACCOUNTS.md) and [Spaces](SPACES.md) for the current permission model.

Uploads reuse the poster pipeline: up to 10 MB / 25 million decoded pixels,
orientation correction, at most 2048 pixels per side, WebP compression and alpha.
Formats require a supported decoder. Unsupported/corrupt files show the existing
upload errors. Room storage quotas still apply. Files live in `backend/uploads/`
(or `SOCIAL_ROOMS_UPLOAD_DIR`); back up that directory with PostgreSQL. Replaced
files are retained under the existing storage policy; this change adds no garbage
collector or external cloud service.

## Files and responsibilities

| File | Receives and changes | Why it exists |
|---|---|---|
| `src/data/roomAppearance.json` | Preset labels/colors/patterns shared by Flask and React | Keeps accepted preset names in one place |
| `src/assets/city-skyline.svg` | Static vector illustration | A lightweight, reusable high-rise view |
| `src/roomAppearance.js` | Creates default records and validates saved responses | Separates room data from graphics |
| `src/RoomAppearancePanel.jsx` | Saved settings/revision; owns draft, uploads and apply/discard controls | Preview is local until the owner explicitly saves |
| `src/RoomAppearance.jsx` | Surface settings and decoded images; creates UV mappings, tile texture and backdrop | Keeps texture/resource work out of the editor UI |
| `src/Room.jsx` | Appearance; renders floor finish and inner wallpaper | Reuses the original geometry and floor click handlers |
| `src/MainHall.jsx` | City texture shared by both living-room windows | Carries the same apartment view into the common room |
| `src/App.jsx` | HTTP/socket snapshots and local preview; connects editor to scene | Keeps saved appearance separate from an unfinished preview |
| `src/RoomUI.jsx`, `src/styles.css` | Editor tabs and unsaved-style state | Makes the small style editor usable on desktop and mobile |
| `src/api.js` | Settings/revision; sends PATCH and validates the result | Centralizes request handling and clear errors |
| `backend/models.py` | SQL room appearance/revision ↔ plain JSON | Makes style survive restarts and browser refreshes |
| `backend/appearance.py` | Untrusted configuration and media references; returns validated records | The server checks permissions and room-owned files |
| `backend/app.py` | Owner PATCH; locks, validates, saves, then broadcasts | A successful preview is not a successful database write |
| `backend/realtime.py` | New/reconnecting visitor; emits saved style snapshot | Returning connections see changes made while absent |
| `backend/migrate_appearance.py` | Existing rooms → metadata backup → two added columns | Adds the feature without resetting rooms or furniture |
| `tests/appearance.test.js`, `backend/tests/test_objects.py` | Request, permission, image, concurrency and persistence cases | Tests meaningful cross-browser behavior against the test DB |

## Concepts to understand

- The panel owns a **draft**, while PostgreSQL owns the saved style. Visitors receive
  committed changes, never somebody else's unfinished preview.
- A texture's UV repeat/crop controls how the picture fits; the room mesh remains
  the same size. Wallpaper clones share the decoded source but keep separate UV
  transforms. Removing a finish disposes its GPU texture resources.
- Row locking serializes simultaneous saves. Revisions tell us whether the owner
  edited an old version, so the server can reject an overwrite instead of guessing.
- Images are files, while the database stores references and settings. A reference
  must belong to the current room and point to an image before it can be saved.

Practice: add one floor preset; change the tile grout width; explain the cover vs
contain calculation; or add a test where two owner sessions save the same revision.

For the city view, try changing building heights or the sky palette in
`src/assets/city-skyline.svg`. Explain why a scene background texture does not
produce parallax or require city geometry, and why the window shader must be
recompiled when a texture replaces its initial plain color. The city update passed
48 frontend tests, three PostgreSQL room-style regression checks, the production
build, and desktop/mobile browser checks for rendering, preset selection, saving
and restoration. The existing large JavaScript bundle warning remains.

## Setup and checks

For an existing database, before starting the updated backend:

```bash
DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms' \
  backend/.venv/bin/python -m backend.migrate_appearance
```

The migration backs up room metadata under `backend/backups/` and does not change
furniture. Fresh databases include the columns through the normal seed/create_all.
No new application dependencies are needed.

Run `npm test`, `npm run build`, and the backend tests with a dedicated
`TEST_DATABASE_URL` ending in `_test`. Current verification: 38 frontend and 61
backend tests pass. Browser checks cover all three actual image uploads, fit/crop/
repeat, refresh restoration, a visitor update, revision conflict UI, mobile panel
bounds and GPU cleanup (10 textures before, 13 with images, 10 after reset).
The existing Vite large-bundle warning remains visible.

For a hands-on check, open two browsers with different names, visit the owner's
bedroom and apply a new wallpaper. The visitor should see the change immediately.
Try entering the same owner name in another session and saving a conflicting draft:
the old draft must be reviewed instead of silently overwriting the new style.
