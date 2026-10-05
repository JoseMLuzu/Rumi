# Spaces, memberships, and invitations

A space is a separate house: one living room and one bedroom per member. The
original house is **gci** (space 1). Its existing rooms, furniture, images,
accounts, reserved bedrooms, and host permissions are preserved. New accounts
start with no spaces: they create a space or accept an invitation. Signup does
not automatically grant access to gci.

No dependencies were added. This reuses React state, Flask, SQLAlchemy,
PostgreSQL, the existing session/CSRF system, and room-based Socket.IO channels.

## Try it

1. Log in with an existing account. Your existing gci bedroom still opens.
   Reserved accounts still need their private local-admin activation link;
   a space invitation never activates someone else's account.
2. Click **Spaces**, enter a name, and click **Create space**. You become its
   host, enter its living room, and receive a separate bedroom there.
3. In **Spaces**, click **Create invitation link**, then **Copy link**. Open
   the application at the public HTTPS address before generating a link for
   a friend on another network. A localhost invitation works only on your Mac.
4. The friend opens the link, logs in or creates an account, and explicitly
   clicks **Accept invitation**. They receive their own bedroom in that space.
5. Meet in that space's living room. Visit each other's open bedrooms. Members
   can interact with objects; only a bedroom owner edits it. Hosts edit the
   living room and manage invitations.
6. Create another space and switch using **Spaces**. Each has separate rooms,
   furniture, players, voice peers, seats, and projector sharing. Save or cancel
   decoration before switching. Switching unmounts the room and stops its media.
7. Refresh: the session returns, followed by your bedroom in your last selected
   space. Only this preference is saved in localStorage; membership and layouts
   are stored in PostgreSQL.

Invitation links can be reused by friends for seven days. Generating a new link
invalidates the old one; **Revoke link** stops future joins. Neither action removes
members who already joined. Repeated acceptance retains the same bedroom.
Treat a link as permission to join; anyone who receives it can accept it with an
account. There is currently one active link per space, a playtest limit of ten
owned spaces per account, and no member-removal, role-management, or space-deletion
interface. No external invitation/email service needs configuration. The existing
optional TURN setup for voice/screens is unchanged.

## Small database model

| Table | Responsibility |
| --- | --- |
| `visitors` | Existing accounts, password hashes and activation information; now also a display name |
| `auth_sessions` | Existing revocable browser sessions, unchanged |
| `spaces` | Name, creator, invitation hash and expiry |
| `space_memberships` | Account + space, bedroom ID and host flag |
| `rooms` | Existing room data, with `space_id` and `is_central` added |
| `placed_furniture`, `media_assets` | Existing saved objects and uploaded-file references |

The membership's composite primary key `(space_id, user_id)` prevents duplicate
memberships. Its unique bedroom ID prevents two members sharing an owned bedroom.
A PostgreSQL partial unique index allows one central room per space. The old
`visitors.room_id` remains as a legacy gci pointer; new code uses memberships.
Room IDs remain globally unique, so existing `room:<id>` Socket.IO channels still
work. The living room is identified by `is_central`, rather than assuming ID 1.

## Request and state flow

```text
App → GET /api/auth/session → account + CSRF token
    → GET /api/spaces → only that account's memberships
    → select remembered space or first membership
    → GET /api/rooms/<personalRoomId> → existing Canvas/editor

Create space → POST /api/spaces { name }
    → lock account → transaction: space + living room + bedroom + membership
    → return space data → React switches rooms → connect to that room's channel

Create invitation → POST /api/spaces/<id>/invitation
    → check host → store token hash + expiry → return raw token once
    → React builds https://current-host/#invite=<token>

Friend opens link → sign in if necessary → preview → explicit acceptance
    → POST /api/spaces/join { token }
    → lock space → check hash and expiry → find/create membership + bedroom
    → commit → notify only this living room that its hallway changed
    → React enters the living room → Socket.IO connects
```

The URL fragment keeps the invitation out of HTTP paths and access logs. React
keeps it through login/signup and removes it after accepting or dismissing it.
PostgreSQL stores a SHA-256 hash, not the usable token. Space changes require the
existing authenticated cookie, CSRF token, and origin checks. Invitation previews
use POST so the token is in a request body, never a query string.

Locking the space row serializes simultaneous accepts and revocation. Membership
creation and starter furniture commit together; a repeated accept cannot leave an
orphan bedroom. The server checks membership before room/media access and before
opening a multiplayer connection. An open bedroom is open to members of its
space, rather than to every account in the application.

React owns the selected space and room. `App` merges the active membership's
bedroom/central-room IDs and host role into the existing game props. The account's
global display name is independent of which house it visits. Selecting a new space
unmounts the previous editor: existing socket, microphone, screen, audio, and input
cleanup runs. Motion and proximity actions pause while the Spaces dialog is open.
Portals can cross spaces only when the account already belongs to the destination;
loading that room updates the active space context as well.

Hallways are calculated from that space's rooms. Server walking limits and projector
state are keyed by living-room ID. Voice and screen signaling require sender and
receiver to be in the same room. No second realtime server or new networking
library is necessary.

## Files and responsibilities

