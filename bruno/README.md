# Test the room API with Bruno

Open this folder as a Bruno collection and select **Local**. baseUrl points to
http://127.0.0.1:5001. Flask and PostgreSQL must be running; React is not required.
The collection tests name-based bedrooms and the protected shared living room.
Set **savedName** in the environment: that same name always reopens the same bedroom.

Run requests in order:

| Request | Expected | What it teaches |
|---|---|---|
| 01 Health | 200 | HTTP availability |
| 02 Load central room | 200 | Shared read-only layout |
| 04 Reject central save | 403 | The shared layout cannot be replaced |
| 05 Initialize visitor | 201 or 200 | POST a name to create/reopen its bedroom |
| 06 Load personal room | 200 | Owner cookie plus captured personalRoomId |
| 07 Save personal room | 200 | PUT replaces the complete last-loaded snapshot |
| 08 Invalid personal furniture | 400 | Authorized requests still need validation |
| Missing room (after initialization) | 404 | Visitors can enter any existing room |
| Room directory | 200 | Room summaries for visiting |

Bruno's cookie jar is separate from your browser. Entering the same saved name
as your browser reopens that same bedroom; choose a test name for isolated checks.
Keep cookies enabled and use the same host. Request 05 captures personalRoomId;
request 06 serializes its complete items into personalLayout. Request 07 sends
that exact snapshot, with its unique furniture IDs. No visitor cookie is printed
or copied into frontend code.

Always GET immediately before resending PUT: an old complete snapshot can replace
newer edits. To practice, copy the latest personal items into a new PUT and alter
one valid position/quarter-turn rotation. Do not reuse central starter IDs;
furniture IDs are globally unique. Keep the complete items array because pieces
absent from it are deleted. An empty items array deliberately clears your own room.

The flow is Bruno -> HTTP/cookie -> Flask ownership + validation -> SQLAlchemy
transaction -> PostgreSQL -> JSON. Disabled UI buttons alone do not enforce
permissions; the central save request proves that direct HTTP cannot replace the shared layout.

Repeat CLI verification from this folder:

```bash
npm exec --cache /private/tmp/social-rooms-bruno-cache --yes --package=@usebruno/cli@4.0.0 -- bru run --env Local
```

Verified: 9 requests, 18 assertions, and 1 script test passed. The CLI lives in a
temporary npm cache, not application dependencies. Earlier CLI installation
reported transitive deprecations; they were not suppressed. A collection run
creates its own anonymous test room and saves its last-loaded layout.

See [Personal rooms](../backend/PERSONAL_ROOMS.md) for architecture and exercises.
