# API guide

See the [architecture](architecture.md), [project description](project-description.md),
and detailed [Poll Service](../services/poll-service/README.md) and
[Voting Service](../services/voting-service/README.md) and
[Results Service](../services/results-service/README.md) guides.

## Addresses and conventions

| Service | Default base URL | Available functionality |
| --- | --- | --- |
| Poll | `http://localhost:3001` | Health and poll management |
| Voting | `http://localhost:3002` | Health, vote submission, counts, and totals |
| Results | `http://localhost:3003` | Health, result snapshots, and Socket.IO poll rooms |

Each service allows the React client's default origin, `http://localhost:5173`,
through CORS. Service `.env.example` files document configurable ports and origins;
Voting also uses `POLL_SERVICE_URL` and `RESULTS_SERVICE_URL`; Results uses
`POLL_SERVICE_URL` and `VOTING_SERVICE_URL`, defaulting to the URLs above.
Send JSON bodies with `Content-Type: application/json`. Service request
bodies are limited to 16 KB. Their errors use `{ "error": "Readable explanation." }`.
IDs are positive safe integers. Room codes are six-digit strings from `100000` to
`999999`. The examples below use illustrative values, never actual database data
or host credentials.

## React integration (Part 5)

The React client uses these existing endpoints without changing the backend
contracts: poll creation and retrieval, room-code lookup, vote submission,
host-only closing, and Results snapshots and Socket.IO events. Client service
URLs come from the three `VITE_*_SERVICE_URL` values in `client/.env.example`.
Requests have a ten-second timeout including the body and surface validation,
missing-poll, duplicate-vote, closed-poll, and service errors in the interface.

The host saves the full creation response in same-tab `sessionStorage` under
`lpr.host.<pollId>`. Its token is used only for the existing close authorization,
and never appears in a URL or `localStorage`. A failed save leaves the response
in memory for the current page; refresh cannot restore that fallback.
Participants store their anonymous ID in `localStorage` as `lpr.participantId`
and a per-poll confirmation receipt as `lpr.vote.<pollId>`. The backend unique
constraint remains responsible for duplicate rejection if a receipt is missing.

The host starts a REST result request alongside its Socket.IO connection and
emits `join-poll` on every `connect`, including reconnects. It handles
`results-update`, prevents lower totals from overwriting newer results, and
preserves closed status against stale snapshots. Manual refresh and retry
restart the connection and snapshot request. See the
[client guide](../client/README.md) for routes and storage behavior.

Part 6 exercises these contracts through real service processes with isolated
databases and free ports. Use the [integration guide](integration-testing.md)
for automated checks and a manual browser preview. Its printed URLs replace the
normal development defaults shown in this reference during isolated testing.

## Health

`GET /health` returns 200 on all three services. Its JSON identifies the service
and configured port; for example:

```json
{ "status": "ok", "service": "poll-service", "port": 3001 }
```

The other service names are `voting-service` and `results-service`.

## Poll Service

| Method | Path | Success |
| --- | --- | --- |
| POST | `/polls` | 201: created poll and one-time host token |
| GET | `/polls/:id` | 200: public poll |
| GET | `/polls/room/:roomCode` | 200: public poll |
| PATCH | `/polls/:id/close` | 200: public poll with `status: "closed"` |

Creation accepts one question and 2–4 option strings:

```json
{ "question": "Which language?", "options": ["JavaScript", "Java"] }
```

The question must contain 1–500 characters and each option 1–200 characters after
trimming surrounding whitespace. Options must be unique after trimming and
case-insensitive comparison. Empty text, non-string values, and invalid option
counts return 400.

Example creation response; the token shown is a dummy 64-character value:

