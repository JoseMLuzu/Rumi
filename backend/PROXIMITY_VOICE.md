# Names above avatars and proximity voice

## Try it with a friend

1. Refresh the same public app URL on both computers and enter different saved names.
2. Meet in the living room, or visit the same bedroom. Your chosen names appear
   above your characters; the labels face the camera as characters turn.
3. Both click **Join Voice**, allow microphone access, and walk close together.
4. **Mute mic** stops transmitting your microphone; **Unmute mic** restores it.
5. Walk away: volume fades. Beyond eight world units you cannot hear that player.
6. **Leave Voice**, room travel, disconnect, or closing the page releases the mic.
   Join again in the next room. Voice is never enabled automatically.

Use headphones when testing on nearby computers to avoid speaker feedback. A
denied permission or missing microphone is shown in the voice panel. Microphone
access requires HTTPS or localhost; see [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## The two network paths

```text
Saved-name cookie -> Flask -> server-owned player name
  -> room_state / player_joined / player_moved -> local and remote avatar labels

Join Voice -> microphone permission -> MediaStream
  -> voice_state {enabled, muted} -> participants in the same live room

Nearby participants -> RTCPeerConnection offer / answer / ICE candidates
  -> existing Socket.IO -> Flask checks participants, room, and range
  -> target participant's Socket.IO -> browser finishes WebRTC setup

Actual microphone audio -> WebRTC -> other browser
  -> MediaStreamAudioSourceNode -> GainNode -> speakers/headphones
```

Socket.IO is the **signaling** path: it exchanges descriptions of the call and
candidate connection routes. Audio is carried by WebRTC, not Flask, PostgreSQL,
or Socket.IO. No audio recording, audio database table, or additional package was
introduced. See [MDN's signaling explanation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling).

The player record includes `name`, `voiceEnabled`, and `voiceMuted` in addition
to ID, position, and rotation. Flask derives the name from the saved visitor's
bedroom label; a client cannot impersonate another name in a movement packet.
The connection's Socket.IO ID identifies audio peers, even when two browsers
enter the same saved name. An unnamed central-room test connection is labeled
Guest and cannot join voice.

## Why offers, answers, and ICE exist

An offer describes the sender's audio capabilities. The answer selects compatible
settings. ICE candidates describe possible network routes between the devices.
One side offers, chosen by comparing connection IDs, so both do not create
conflicting offers at the same time. Each peer's asynchronous description and
candidate operations run in a queue. Candidates received early wait until the
remote description is set. Setup signals arriving just before the join
acknowledgement are also buffered.

The small-room implementation uses one peer connection per nearby pair. This is
a mesh, appropriate for a short playtest with a few people. Large crowds would
need a different media architecture; this milestone does not add one.

The remote stream is also attached to a playing, muted audio element. Chromium
needed that playback activation during verification. Its element stays silent;
the GainNode is the only audible output, so it cannot bypass proximity fading.
Peer cleanup pauses the element and clears its stream.

## Distance and volume

We measure X/Z distance between player positions, independent of camera position.
Full volume applies within two world units. Between two and eight, volume is
`((8 - distance) / 6)²`. Eight or more gives zero. `GainNode` changes smoothly to
avoid audio clicks as positions update. A muted peer's gain is also zero.

New connections are created within eight units and closed past ten. The extra
two units prevent repeated teardown when someone walks back and forth at the
hearing boundary. Approaching again creates a new connection. Server signaling
is restricted to ten units and to enabled participants in the same room.
No wall occlusion or directional panning is implemented; this is distance-based
voice. Client volume control is not a security guarantee against a modified
browser, and saved names remain temporary identity rather than authentication.

Refs and the voice instance hold live browser resources. React state holds the
panel's enabled/muted/busy/error state and connection counts. The instance reads
the latest local pose and remote live events every 100 ms, updating React only
when panel values change. It does not recreate a microphone or peer connection
on every movement render. [GainNode](https://developer.mozilla.org/en-US/docs/Web/API/GainNode)
and [MediaStream audio sources](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamSource)
provide the browser audio graph.

## Cleanup matters

`Leave Voice` clears the distance timer, aborts pending configuration loading,
closes peer connections, disconnects audio nodes, stops microphone tracks, and
closes the audio context. React unmount does the same during room travel and
StrictMode's development checks. Leaving another player closes that peer only.

Microphone permission can resolve after Cancel or unmount. A generation counter
identifies the current join attempt; a late stream from an old attempt is stopped
immediately. Mute uses `track.enabled = false` without renegotiating; Leave uses
`track.stop()` to release capture. Failed connections are displayed and blocked
from repeated rapid retries. Leave and rejoin to retry.

## Internet connectivity: STUN and optional TURN

The default ICE configuration uses `stun:stun.l.google.com:19302` to discover
network addresses. Direct audio can fail behind restrictive firewalls or NAT.
The public Cloudflare app URL carries the app and signaling, while WebRTC needs
its own working media route. A **TURN** service relays encrypted media when direct
routes fail; no TURN service has been provisioned in this milestone. See
[WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity).

Flask reads optional relay settings from `VOICE_ICE_SERVERS` at startup and returns
them from `/api/voice-config` only after saved-name entry. To use a relay you own,
set actual temporary credentials before restarting the relevant backend:

```bash
export VOICE_ICE_SERVERS='[
  {"urls":"stun:stun.l.google.com:19302"},
  {"urls":["turn:YOUR-RELAY:3478?transport=udp","turns:YOUR-RELAY:5349?transport=tcp"],
   "username":"TEMPORARY-USER","credential":"TEMPORARY-PASSWORD"}
]'
```

These are placeholders, not a working relay. Keep real credentials out of source
control. ICE credentials must reach browsers participating in calls; a future
deployment should issue short-lived TURN credentials. A failed connection is
shown clearly instead of claiming voice is connected. Testing two browsers on
this Mac proves the audio implementation, not connectivity through every NAT.

## Files and responsibilities

| File | Receives | Changes/produces | Why it exists |
|---|---|---|---|
| `src/PlayerNameTag.jsx` (new) | Name and voice flags | Camera-facing textured label | Shares readable labels across local and remote avatars |
| `src/Player.jsx`, `src/RemotePlayer.jsx` | Player name/flags | A label above each existing avatar | Attaches names without changing movement or geometry |
| `src/RoomSign.jsx` | Text, size, optional depth test | Reused canvas text texture | Draws labels without adding a separate DOM root or font download |
| `src/useRoomConnection.js` | Live player events | Name, merged peer metadata, socket and pose refs | Preserves identity and voice flags across movement updates |
| `src/voiceMath.js` (new) | Two positions or distance | Floor distance and volume | Keeps hearing rules small and testable |
| `src/ProximityVoice.js` (new) | Socket, latest-pose reader, UI callback | Microphone, WebRTC peers, audio gains, signaling and cleanup | Gives browser resources one explicit room lifetime |
| `src/useProximityVoice.js` (new) | Stable socket/pose refs | React panel state and join/mute/leave actions | Connects the resource owner to React and unmount cleanup |
| `src/VoiceControls.jsx` (new) | Voice state and live connection | Opt-in, mute, leave, status and errors | Keeps permission and controls understandable |
| `src/App.jsx` | Live identity and voice state | Wires the labels and per-room voice controls | Stops room voice when the editor scene unmounts |
| `src/styles.css` | Voice panel classes | Compact overlay | Fits the existing visual style |
| `backend/realtime.py` | Visitor cookie, poses, voice flags/signals | Server-owned names and restricted targeted signaling | Reuses the existing room/connection boundary |
| `backend/app.py` | Optional ICE environment settings and HTTP request | Voice configuration endpoint | Supports relay configuration without hardcoded browser credentials |
| `backend/tests/test_api.py`, `tests/voiceMath.test.js` | Fixtures and distances | Names, range, room, flags and malformed-packet checks | Tests the new behavior without using a real microphone |
| `tests/browserVoice.mjs` (new) | Isolated Chromium debugger and test server | Actual audio/controls/cleanup checks with simulated mics | Covers behavior ordinary unit tests cannot prove |
| `tests/liveMultiplayer.mjs` | Existing server | Updated player-record assertions | Keeps the earlier movement check compatible |

## Exercises and interview topics

1. Change the fade curve to linear and compare nearby/faraway volume. Update
   `voiceMath.test.js` before changing the curve.
2. Explain why a microphone track being disabled differs from being stopped.
3. Trace one offer, its answer, and an ICE candidate from browser to server to browser.
4. Change the label colors for muted players using the existing flags.
5. Rewrite the late-permission cleanup in a small standalone exercise and explain
   how an obsolete async result can otherwise keep the mic active.

Be able to explain signaling versus media, browser permission/user gestures,
AudioContext and GainNode, unique connection IDs, deterministic offer ownership,
candidate ordering, cleanup, and why TURN may be needed on the public internet.

## Repeat browser verification

Use the **test** database and an isolated test server on port 5003, never the
development database for resetting or creating these test names. Start Chromium
with a fresh temporary profile, remote debugging port 9229, fake-device and
fake-permission flags, and background throttling disabled. This test must not use
your real microphone. On this Mac, the installed Brave browser can be launched
in a separate terminal with:

```bash
'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' \
  --headless --no-first-run --no-default-browser-check \
  --user-data-dir=/private/tmp/social-rooms-voice-check --remote-debugging-port=9229 \
  --use-angle=swiftshader --enable-unsafe-swiftshader \
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
  --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling \
  --disable-renderer-backgrounding --disable-backgrounding-occluded-windows about:blank
```

For the test server, initialize only the disposable test database and run a
single worker so both browser sessions share live state:

```bash
DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms_test' \
  backend/.venv/bin/python -m backend.reset_house
DATABASE_URL='postgresql+psycopg://localhost:5432/social_rooms_test' \
  backend/.venv/bin/gunicorn --no-control-socket --worker-class gthread \
  --workers 1 --threads 20 --bind 127.0.0.1:5003 backend.app:app
```

Then run in another terminal:

```bash
TEST_SERVER_URL=http://127.0.0.1:5003 node tests/browserVoice.mjs
```

The test creates separate browser contexts/cookies, joins named test bedrooms,
walks using real keyboard events, checks received WebRTC audio statistics and
gain changes, verifies mute/cancel/permission denial/room cleanup, and saves a
screenshot in the system temporary directory. It closes those browser contexts
when finished. Normal `npm test` remains offline and does not launch a browser.

Verification passed: 29 frontend tests, 37 PostgreSQL backend tests, the production
build, and this two-browser check. The browser test measured incoming audio packets
and nonzero samples at the gain output, not just a connected status. Names, mute,
distance fading, call teardown/reconnection, late permission cancellation, denied
permission, and room travel all passed without runtime exceptions or console
errors. An early test-harness packet-parser issue was corrected; the final check
used the actual application audio path. The existing Vite large-bundle warning
remains visible. Cross-network TURN connectivity still depends on your relay setup.
The refreshed public build, protected voice configuration endpoint, and live
movement/reconnection checks also passed through the existing HTTPS tunnel.
