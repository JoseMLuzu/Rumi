# Accounts: username, password, and your existing bedroom

Create account creates an identity. Then create a space or accept an invitation to
receive a bedroom there. Existing users keep their original bedrooms in **gci**.
Log in returns to your bedroom in the last selected space, including its furniture,
images and room style. See [Spaces](SPACES.md) for memberships and invitation links. Refresh restores the session. The account
menu in the top bar offers Log out. Save or discard decoration changes first.
Passwords need 12–128 characters. Names use the existing normalization rules:
capitalization, extra spaces and full-width variants do not create different accounts.

This milestone uses our existing Flask, SQLAlchemy and PostgreSQL setup. It adds no
authentication service or frontend state library. There is no email verification,
forgot-password email, password-reset interface or third-party login yet.

## Activate a bedroom that existed before accounts

Old name-only bedrooms remain reserved. Knowing their names is not proof of ownership.
A local administrator generates a private invitation after identifying the owner:

```bash
export DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms'
backend/.venv/bin/python -m backend.accounts 'jose' --host --base-url 'http://localhost:5173'
```

Use the current HTTPS public URL as `--base-url` when inviting someone remotely.
The command prints a one-use link valid for 24 hours. The owner opens it and chooses
a password. It activates the existing bedroom without replacing furniture or media.
Generating another invitation invalidates the previous one. `--host` explicitly
permits editing gci’s living room through its membership. Public signup never grants this role, even
when the chosen username is `jose` or the submitted JSON includes `isHost: true`.

The invitation is in the URL fragment, which is not sent in HTTP requests. React
removes it from browser history and keeps it only in memory while the form is open.
Treat the link as a credential and share it only with the intended owner.

## Setup and migration

For an existing database, stop the backends, then run:

```bash
backend/.venv/bin/python -m backend.migrate_auth
backend/.venv/bin/python -m backend.migrate_spaces
```

This saves a JSON backup of room/furniture/media metadata, adds nullable password
and invitation fields to the existing `visitors` table, adds a host flag, and creates
`auth_sessions`. It is safe to rerun. It does not migrate or delete uploaded files;
keep backing up `backend/uploads/` separately. Fresh databases get the same schema
through `backend.seed` and `Base.metadata.create_all`.

Restart the local backend normally. For the existing public tunnel, use:

```bash
TRUST_PROXY_HEADERS=true DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms' \
  backend/.venv/bin/gunicorn --no-control-socket --worker-class gthread \
  --workers 1 --threads 20 --bind 127.0.0.1:5002 backend.app:app
```

