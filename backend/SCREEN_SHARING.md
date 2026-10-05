# Living-room screen sharing

One visitor at a time can use the living-room projector. Walk up to the projector
on the living-room table; its nearby controls include **Share screen**.
Click it,
choose a screen/window/tab in the browser's picker, and keep the app open. Visitors
see a still-image preview on the wall. Walk within 2.5 world units of the projector
and click **View screen** (or click the projector surface) to open the full video.
Close the viewer or press Escape to return to walking. The viewer also has a
Fullscreen button.

The first version shares video only. Existing proximity voice supplies conversation;
screen sharing neither enables a microphone nor requires joining voice. The browser
may require macOS **System Settings → Privacy & Security → Screen & System Audio
Recording** permission for the browser. HTTPS or localhost is required.

## Two different data paths

The projector thumbnail and full video have different jobs:

```text
Browser screen picker → MediaStream (target 1280×720, up to 30 fps)
  ├─ 240×135 JPEG, first image immediately, then once every five seconds
  │    → Socket.IO → Flask → living-room visitors → CanvasTexture on projector
  └─ full video, only after View screen
       → RTCPeerConnection → viewer's <video>
```

Tiny previews travel through Flask because they are inexpensive for this small
prototype. The server caps a preview at 12,000 characters, rejects non-JPEG data
URLs, limits update frequency, and keeps only the latest preview in memory for
late arrivals. The screen keeps its last image while the next JPEG decodes; its
existing GPU texture is updated only when the image arrives, without generating
mipmaps. It does not record screens or save previews in PostgreSQL.

Full video travels through WebRTC. Socket.IO carries offers, answers, and ICE
candidates to set up the connection, not the full video frames. The server checks
that the presenter owns the current share, the viewer explicitly opted in from
near the projector, and both are in the living room. Voice distance restrictions
are separate: screen viewers keep watching until they close the modal.

The same configured STUN/TURN servers as voice are reused from `/api/voice-config`.
A TURN relay can be necessary between different internet networks. The current
default is STUN only. Upload usage grows with each full-video viewer; this is a
small peer-to-peer prototype, not a large broadcast service.

## What 720p means here

Capture requests a maximum 1280×720 at 30 fps. Each outgoing video connection also
limits encoding to those dimensions and about 2.5 Mbps. Original aspect ratio is
preserved: a portrait or ultrawide window will not become a distorted 16:9 image.
Smaller sources stay smaller, and WebRTC can reduce quality when bandwidth is low.
The five-second projector preview is deliberately 240×135; clicking View
opens the full-resolution stream, rather than enlarging that JPEG.

Browser API references:
[getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia),
[addTransceiver and sendEncodings](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTransceiver).

## Files and responsibilities

| File | Receives | Changes / owns | Why it exists |
|---|---|---|---|
| `src/ScreenSharing.js` | Socket, central-room flag, state callback | Capture stream, preview timer, WebRTC connections, sharing/viewing state | Browser media resources must survive React rerenders and be explicitly cleaned up |
| `src/useScreenSharing.js` | Socket ref and central-room flag | React state and one engine ref | Connects the resource owner to React, disposing it on room travel/unmount |
| `src/Projector.jsx` | Preview/state, connection flag, saved table, player ref, proximity callback | One GPU texture and nearby flag | Draws the screen and device resting on the table; Drei Html anchors nearby controls beside it |
| `src/ScreenShareControls.jsx` | Sharing state/actions, connection/proximity flags | Projector buttons, dialog, video element, playback errors | Keeps controls in HTML; Stop/Cancel remain available after walking away |
| `src/App.jsx` | Existing room/player state | Connects the hook, projector, controls, and movement pause | Coordinates the existing frontend components |
| `src/MainHall.jsx` | Hall geometry | Living-room shell and opaque bedroom exteriors | Closed walls and ceilings hide bedroom interiors until entry |
| `src/styles.css` | CSS classes | Projector control panel and viewer styling | Matches the existing warm room UI |
| `backend/screens.py` | Screen-specific socket events and connected player records | Current presenter, preview, viewers, session ID | Enforces one presenter and routes approved video setup |
| `backend/realtime.py` | Existing connections/disconnections | Sends the screen snapshot and cleans up departing participants | Screen sharing follows the same room connection lifecycle as movement |
| `backend/app.py` | Flask startup | Registers the screen event module | Adds handlers to the existing server without a new service |
| `backend/tests/test_api.py` | Dedicated test database | Tests ownership, proximity, sessions, previews, and disconnect cleanup | Checks behavior that cannot be trusted to frontend buttons alone |
| `tests/browserScreen.mjs` | Isolated Chromium and test server | Temporary browser contexts and simulated screen | Checks real video delivery and the complete user flow without capturing your desktop |
| `tests/browserVoice.mjs` | Existing voice browser fixture | Uses shorter timed key pulses | Avoids slow software-rendered frames causing corridor steering to overshoot during regression checks |

## Key concepts to understand

1. **A stream is not React state alone.** It owns real browser capture devices and
   network connections. Setting a button to "off" is insufficient; tracks must
   stop, peer connections must close, and listeners/timers must be removed.
2. **User activation matters.** `getDisplayMedia` is invoked directly in the click
   path, before any `await` that could lose permission to open the picker. The
   browser asks for screen selection every time.
3. **Preview is not full viewing.** The projector uses a thumbnail texture; the
   modal subscribes to a separate WebRTC stream. Closing the modal releases that
   subscription without stopping the presenter's capture.
4. **Session IDs reject stale work.** Every share has a server-generated UUID.
   Packets from an earlier share cannot stop or negotiate a later one. Generation
   counters also stop streams that resolve after a user cancels a permission picker.
5. **Only the presenter offers.** Unlike two-way voice, this is one-way video.
   This predictable offer direction avoids simultaneous-offer negotiation races.
   Candidates wait until a remote description exists; async setup is serialized.

Interview explanation: "React owns the controls and presentation. A resource owner
manages screen capture and WebRTC lifetime. Flask authorizes and signals the share;
thumbnails pass through the server, full video passes between peers. Proximity
gates the viewing action. Room travel and disconnects dispose all resources."

## Small exercises

- Change the 2.5-unit interaction radius on both client and server; explain why both
  checks are needed.
- Add a nearby floor marker that changes color when View becomes available.
- Change thumbnail frequency and resolution, then estimate bandwidth per visitor.
- Trace a viewer's offer/answer/candidate exchange, and explain why candidates can
  arrive before the description they depend on.

## Verification

Use the isolated Chromium/test-server setup documented in `PROXIMITY_VOICE.md`.
Run `node tests/browserVoice.mjs` first to create the two test names in the first
two bedroom slots, then `node tests/browserScreen.mjs`. The screen test reuses those
names; its keyboard paths expect their doors at ±8.2. Never run these fixtures
against the development database or a public app.

The screen test replaces only `getDisplayMedia` with a moving 1280×720 canvas.
Everything downstream is real: media tracks, WebRTC, socket signaling, UI,
collision-aware WASD movement, and decoded video. It verifies nearby projector buttons,
240×135 JPEG dimensions and five-second refreshes, preview-only traffic
before View, 720p frame decoding, paused movement, closing/reopening, stopping,
late permission cancellation, denial, browser-ended capture, voice coexistence,
room travel, and runtime errors. The native screen picker/macOS capture permission
still needs a manual check on the user's computer.
