# Temporary public multiplayer test

The app can now be shared with someone on another network through a temporary
Cloudflare Tunnel. Open the **same public URL on both computers**, including your
Mac. Log in, click **Spaces**, create a space and copy its invitation link for a friend.
They sign in or create an account and accept the invitation, then meet in that
space’s living room. Existing users retain **gci**. See [Spaces](../SPACES.md).
Your avatar is green; other
players appear in coral. Move away from the common spawn to see each other.

The public instance allows owners to decorate their personal bedrooms. Accounts
with the explicit host role can edit the living room. Existing bedrooms are
reserved until activated through a private local-admin invitation. See
[Accounts](../ACCOUNTS.md) for migration, activation and permissions.
It reads layouts from local PostgreSQL. Your existing local editor remains available on
http://127.0.0.1:5173. It uses a separate live server, so players connected to that
localhost URL do not meet the players using the public URL.

## Repeat the test

From the project root, with PostgreSQL running:

```bash
npm run build
backend/.venv/bin/python -m pip install -r backend/requirements.txt

TRUST_PROXY_HEADERS=true DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms' ROOM_READ_ONLY=false \
  backend/.venv/bin/gunicorn --worker-class gthread --workers 1 --threads 20 \
  --bind 127.0.0.1:5002 backend.app:app
```

Keep that terminal running. In another terminal:

```bash
cloudflared --no-autoupdate tunnel --url http://127.0.0.1:5002
```

`cloudflared` was installed with `brew install cloudflared`. Copy the HTTPS URL it
prints and open/share that URL. No account, domain, router port forwarding, or
database port exposure is needed for this test. Anyone with the app URL can create an account. Joining a space requires its
invitation, or creating a new space. Generate invitations from the public hostname
so they work on another computer.
The URL changes when you restart the quick tunnel; there is no uptime guarantee.

Keep your Mac awake and keep PostgreSQL, Gunicorn, and the tunnel running. Closing
the terminal/processes or sleeping the Mac interrupts access. To end public
access, press **Ctrl+C in the tunnel terminal**. Stop Gunicorn with Ctrl+C in its
terminal too when finished. Neither process was installed as a login service.

## What changed and why

1. **Build React.** `npm run build` creates `dist/index.html` and compiled assets.
   Visitors receive this build, rather than the Vite development server/source.
   Rebuild after frontend changes; this URL does not use hot module replacement.
2. **Serve one origin.** Flask serves `/`, `/assets`, `/api`, and `/socket.io` from
   the same app. The existing relative `fetch` calls and Socket.IO connection
   automatically use the public host. No public backend URL or CORS wildcard is
   added to frontend code.
3. **Run Gunicorn.** It serves Flask with ordinary threads and the existing
   simple-websocket transport. One worker keeps all players in the same in-memory
   dictionary. Several worker processes would have separate dictionaries and
   require coordinated presence/broadcasting. Twenty threads are enough for this
   small test; this is not a load-tested hosting setup.
4. **Create an outbound tunnel.** `cloudflared` connects this local HTTP service to
   Cloudflare. Browsers use HTTPS and secure WebSockets at the public URL, while
   Gunicorn stays bound to localhost. PostgreSQL is not exposed by the tunnel.
5. **Protect ownership.** An authenticated session permits saving its own personal
   room. Hosts can edit their space’s living room; unauthorized saves return 403.
   Mutation requests also require the session CSRF token. GET supplies readOnly
   for UI controls; Flask enforces the actual restriction. ROOM_READ_ONLY=true
   remains an optional switch disabling all furniture writes.

```text
Other computer (HTTPS / WSS)
  -> Cloudflare -> tunnel on this Mac -> Gunicorn/Flask on port 5002
      -> GET furniture -> SQLAlchemy -> local PostgreSQL
      -> player events -> in-memory players -> other public connections
      -> PUT personal furniture -> ownership check -> database transaction
      -> PUT central/other furniture -> host/ownership check -> save or 403
```

The local backend on port 5001 has separate live connections. Cookie identity also
differs between localhost and the public hostname, but logging in with the same
credentials reopens the same bedroom. No cloud database or paid hosting resources
were introduced. The single-worker rate limiter resets when the server restarts;
this remains a small public playtest, rather than permanent production hosting.

## Files changed

| File | Responsibility and data flow |
|---|---|
| `backend/app.py` | Serves compiled files; reads the playtest setting; adds its flag to GET; rejects public PUTs |
| `backend/requirements.txt` | Adds Gunicorn, the HTTP/WebSocket application server |
| `src/App.jsx` | Passes the loaded room's read-only flag to the UI |
| `src/RoomUI.jsx` | Uses that flag to disable editing/saving and display the locked-layout status |
| `backend/tests/test_api.py` | Checks that the public restriction rejects saves and preserves database furniture |
| `tests/liveMultiplayer.mjs` | Accepts any test server URL and sends a browser-like Origin header |
| READMEs and this guide | Explain how to start, share, test, and stop the public instance |

## Verification

The initial public milestone passed 18 frontend and 16 backend tests. The current
main-hall milestone passes 26 frontend and 27 backend tests plus the build;
see [Main Hall](MAIN_HALL.md) for current corridor movement and browser checks. The
existing Vite large-bundle warning remains visible. Real checks through the
public HTTPS URL verified the HTML, JS/CSS assets, room API, save rejection, two
WebSocket players moving in both directions, leaving, and reconnection. The
saved furniture stayed unchanged. These network checks ran from this Mac through
Cloudflare; the final hands-on check is for your friend to join from their computer.

Repeat the network check while the tunnel is running, using an existing test account
that belongs to a space. Optionally set TEST_SPACE_ID to select one of its memberships:

```bash
TEST_SERVER_URL='https://YOUR-CURRENT-HOST.trycloudflare.com' TEST_USERNAME='test account' \
  TEST_PASSWORD='test password' node tests/liveMultiplayer.mjs
```

## Practice yourself

1. Explain why a public browser's `/api/rooms/1` request reaches Flask without a
   hardcoded localhost URL in JavaScript.
2. Inspect the GET's `readOnly` field and the PUT's 403 response in Bruno. Explain
   why disabled UI controls alone would not protect a save endpoint.
3. Stop/restart the tunnel and observe its new URL. Compare that with restarting
   Gunicorn: live presence resets, while PostgreSQL furniture survives.

For an interview, explain a built frontend versus a development server, one
origin, HTTPS/WSS, a reverse tunnel, application serving versus database serving,
process-local state, and server-side enforcement of write restrictions.

References: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
and [Flask-SocketIO Gunicorn deployment](https://flask-socketio.readthedocs.io/en/stable/deployment.html).
