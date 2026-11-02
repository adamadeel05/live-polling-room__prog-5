# Poll Service — Part 2

This service creates polls, retrieves them by ID or room code, and lets the host
close them. It uses the existing Express and `better-sqlite3` dependencies.

## Run and test

From this service folder:

```powershell
npm run dev
npm start
npm test
```

Choose either `dev` for automatic source reloads or `start` for normal startup.
Run tests in a separate terminal. From the project root, the test command is:

```powershell
npm --prefix services/poll-service test
```

The default address is `http://localhost:3001`. CORS allows the React client at
`http://localhost:5173`, including its Authorization header and PATCH requests.

## Configuration and storage

The defaults work without a `.env` file. To customize them, copy `.env.example`
to `.env` in this service folder and restart the service:

```dotenv
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
DATABASE_PATH=data/polls.db
```

`DATABASE_PATH` is a file path. Relative paths resolve from the Poll Service
folder, even when startup is launched from another directory. Absolute paths
also work. The service creates the parent directory and tables automatically.
The default database is `services/poll-service/data/polls.db`.

SQLite keeps the data on disk between service restarts. Foreign keys are enabled,
and the database uses write-ahead logging (WAL). SQLite may create `-wal` and
`-shm` files beside the database while it is open. Database files are ignored by
the project's existing `.gitignore`.

| Table | Stored fields |
| --- | --- |
| `polls` | `id`, `question`, unique `room_code`, `status` (`open` or `closed`), `host_token_hash` |
| `poll_options` | `id`, `poll_id` foreign key, `text`, `position` |

Poll creation saves the question and all options in one transaction. Retrieval
returns options in their original order, with stable option IDs for later API
use.

## REST API

All poll responses and errors use JSON. Public poll fields are `id`, `question`,
`roomCode`, `status`, and `options` (each option has `id` and `text`).

| Method | Endpoint | Successful result |
| --- | --- | --- |
| GET | `/health` | 200: `{ "status": "ok", "service": "poll-service", "port": 3001 }` |
| POST | `/polls` | 201: public poll plus its one-time `hostToken`; `Location` points to `/polls/<id>` |
| GET | `/polls/room/:roomCode` | 200: public poll matching the room code |
| GET | `/polls/:id` | 200: public poll matching the ID |
| PATCH | `/polls/:id/close` | 200: public poll with `status: "closed"`; requires the host's bearer token |

Create a poll with one question and an array of 2–4 option strings:

```json
{
  "question": "Which language?",
  "options": ["JavaScript", "Java"]
}
```

The question must contain 1–500 characters and each option 1–200 characters
after trimming surrounding whitespace. Options must be different after trimming
and comparing without case sensitivity. Empty text, non-string values, and
invalid option counts are rejected. Poll IDs must be positive safe integers.

An example creation response is:

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

Room codes are random six-digit strings from `100000` to `999999`. A SQLite
unique constraint prevents duplicate codes. A collision triggers another
attempt, up to 20 attempts. Closed polls keep their codes, so those codes are
not reused.

The host token contains 32 random bytes represented as 64 hexadecimal characters.
Only its SHA-256 hash is stored in SQLite. **Save the token from the creation
response:** it is returned once and there is no token recovery endpoint. GET
responses and close responses never include the token or its hash.

Send the token when closing a poll:

```text
Authorization: Bearer <hostToken>
```

Closed polls remain readable by ID and room code, with `status: "closed"`.
Closing an already closed poll returns 409 after checking the host token.

## PowerShell example

Start the service, then run these commands in another terminal:

```powershell
$baseUrl = 'http://localhost:3001'
$body = @{
    question = 'Which language?'
    options = @('JavaScript', 'Java')
} | ConvertTo-Json

$poll = Invoke-RestMethod -Method Post -Uri "$baseUrl/polls" -ContentType 'application/json' -Body $body

Invoke-RestMethod -Uri "$baseUrl/polls/$($poll.id)"
Invoke-RestMethod -Uri "$baseUrl/polls/room/$($poll.roomCode)"

$hostHeaders = @{ Authorization = "Bearer $($poll.hostToken)" }
Invoke-RestMethod -Method Patch -Uri "$baseUrl/polls/$($poll.id)/close" -Headers $hostHeaders
```

For a restart check, keep this terminal open, stop and restart the service in its
own terminal, then repeat the two GET commands. The question, options, IDs, room
code, and closed status should be unchanged. For an open poll, its saved host
token should still authorize closing it after the restart.

## Error responses

Errors have the shape `{ "error": "Readable explanation." }`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid poll input, malformed JSON, invalid ID, or a room code outside the six-digit format |
| 401 | Missing or malformed `Authorization: Bearer` host token |
| 403 | A correctly formatted token does not match the poll's host |
| 404 | Poll does not exist, or endpoint is unknown |
| 409 | The authorized host tried to close an already closed poll |
| 413 | JSON request body exceeds 16 KB |
| 503 | No available room code was generated within 20 attempts |
| 500 | Unexpected server error; internal details are not returned to the client |

## Test coverage

The automated tests use Node's built-in test runner, real HTTP requests, and
temporary SQLite files. They cover all endpoints, CORS preflight, validation,
malformed and oversized JSON, missing polls, option order, unique room codes,
host authorization, token privacy, and repeated close requests. They also close
and reopen the database and HTTP server to verify that open and closed polls,
option IDs, room codes, and host authority persist. Temporary test data is
removed after each test.

## Part 2 verification results

Verified on November 1, 2026:

- `npm test`: **8 passed, 0 failed**.
- `node --check` passed for `src/app.js`, `src/database.js`, and `src/index.js`.
- A separate check launched the actual `src/index.js` process and restarted it
  twice. Questions, three-option input, option IDs, room codes, open and closed
  status, and the saved host token's authority all persisted.
- The process check launched from the project root and verified that a relative
  `DATABASE_PATH` still resolved from the Poll Service folder.
- Test databases were temporary and removed afterward. Verification processes
  were stopped; no sample polls were added to the normal database.

The sandbox initially blocked the test runner's child process (`spawn EPERM`);
rerunning with process permission passed. Port 3001 was already occupied
(`EADDRINUSE`), so the process check used a free temporary port without stopping
the existing process or changing the default configuration. The verification
script's readiness check was corrected to wait for both startup log lines before
checking the database path; the repeated process check then passed.
