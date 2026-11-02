# REST API guide

See the [architecture](architecture.md), [project description](project-description.md),
and detailed [Poll Service](../services/poll-service/README.md) and
[Voting Service](../services/voting-service/README.md) guides.

## Addresses and conventions

| Service | Default base URL | Available functionality |
| --- | --- | --- |
| Poll | `http://localhost:3001` | Health and poll management |
| Voting | `http://localhost:3002` | Health, vote submission, counts, and totals |
| Results | `http://localhost:3003` | Health only |

Each service allows the React client's default origin, `http://localhost:5173`,
through CORS. Service `.env.example` files document configurable ports and origins;
Voting also uses `POLL_SERVICE_URL=http://localhost:3001`.
Send JSON bodies with `Content-Type: application/json`. Poll and Voting request
bodies are limited to 16 KB. Their errors use `{ "error": "Readable explanation." }`.
IDs are positive safe integers. Room codes are six-digit strings from `100000` to
`999999`. The examples below use illustrative values, never actual database data
or host credentials.

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

## Error reference

| Status | Meaning |
| --- | --- |
| 400 | Invalid input, malformed JSON, invalid ID/code, or an option outside the poll |
| 401 | Poll close request lacks a correctly formatted bearer host token |
| 403 | Poll close request contains an incorrect host token |
| 404 | Poll or endpoint does not exist |
| 409 | Poll is closed, host repeats a close, or participant already voted |
| 413 | Poll or Voting JSON request body exceeds 16 KB |
| 415 | Voting request uses an unsupported JSON charset or content encoding |
| 500 | Unexpected internal error; response does not expose internal details |
| 502 | Voting received an unexpected response or invalid data from Poll Service |
| 503 | Poll room-code retry limit reached, or Voting cannot reach Poll Service within its timeout |

## PowerShell walkthrough

Start the Poll and Voting services, then create a poll, submit a vote, inspect
counts, and close the poll using values returned by the APIs:

```powershell
$pollApi = 'http://localhost:3001'
$voteApi = 'http://localhost:3002'
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

$hostHeaders = @{ Authorization = "Bearer $($poll.hostToken)" }
Invoke-RestMethod -Method Patch -Uri "$pollApi/polls/$($poll.id)/close" -Headers $hostHeaders
```

Results Service currently exposes only `/health`. Socket.IO events and a Results
API are not implemented yet; the Voting count endpoints are ordinary REST calls.
