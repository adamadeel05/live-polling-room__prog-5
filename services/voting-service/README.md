# Voting Service - Part 3

This service records anonymous votes and returns vote counts through REST APIs.
It uses the existing Express, `cors`, `dotenv`, and `better-sqlite3` dependencies,
plus Node's built-in `fetch`. No new dependencies are required. Part 4 adds
best-effort notifications to the Results Service after a vote is saved; the
Voting Service itself continues to expose REST endpoints.

## Run and test

Start the Poll Service first in its own terminal. From this Voting Service
folder, choose either development mode or normal startup:

```powershell
npm run dev
```

```powershell
npm start
```

Development mode reloads the service when source files change. Run tests in a
separate terminal:

```powershell
npm test
```

From the project root, the equivalent test command is:

```powershell
npm --prefix services/voting-service test
```

The default address is `http://localhost:3002`. CORS allows the React client at
`http://localhost:5173`, including JSON POST requests.

## Configuration and storage

The defaults work without a `.env` file. To customize them, copy `.env.example`
to `.env` in this service folder and restart the service:

```dotenv
PORT=3002
CLIENT_ORIGIN=http://localhost:5173
POLL_SERVICE_URL=http://localhost:3001
RESULTS_SERVICE_URL=http://localhost:3003
DATABASE_PATH=data/votes.db
```

`POLL_SERVICE_URL` and `RESULTS_SERVICE_URL` must be HTTP or HTTPS base URLs
without a query or fragment.
`DATABASE_PATH` is a file path. Relative paths resolve from the Voting Service
folder, even when the service is started from another directory; absolute paths
also work. The default file is `services/voting-service/data/votes.db`. The
service creates its parent directory and table automatically.

Votes remain in SQLite after a restart. The database uses write-ahead logging
(WAL), which can create `-wal` and `-shm` files beside the database while it is
open. Database files are ignored by the project's `.gitignore`.

The `votes` table stores:

| Column | Meaning |
| --- | --- |
| `id` | Integer primary key for the vote |
| `poll_id` | Positive integer Poll Service ID |
| `option_id` | Positive integer option ID returned by the Poll Service |
| `participant_id` | Trimmed anonymous participant ID, 1-100 characters |

A `UNIQUE (poll_id, participant_id)` constraint permits one vote per participant
ID in each poll. SQLite enforces it even when duplicate requests arrive at the
same time. The same participant ID may vote in a different poll.

The Voting Service never opens the Poll Service database. Before inserting a
vote, it requests `GET /polls/:id` from the Poll Service and checks that the poll
exists, is open, and contains the selected option. The poll is checked just
before insertion, but there is no transaction across the two services: a host
could close the poll in the small interval between that check and the insert.

## REST API

Requests and responses use JSON. IDs in a vote request must be JSON numbers
that are positive safe integers, rather than numeric strings.

| Method | Endpoint | Successful result |
| --- | --- | --- |
| GET | `/health` | 200: `{ "status": "ok", "service": "voting-service", "port": 3002 }` |
| POST | `/votes` | 201: `{ "id": 1, "pollId": 1, "optionId": 2 }` |
| GET | `/votes/:pollId/counts` | 200: poll ID, total votes, and counts for every option |
| GET | `/votes/:pollId/total` | 200: `{ "pollId": 1, "totalVotes": 1 }` |

Submit a vote with the poll and option IDs returned by the Poll Service:

```json
{
  "pollId": 1,
  "optionId": 2,
  "participantId": "anonymous-browser-123"
}
```

`participantId` must be a string containing 1-100 characters after trimming
surrounding whitespace, with no NUL character (`\u0000`). IDs are case-sensitive:
`Alice` and `alice` are different participants. Reuse the same anonymous client
ID for later requests so duplicate detection works. This ID identifies the
client for duplicate prevention; it is not an authenticated identity. Vote
responses do not return participant IDs.

The counts response includes options with no votes, in the order returned by
the Poll Service:

```json
{
  "pollId": 1,
  "totalVotes": 1,
  "counts": [
    { "optionId": 1, "text": "JavaScript", "count": 0 },
    { "optionId": 2, "text": "Java", "count": 1 }
  ]
}
```

Both count endpoints consult the Poll Service to confirm the poll exists, so
the Poll Service must be available for these reads as well as for voting.
Counts and totals remain readable after a poll is closed. `/health` checks
that the Voting Service is running without requesting the Poll Service.

## Results notification (Part 4)