| File | Reads/receives | Changes/produces and why |
| --- | --- | --- |
| `backend/models.py` | SQLAlchemy fields | Space/membership rows and room identifiers; keeps relationships explicit |
| `backend/migrate_spaces.py` | Existing database | Metadata backup and additive schema/membership migration; preserves the house |
| `backend/spaces.py` | Authenticated requests, names and tokens | Space/member/room transactions, invites, scoped hallway notifications |
| `backend/auth.py` | Account/session | Signup without automatic membership; compatibility profile for accounts with or without spaces |
| `backend/visitors.py` | Session, room ID | Membership-aware read/write decisions; permissions stay on the server |
| `backend/app.py` | Room requests | Scoped room directory and central-room handling for any space |
| `backend/hall.py` | Rooms belonging to one space | Doors and walk areas for that living room |
| `backend/realtime.py` | Authenticated room connection and movement | Player space identity and per-room walking limits |
| `backend/seating.py` | Seat/stand actions | Uses the correct living-room bounds; existing exclusive occupancy is reused |
| `backend/screens.py` | Screen actions and room ID | Independent presenter, viewers and preview per living room; room-specific cleanup |
| `backend/seed.py` | New or existing database | Creates missing gci schema/central room without replacing saved furniture |
| `backend/accounts.py` | Local admin activation command | Preserves activation flow and assigns `--host` to the gci membership |
| `backend/reset_house.py` | Explicit destructive admin command | Understands new FK deletion order; it is **not** the migration and was not run on your database |
| `src/App.jsx` | Account, memberships, room responses | Active-space state, loading, switching and cleanup; connects the existing game to membership |
| `src/SpacesDialog.jsx` | Membership list, active space, invitation | Forms, preview/accept, link controls and account lobby; calls API helpers |
| `src/spaces.js` | URL and account name | Fragment parsing/link creation and last-space preference; no authorization data |
| `src/api.js` | Plain HTTP data | Space endpoints and response validation; existing CSRF helper reused |
| `src/RoomUI.jsx` | Active-space name and callbacks | Spaces button and current house label |
| `src/RoomDirectory.jsx` | Active-space IDs | Loads only this house's bedrooms |
| `src/AuthScreen.jsx` | Account form props | Explains account creation followed by joining/creating a space |
| `src/styles.css` | Responsive UI classes | Spaces dialog/lobby styling consistent with the existing design |
| `backend/tests/test_spaces.py` | Dedicated PostgreSQL database | Preservation, permission, invite races, expiry/revocation and realtime isolation checks |
| `backend/tests/test_api.py`, `test_auth.py`, `test_living_room.py` | Existing fixtures | Membership-aware fixtures and regression assertions |
| `tests/spaces.test.js` | API helpers, URL/storage helpers | Checks validation, invitation links, no-membership accounts and per-account preferences |
| `tests/liveMultiplayer.mjs`, `browserObjects.mjs` | Running isolated test server | Existing live checks now select/join a space explicitly |
| `README.md`, `ACCOUNTS.md`, `backend/README.md`, `backend/PUBLIC_PLAYTEST.md` | Setup/current flow | Updated entry, migration and testing instructions |

## Migration and verification

For an existing database that already has the account schema, stop the backends:

```bash
export DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms'
backend/.venv/bin/python -m backend.migrate_spaces
```

The script runs schema/data changes in one transaction and writes
`backend/backups/before-spaces-<timestamp>.json` first. The JSON covers room,
furniture, media metadata and account-bedroom/host mappings, not password/session
credentials. Back up PostgreSQL and `backend/uploads/` for a full restore strategy.
The migration can be rerun; it never deletes rooms or recreates accounts. Restart
Flask/Gunicorn and rebuild `dist` for the public app. Keep `AUTO_JOIN_GCI` unset
(default false); its legacy testing option is not the chosen signup policy.
Fresh databases use `backend.seed` as before.

```bash
npm test
npm run build
TEST_DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms_test' \
  backend/.venv/bin/python -m unittest discover -s backend/tests -q
```

The browser checks use separate profiles and a dedicated test database. They cover
new-account lobby, create/invite/accept, two players meeting, host versus visitor
editing, switching, remembered preference, revoked links, mobile layout and retained
gci access. Database tests also cover simultaneous accepts, private media, different
hallway sizes, and two simultaneous projector sessions in different spaces.
Existing Vite bundle-size warnings remain visible; this milestone does not solve
the large Three.js bundle. No new external service needs setup.

The October 4, 2026 migration was applied to the existing local database. Before
and after comparisons retained all 8 accounts, 9 rooms, 64 furniture records and
11 media records, including original fields, credentials, activation data and
sessions. All eight accounts received gci membership with their original bedroom
and host flag. The local and public backends were restarted and their health,
session handling, protected space endpoints, and current public build verified.
Backups are `backend/backups/before-spaces-20261004-full.dump` (complete PostgreSQL)
and `backend/backups/before-spaces-20261004T235719866809Z.json` (migration metadata).
The temporary browser and test server were stopped after verification.

## Practice next

1. Trace invitation acceptance from the URL through the transaction to a rendered bedroom.
2. Write a test proving a closed bedroom blocks a different member but allows its owner.
3. Change the invitation lifetime and explain why the backend, rather than the UI, enforces expiry.
4. Add a member list endpoint limited to members of that space; avoid a global account directory.
5. Explain why the membership key and row lock solve different concurrency problems.

For an interview, explain authentication versus membership/authorization, a join
table, transactions, unique constraints, row locks, token hashing, and why room-based
broadcasts and media access must both be scoped. Refs, Canvas, player movement and
furniture serialization remain the same concepts from earlier milestones.