```json
{
  "id": 1,
  "question": "Which language?",
  "roomCode": "483921",
  "status": "open",
  "options": [
    { "id": 1, "text": "JavaScript" },
    { "id": 2, "text": "Java" }
  ],
  "hostToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

The response includes `Location: /polls/1`. Save the generated host token: it is
returned only during creation, and there is no recovery endpoint. It contains
32 random bytes encoded as 64 hexadecimal characters. SQLite stores only its
SHA-256 hash. Public GET and close responses contain the poll fields above
without `hostToken` or its hash. Option IDs and ordering remain stable.

Close a poll using `Authorization: Bearer <hostToken>`; no request body is needed.
Missing or malformed tokens return 401; a well-formed incorrect token returns
403. Only an authorized host can close the poll. An authorized repeated close
returns 409. Closed polls remain readable with `status: "closed"`.

Room codes are protected by a SQLite unique constraint and remain assigned after
closure. Creation retries collisions up to 20 times, then returns 503.

## Voting Service

| Method | Path | Success |
| --- | --- | --- |
| POST | `/votes` | 201: `{ "id": 1, "pollId": 1, "optionId": 1 }` |
| GET | `/votes/:pollId/counts` | 200: option counts and total |
| GET | `/votes/:pollId/total` | 200: `{ "pollId": 1, "totalVotes": 1 }` |

Vote submission accepts numeric IDs, not numeric strings:

```json
{ "pollId": 1, "optionId": 1, "participantId": "anonymous-example-1" }
```

`participantId` must be a string of 1–100 characters after trimming and must not
contain null characters. It is case-sensitive. The service stores the trimmed
identifier but does not return it in vote or count responses. The client should
reuse one anonymous identifier for its participant; this is not authenticated
identity. A SQLite `UNIQUE (poll_id, participant_id)` constraint prevents repeated
votes from that identifier in the same poll, including concurrent submissions.
The same identifier can vote in a different poll.

Voting fetches `/polls/:id` from the Poll Service before submissions and count or
total queries. A new vote requires an open poll and an option belonging to it.
Missing polls return 404, invalid option selections return 400, and closed polls
or duplicate votes return 409. Poll validation and vote storage are separate REST
operations: a poll could close between the open-state check and the insertion.

Counts include every option, including zero votes, in the Poll Service's option
order. Count and total queries also work for closed polls. For one submitted vote:

```json
{
  "pollId": 1,
  "totalVotes": 1,
  "counts": [
    { "optionId": 1, "text": "JavaScript", "count": 1 },
    { "optionId": 2, "text": "Java", "count": 0 }
  ]
}
```

A Poll Service connection failure or timeout returns 503. The request and response
body share a three-second timeout. Unexpected upstream statuses or invalid poll
data return 502. Voting uses its own SQLite database and reads polls through REST.

After a vote is saved, Voting sends a best-effort Results notification containing
only `pollId`. The 201 response does not wait for that request. A notification
failure or two-second timeout is logged without rolling back the accepted vote.

## Results Service

| Method | Path | Success |
| --- | --- | --- |
| GET | `/results/:pollId` | 200: complete result snapshot |
| POST | `/internal/votes` | 200: `{ "ok": true, "pollId": 1 }` after refreshing and broadcasting |

Results reads the Poll Service's `/polls/:id`, then the Voting Service's
`/votes/:pollId/counts`. It stores no database or results cache. Both upstream
services must be available; each request has a separate three-second timeout
that includes reading its body. Closed polls remain readable with 200.

`GET /results/:pollId` and the `results-update` socket event share this payload:

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

All options appear in Poll Service order, including options with zero votes.
Percentages are rounded to two decimal places and can sum to slightly more or
less than 100. A poll with no votes has zero counts and zero percentages.

`POST /internal/votes` accepts `{ "pollId": 1 }` with a numeric positive safe
integer. This notification triggers a fresh lookup and broadcasts the resulting
snapshot to room `poll:1`. Supplied counts are not used. The endpoint adds no
new authentication. Joins and notification broadcasts are serialized per poll so
an older lookup cannot overwrite a newer broadcast.

Invalid IDs or bodies return 400, missing polls return 404, and unexpected
upstream statuses or malformed data return 502. Unavailable or timed-out services
and upstream 503 responses return 503.

### Socket.IO contract

Connect to `http://localhost:3003` using a Socket.IO client.

| Direction | Event | Payload |
| --- | --- | --- |
| Client to server | `join-poll` | `{ "pollId": 1 }`, with a numeric positive safe integer |
| Server to client | `results-update` | Complete snapshot shown above |
| Server to client | `results-error` | `{ "pollId": 1, "status": 503, "error": "Readable explanation." }` |

