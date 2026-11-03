# Results Service - Part 4

This service reads poll details and vote counts through REST, calculates result
percentages, and sends complete snapshots through Socket.IO. Express and
Socket.IO share one HTTP server on port 3003. It uses the already installed
dependencies and Node's built-in `fetch`; it opens no SQLite database and keeps
no results cache.

## Run and configure

Start the Poll and Voting Services, then run one of these commands from this
service folder:

```powershell
npm run dev
```

```powershell
npm start
```

Use `dev` for automatic source reloads or `start` for normal startup. The defaults
work without a `.env` file. Copy `.env.example` to `.env` to customize them:

```dotenv
PORT=3003
CLIENT_ORIGIN=http://localhost:5173
POLL_SERVICE_URL=http://localhost:3001
VOTING_SERVICE_URL=http://localhost:3002
```

HTTP routes and Socket.IO allow the configured client origin through CORS.
Service URLs must be HTTP or HTTPS base URLs without a query or fragment.
Configure `RESULTS_SERVICE_URL=http://localhost:3003` in the Voting Service to
send notifications here; that is also its default.

## REST endpoints

| Method | Endpoint | Successful response |
| --- | --- | --- |
| GET | `/health` | 200: `{ "status": "ok", "service": "results-service", "port": 3003 }` |
| GET | `/results/:pollId` | 200: complete result snapshot |
| POST | `/internal/votes` | 200: `{ "ok": true, "pollId": 1 }` after refreshing and broadcasting that poll |

Poll IDs must be positive safe integers. The notification body is
`{ "pollId": 1 }`, with a numeric ID. It carries no supplied vote counts: Results
always rereads the Poll and Voting APIs rather than trusting notification data.
The internal endpoint adds no new authentication mechanism.

An illustrative snapshot is:

```json
{
  "pollId": 1,
  "question": "Which language?",
  "roomCode": "483921",
  "status": "open",
  "totalVotes": 3,
  "results": [
    { "optionId": 1, "text": "JavaScript", "count": 2, "percentage": 66.67 },
    { "optionId": 2, "text": "Java", "count": 1, "percentage": 33.33 }
  ]
}
```

Every option is included in Poll Service order. A poll without votes has zero
counts and zero percentages. Percentages are rounded to two decimal places, so
their sum can differ slightly from 100. Closed polls remain readable with 200.

Each snapshot reads `GET /polls/:id`, then `GET /votes/:pollId/counts`. Each request
has a separate three-second timeout that includes its response body. Voting's
count endpoint also consults the Poll API, so both services must be available.
`/health` does not request either upstream service.

Errors use `{ "error": "Readable explanation." }`: invalid IDs or bodies return
400, missing polls return 404, malformed or unexpected upstream responses return
502, and unavailable services, timeouts, or upstream 503 responses return 503.
Invalid JSON returns 400 and bodies over 16 KB return 413.

## Socket.IO events

| Direction | Event | Payload |
| --- | --- | --- |
| Client to server | `join-poll` | `{ "pollId": 1 }` |
| Server to client | `results-update` | Exactly the same complete snapshot as `GET /results/:pollId` |
| Server to client | `results-error` | `{ "pollId": 1, "status": 503, "error": "Readable explanation." }` |

`results-error` omits `pollId` when the join input does not contain a valid ID.
An optional `join-poll` acknowledgement receives `{ "ok": true, "pollId": 1 }`
or `{ "ok": false, "status": 404, "error": "Readable explanation." }`.

Joining fetches a fresh snapshot and subscribes to `poll:<id>`. Each socket joins
one poll at a time. A new join leaves the old poll, including when the new ID is
invalid. Disconnects leave the room, and pending lookups cannot later join or
deliver a snapshot for an abandoned request.

Set `auth: { pollId: 1 }` when creating the Socket.IO client to join automatically
on each connection and reconnection. Alternatively, emit `join-poll` from every
`connect` handler. Handshake `auth.pollId` selects a room; it does not authenticate
a user. The [API guide](../../docs/api.md) includes an executable Node example
using the existing client dependency. The React host workspace now uses the
explicit-join approach, with Recharts results.

## Notifications and delivery

After persisting a vote, the Voting Service sends a best-effort notification
containing only `pollId`. It does not wait for Results before returning 201.
A failed notification or two-second timeout is logged and does not roll back
the vote. Results serializes refreshes per poll to keep an older request from
overwriting a newer broadcast.

There is no retry queue or broker. A missed update is recovered by requesting
the REST snapshot, joining again, reconnecting, or receiving the next successful
notification. Poll and Voting databases remain the stored source of results.

## Checks

From this service folder:

```powershell
npm test
```

From the project root:

```powershell
npm --prefix services/results-service test
Invoke-RestMethod http://localhost:3003/health
```

Tests cover REST snapshots and percentages, empty and closed polls, malformed or
unavailable upstream services, Socket.IO joins, room isolation, reconnects,
disconnects, and vote-triggered updates. See the [architecture](../../docs/architecture.md)
and [root README](../../README.md) for service flows and full startup commands.

Verified on November 2, 2026: **12 Results tests passed, 0 failed**. The full
project verification also passed all 8 Poll tests, all 16 Voting tests, and the
client production build. Integration tests use real Poll and Voting apps with
temporary databases and the existing client Socket.IO dependency. No normal
database files are changed by these tests.