After inserting a vote, the service sends `POST /internal/votes` to
`RESULTS_SERVICE_URL` with only `{ "pollId": 1 }`. The Results Service rereads
stored counts and broadcasts a fresh snapshot to that poll's Socket.IO room.

Notification delivery runs without waiting before returning the vote's 201
response. A failed request or two-second timeout is logged; the persisted vote
remains accepted. Rejected and duplicate votes do not trigger a notification.
There is no retry queue. Results can recover missed updates through a fresh GET,
rejoin, reconnect, or the next successful notification. See the
[Results Service guide](../results-service/README.md) for the event contract.

## PowerShell example

With the Poll Service and Voting Service running, use another terminal. This
example creates a new poll and uses its returned IDs; it does not change any
existing poll:

```powershell
$pollServiceUrl = 'http://localhost:3001'
$votingServiceUrl = 'http://localhost:3002'

$pollBody = @{
    question = 'Which language?'
    options = @('JavaScript', 'Java')
} | ConvertTo-Json

$poll = Invoke-RestMethod -Method Post -Uri "$pollServiceUrl/polls" -ContentType 'application/json' -Body $pollBody
$hostToken = $poll.hostToken

# Generate once and reuse for this anonymous participant.
$participantId = [guid]::NewGuid().ToString()
$voteBody = @{
    pollId = $poll.id
    optionId = $poll.options[0].id
    participantId = $participantId
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "$votingServiceUrl/votes" -ContentType 'application/json' -Body $voteBody
Invoke-RestMethod -Uri "$votingServiceUrl/votes/$($poll.id)/counts" | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$votingServiceUrl/votes/$($poll.id)/total"

# Optional: close only the new poll created above, using its saved host token.
$hostHeaders = @{ Authorization = "Bearer $hostToken" }
Invoke-RestMethod -Method Patch -Uri "$pollServiceUrl/polls/$($poll.id)/close" -Headers $hostHeaders
```

The Poll Service returns the host token only when creating the poll, so keep
`$hostToken` if you want to close it later. Submitting `$voteBody` again returns
409 because that participant has already voted (or because the poll is closed
if the optional close command was run).

For a persistence check, keep this terminal open, stop and restart the Voting
Service, and repeat the counts and total requests. The recorded vote should
remain. For an open poll, retrying the same vote after restart should still
return 409. Reads continue to work after the optional close command.

## Error responses

Errors have the shape `{ "error": "Readable explanation." }`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid vote input or poll ID, malformed JSON, or an option that does not belong to the poll |
| 404 | Poll does not exist, or the endpoint is unknown |
| 409 | Poll is closed, or the participant has already voted in that poll |
| 413 | JSON request body exceeds 16 KB |
| 415 | Unsupported JSON charset or content encoding |
| 502 | Poll Service returned an unexpected HTTP response, invalid JSON, or invalid poll data |
| 503 | Poll Service is unavailable or its request timed out |
| 500 | Unexpected server error; internal details are not returned to the client |

Poll Service requests have a fixed three-second timeout that includes reading
the response body. Failed validation and Poll Service requests do not insert a
vote.

## Test coverage

The tests use Node's built-in test runner, real HTTP requests, temporary SQLite
databases, and the actual Poll Service app. Small HTTP stubs exercise failed or
slow Poll Service replies. Coverage includes valid voting, input validation,
missing and closed polls, unrelated options, duplicate and simultaneous votes,
zero-vote options and option order, totals, CORS, malformed and oversized JSON,
upstream failures, and persistence after reopening SQLite and restarting the
app. Tests remove their temporary data afterward.

Part 4 notification tests also check the poll-ID-only payload, rejection paths,
non-blocking responses, and persistence when Results is offline, returns an
error, or times out while sending its response body.

## Part 3 verification record

Verified on November 2, 2026: `npm test` completed with **10 passed, 0 failed**.

A separate verification launched the real `src/index.js` process and restarted
it twice. Votes, grouped counts, totals, and duplicate prevention persisted.
Real Poll Service REST calls accepted valid options and rejected closed polls.
Launching from the project root also preserved service-relative database paths.
All four Voting Service source files passed JavaScript syntax checks.

Port 3002 was occupied during this process check, so verification used an
available temporary port. The default configuration remains port 3002, and the
existing process was left running. Verification used isolated temporary Poll and
Voting databases; the verification processes were stopped and temporary files
removed afterward. No existing poll or vote data was overwritten.

## Part 4 verification record

Verified on November 2, 2026: **16 tests passed, 0 failed**, including all 10
existing Voting tests and 6 new notification tests. The Poll and Results test
suites and the client production build also passed. No dependencies or database
schema changes were needed for notifications.