The proxy setting lets Flask recognize HTTPS and set Secure cookies. Enable it only
on the loopback server behind the trusted tunnel, never on an exposed direct server.
See [Flask's proxy documentation](https://flask.palletsprojects.com/en/stable/deploying/proxy_fix/).
The localhost and public hostname have separate cookies; log in on each using the
same credentials to reach the same PostgreSQL bedroom. Their live servers remain separate.

## 1. Project structure and responsibilities

| File | Responsibility | Receives | Changes |
| --- | --- | --- | --- |
| `backend/models.py` | Stores account/session data alongside existing rooms | Account fields and session records | PostgreSQL rows through SQLAlchemy |
| `backend/auth.py` | Signup, login, logout, session lookup, CSRF and live-session guard | HTTP cookies, credentials, CSRF; socket identity | Password hashes, sessions; disconnects revoked connections |
| `backend/visitors.py` | Keeps normalized usernames and room permissions in one place | Current request, SQLAlchemy session, room ID | No data; answers permission questions |
| `backend/app.py` | Registers auth and protects API requests before room handlers run | HTTP requests | Existing room writes only after permission checks |
| `backend/realtime.py` | Authenticates connections and binds an account session to each player | Cookie and socket `auth` with room, pose, CSRF | Existing player dictionary and room broadcasts |
| `backend/seating.py`, `screens.py`, `objects.py` | Require a live session before shared actions | Socket actions | Existing seats, sharing and object behavior |
| `backend/migrate_auth.py` | Preserves room data while upgrading the schema | Configured database | Account columns, session table, metadata backup |
| `backend/accounts.py` | Gives known owners private activation links | Reserved username; optional host flag | Invitation hash/expiry and explicit host role |
| `src/AuthScreen.jsx` | Account forms and private invitation activation | `onEnter`, optional notice | Local input/busy/error state; sends credentials through the API |
| `src/api.js` | Central HTTP helper and auth endpoints | Plain request data | In-memory CSRF token; returns account/room data |
| `src/App.jsx` | Chooses login screen or game and checks session lifecycle | Restored account and loaded room | Current account/room; unmounts the game on logout/expiry |
| `src/RoomUI.jsx` | Account menu and logout control | Account, dirty state, logout callback | Calls logout; prevents leaving unfinished decoration silently |
| `src/useRoomConnection.js` | Supplies CSRF when connecting; handles expired auth | Room ID and current API token | Existing live connection and peer state |
| `src/styles.css` | Makes account forms/menu fit the current visual design | Responsive viewport | Presentation only |
| `vite.config.js` | Keeps Host and Origin consistent through the development proxy | Browser HTTP/WebSocket requests | Forwards requests without rewriting Host |
| `backend/tests/auth_helpers.py`, `test_auth.py` | Test the browser flow and security boundaries | Dedicated test database | Test-only account/session fixtures |
| Existing backend and frontend API tests | Exercise room/object features with authenticated clients | Test fixtures | Test data only; no authentication bypass in app code |
| `tests/authClient.mjs`, `liveMultiplayer.mjs`, `browserObjects.mjs` | Opt-in HTTP/live/browser checks now use real sessions | Running test app and account credentials | Test sessions and, for object checks, disposable test bedrooms |
| `backend/reset_house.py` | Existing explicit reset utility now removes sessions before accounts | Database | Destructive reset only when explicitly invoked; not used by this migration |

The Python class is still named `Visitor` to keep this change focused, but it now
represents an account. Its table and keys stay unchanged because existing room
ownership and uploaded-media authors already refer to them. The old `NameEntry.jsx`
and `/api/visitor` entry flow are retired.

## 2. Signup flow

```text
React mounts
  → GET /api/auth/session
  → anonymous HttpOnly cookie + CSRF token
Create account form
  → POST /api/auth/register { username, password, optional activationCode }
  → Flask validates input and CSRF
  → Werkzeug hashes the password with scrypt
  → transaction creates account (no automatic space membership)
     OR activates a reserved account after checking its invitation
  → create a fresh authenticated session
  → browser receives cookie; React receives account data + new CSRF token
  → GET /api/spaces → choose existing membership or create/join space
  → GET personal room → mount Canvas → authenticated Socket.IO connection
```

Creating an account and its session in one transaction avoids partial signup.
The username primary key prevents duplicates during simultaneous signup. The losing
transaction rolls back and receives 409; it never takes over the winner's account.
Bedroom creation is now part of a separate space creation/join transaction.

## 3. Passwords and login

A password hash is a one-way verifier, not an encrypted password that we can decrypt.
Werkzeug's scrypt deliberately makes guessing expensive. Login checks the submitted
password against that verifier, then creates a fresh session. Unknown usernames and
incorrect passwords return the same error. The UI never stores passwords in localStorage.

The current limiter allows 20 login/signup attempts per IP in 15 minutes and bounds
its memory. It lives in this single worker and resets on restart. Shared, persistent
rate limiting is a future hosting concern; the current public instance remains a small playtest.

## 4. Cookies, sessions, and CSRF

The cookie contains a random opaque token. PostgreSQL stores only its SHA-256 hash,
account ID, CSRF token and expiry. Anonymous form sessions last one hour; authenticated
sessions last seven days without extending their absolute expiry on every request.
Each browser can have its own session for the same account.

HttpOnly prevents JavaScript from reading the session cookie. Secure restricts it
to HTTPS on the public app; localhost development uses HTTP. SameSite=Lax helps limit
cross-site cookie use. We also require a matching `X-CSRF-Token` for every mutation
and reject a different Origin when it is supplied. These are separate defenses:
SameSite alone does not replace CSRF protection. Session decisions follow
[OWASP's session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

The CSRF token is held in the API module's memory and sent by the shared request
helper, including image/audio FormData uploads. It is not the login credential.
Missing/expired login returns 401; logged-in users without permission get 403.

## 5. Authentication versus authorization

Authentication answers “which account is making this request?” through the session.
Authorization answers “may that account do this?” through `can_enter_room` and
`can_edit_room`. All house/media APIs require login. Open bedrooms allow visits by members of that space;
their owners control decoration/configuration. A host role on the membership allows
editing that space’s living room.
Hiding an Edit button is convenient UI; the Flask check protects the database.

## 6. Multiplayer, logout, and cleanup

Socket.IO checks the cookie, room permission and CSRF when connecting. The player
entry stores the session hash; display names come from the account, not client input.
Every shared action checks that its database session still exists and is unexpired.
This also catches revocation from another backend process.

Logout deletes the authenticated session, replaces it with an anonymous form session,
and disconnects all sockets attached to that session. Existing disconnect handlers
release seats and screen sharing. React unmounts the room, running existing voice,
media, audio and listener cleanup. Other sessions for that account stay logged in.
Other tabs sharing the same cookie receive the disconnect; focus/periodic checks also
catch a logout or account switch. An idle connection in another server process is
disconnected on its next action; it cannot perform that action with a revoked session.

## 7. Endpoints and manual checks

| Method/path | Result |
| --- | --- |
| `GET /api/auth/session` | `{ user: null or account, csrfToken }`; restores or bootstraps session |
| `POST /api/auth/register` | Creates/activates account, returns authenticated session; 201 |
| `POST /api/auth/login` | Checks credentials, rotates session; 200 or generic 401 |
| `POST /api/auth/logout` | Revokes current session, returns anonymous session; 200 |

In Bruno, first GET the session, keep its cookie jar, and copy `csrfToken` into the
`X-CSRF-Token` header. Login/signup uses JSON `{ "username": "…", "password": "…" }`.
Replace the CSRF header with the new token returned after successful login. The same
header is required when saving a room, changing object config, or uploading media.
Do not put real passwords or invitation/session tokens into committed collections.

To test in the browser:

1. Create a new account, create a space, and confirm a personal bedroom and editable furniture.
2. Refresh; confirm the session and saved layout return.
3. Invite a second account using an independent browser/profile; meet in that space’s living room.
4. Visit the first account's bedroom; verify its editor is unavailable.
5. Sit or start sharing, then log out; verify the avatar/seat/share are released.
6. Log in with the wrong password, then the correct one; only the second should enter.
7. Open a reserved owner's activation link; choose a password and check the old furniture.

Automated checks:

```bash
npm test
npm run build
TEST_DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms_test' \
  backend/.venv/bin/python -m unittest discover -s backend/tests -q
# Opt-in real multiplayer check with an existing test account:
TEST_SERVER_URL='http://127.0.0.1:5003' TEST_USERNAME='your test account' \
  TEST_PASSWORD='your test password' node tests/liveMultiplayer.mjs
```

Use only the dedicated test app/database for `browserObjects.mjs`; it creates two
test accounts and changes their rooms. It needs the existing headless-browser setup.

## Practice and interview questions

1. Trace signup from the form to the committed PostgreSQL rows, without looking at this guide.
2. Add a second logged-in browser to the same account and verify logout affects only its session.
3. Write a test that a malformed or expired invitation cannot change an existing room.
4. Add a client-side password strength hint; explain why server validation remains necessary.
5. Explain why changing `isHost` in React cannot grant server permissions.

You should be able to explain hashing versus encryption, session rotation/revocation,
cookies versus localStorage, CSRF versus authentication, transactions and uniqueness,
and why a WebSocket connection needs continuing permission checks after login.