`pollId` is omitted from `results-error` when the join input has no valid ID.
`join-poll` optionally acknowledges with `{ "ok": true, "pollId": 1 }` or
`{ "ok": false, "status": 404, "error": "Readable explanation." }`.
Joining sends a fresh snapshot and subscribes to that poll's updates. Each
socket watches one poll; a new join leaves the old room even if the new ID is
invalid. Disconnects leave rooms, and replaced or disconnected join requests
cannot deliver an old snapshot or join afterward.

A handshake with `auth: { pollId: 1 }` joins automatically on every connection
and reconnection. Alternatively, emit `join-poll` inside each `connect` handler,
as the React host screen does.
This field selects the poll; it does not authenticate a user. Host tokens remain
required only for closing polls through the Poll API.

Notifications are best-effort, with no retry queue. A fresh GET, rejoin,
reconnect, or later successful notification recovers updates missed during an
outage. The following standalone example exercises the same results stream
without opening the React interface.

From the project root, run this PowerShell block using the existing
`socket.io-client` dependency in `client`. Replace `1` with a poll ID returned
by poll creation, and stop the example with Ctrl+C:

```powershell
Set-Location client
@'
import { io } from 'socket.io-client';

const pollId = 1;
const socket = io('http://localhost:3003', { auth: { pollId } });

socket.on('connect', () => console.log('Connected:', socket.id));
socket.on('results-update', (results) => console.log(JSON.stringify(results, null, 2)));
socket.on('results-error', (error) => console.error(error));
socket.on('connect_error', (error) => console.error(error.message));
'@ | node --input-type=module
```

For the explicit-join alternative, omit `auth` when creating the socket and use:

```javascript
socket.on('connect', () => {
  socket.emit('join-poll', { pollId }, (acknowledgement) => {
    console.log(acknowledgement);
  });
});
```

## Error reference

| Status | Meaning |
| --- | --- |
| 400 | Invalid input, malformed JSON, invalid ID/code, or an option outside the poll |
| 401 | Poll close request lacks a correctly formatted bearer host token |
| 403 | Poll close request contains an incorrect host token |
| 404 | Poll or endpoint does not exist |
| 409 | Poll is closed, host repeats a close, or participant already voted |
| 413 | JSON request body exceeds 16 KB |
| 415 | A service request uses an unsupported JSON charset or content encoding |
| 500 | Unexpected internal error; response does not expose internal details |
| 502 | Voting or Results received an unexpected upstream response or invalid data |
| 503 | Poll room-code retry limit reached, an upstream service is unavailable or timed out, or Results received an upstream 503 |

## PowerShell walkthrough

Start all three services, then create a poll, submit a vote, inspect counts and
results, and close the poll using values returned by the APIs:

```powershell
$pollApi = 'http://localhost:3001'
$voteApi = 'http://localhost:3002'
$resultsApi = 'http://localhost:3003'
$pollBody = @{ question = 'Which language?'; options = @('JavaScript', 'Java') } | ConvertTo-Json
$poll = Invoke-RestMethod -Method Post -Uri "$pollApi/polls" -ContentType 'application/json' -Body $pollBody

Invoke-RestMethod -Uri "$pollApi/polls/room/$($poll.roomCode)"
$voteBody = @{
    pollId = $poll.id
    optionId = $poll.options[0].id
    participantId = ([guid]::NewGuid()).ToString()
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$voteApi/votes" -ContentType 'application/json' -Body $voteBody
Invoke-RestMethod -Uri "$voteApi/votes/$($poll.id)/counts"
Invoke-RestMethod -Uri "$voteApi/votes/$($poll.id)/total"
Invoke-RestMethod -Uri "$resultsApi/results/$($poll.id)" | ConvertTo-Json -Depth 4

$hostHeaders = @{ Authorization = "Bearer $($poll.hostToken)" }
Invoke-RestMethod -Method Patch -Uri "$pollApi/polls/$($poll.id)/close" -Headers $hostHeaders
```

The vote triggers a Results notification automatically. A Socket.IO client
subscribed to this poll receives the refreshed snapshot. Poll closing does not
send a vote notification; fetch or rejoin to read the latest closed status.
React participant pages reread the poll on window focus, when the document
becomes visible, and before voting. A closed-poll 409 response marks the poll
closed; an already-voted 409 restores confirmation without recording another
vote. The host updates its own closed state after its authorized close request.
