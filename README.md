# Live Polling Room (Slido Lite)

Programming 5 university project. Parts 1-3 set up one React client, three
independent Express services, and persistent Poll and Voting Service APIs. Each
application has its own `package.json` and `package-lock.json`; there are no npm workspaces
or shared server code.

## Project structure

| Path | Contents |
| --- | --- |
| `client/` | React source, Vite/Tailwind configuration, and the static setup page |
| `services/poll-service/` | Poll REST API, SQLite setup, tests, and service guide |
| `services/voting-service/` | Vote REST API, Poll Service client, SQLite setup, tests, and service guide |
| `services/results-service/` | Express health endpoint scaffold for a later part |
| `docs/` | Project description, Mermaid architecture diagrams, and API documentation |
| `.gitignore` | Rules excluding dependencies, local data, secrets, and generated files |

Each application has its own `package.json`, `package-lock.json`, and
`.env.example`. Poll and Voting databases are created locally when the services
start and are excluded from Git.

## Documentation

- [Project description and current scope](docs/project-description.md)
- [Architecture and Mermaid diagrams](docs/architecture.md)
- [REST API documentation](docs/api.md)
- [Detailed Poll Service guide](services/poll-service/README.md)
- [Detailed Voting Service guide](services/voting-service/README.md)

## Requirements and dependencies

Use Node.js 22.12 or newer and npm. Setup was verified with Node.js 24.14.0
and npm 11.11.0.

- Client: React, Vite, Tailwind CSS, Recharts, and `socket.io-client`.
- All services: Express, `cors`, `dotenv`, and `better-sqlite3` (SQLite).
- Results Service also includes the Socket.IO server package.

The Poll Service uses SQLite for polls and options. The Voting Service uses its
own SQLite database for votes and Node's built-in `fetch` for Poll Service REST
requests. Socket.IO and Recharts remain installed for later parts; socket
connections and charts are not implemented yet.
Tailwind uses its Vite plugin, so no separate PostCSS or Tailwind config is needed.

## Install

Install dependencies from the lockfiles by running these commands from the
project root:

```powershell
npm --prefix client ci
npm --prefix services/poll-service ci
npm --prefix services/voting-service ci
npm --prefix services/results-service ci
```

## Start development

Open four terminals in the project root and run one command in each:

| Application | Command | URL |
| --- | --- | --- |
| React client | `npm --prefix client run dev` | http://localhost:5173 |
| Poll Service | `npm --prefix services/poll-service run dev` | http://localhost:3001/health |
| Voting Service | `npm --prefix services/voting-service run dev` | http://localhost:3002/health |
| Results Service | `npm --prefix services/results-service run dev` | http://localhost:3003/health |

Each process runs independently. Stop it with Ctrl+C in its terminal.
Services use Node's built-in watch mode to restart after source changes.
Use `npm --prefix services/<service-name> start` to run a service without watching.

The client shows a static setup page. Its listed ports are configuration details,
not live service status. Vite uses `strictPort`, so it fails clearly if port 5173
is busy instead of silently using another port.

## Environment and CORS

All four applications work with their default settings without `.env` files.
To customize them, copy the corresponding `.env.example` to `.env` in that
application's folder. For example:

```powershell
Copy-Item services/poll-service/.env.example services/poll-service/.env
Copy-Item client/.env.example client/.env
```

Each service accepts `PORT` and `CLIENT_ORIGIN`. Their default ports are 3001,
3002, and 3003; the default allowed browser origin is `http://localhost:5173`.
CORS is configured on every service for that client origin.

The Poll Service also accepts `DATABASE_PATH`, defaulting to `data/polls.db`
inside `services/poll-service/`. SQLite creates the folder, database, and tables
on startup. Polls persist across restarts. See the
[Poll Service API guide](services/poll-service/README.md) for endpoints, examples,
validation rules, and host-token authorization.

The Voting Service uses `DATABASE_PATH=data/votes.db` inside its own folder
and `POLL_SERVICE_URL=http://localhost:3001` to verify polls through REST.
Start the Poll Service before submitting votes or reading vote counts. See the
[Voting Service API guide](services/voting-service/README.md) for configuration,
request examples, and error responses.

The client environment template lists `VITE_POLL_SERVICE_URL`,
`VITE_VOTING_SERVICE_URL`, and `VITE_RESULTS_SERVICE_URL` for later API calls.
The Part 1 page does not make service requests yet. Vite exposes `VITE_` variables
to the browser, so do not put secrets in them. Restart an application after
changing its environment settings.

## Verify

With the four applications running:

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3002/health
Invoke-RestMethod http://localhost:3003/health
(Invoke-WebRequest http://localhost:5173).StatusCode
```

Each health endpoint returns HTTP 200 and JSON such as:

```json
{ "status": "ok", "service": "poll-service", "port": 3001 }
```

Build the client for production:

```powershell
npm --prefix client run build
```

This writes generated assets to the ignored `client/dist/` folder.
For a local build preview, first stop the Vite development server and run
`npm --prefix client run preview` on port 5173.

## Part 1 verification results

Verified on November 1, 2026:

- All four `npm run dev` commands started successfully and responded concurrently
  on ports 5173, 3001, 3002, and 3003.
- Every `/health` returned HTTP 200 with the expected service name, port, and
  `status: "ok"`.
- All three services returned the configured CORS origin and handled OPTIONS
  preflight requests successfully. An unrelated origin was not granted access
  by the response headers.
- Unimplemented `/polls` routes returned 404 in all three services.
- The client returned HTTP 200; Vite transformed its React modules and generated
  Tailwind utility CSS successfully.
- `npm --prefix client run build` passed and produced HTML, CSS, and JavaScript.
- JavaScript syntax checks passed for all service entry points.
- Each installed SQLite driver passed a temporary in-memory `SELECT 1` query.
  No database files or tables were created.
- Each dependency installation completed with zero vulnerabilities reported by npm.

The verification processes were stopped after these checks. Use the development
commands above to start them again.

The initial npm registry check failed with `ECONNREFUSED` because the execution
sandbox restricted network access. Installation succeeded with network permission.
Initial development startup and build attempts also failed with `spawn EPERM`
because the sandbox blocked child processes; Vite additionally reported a
Tailwind native module loading error during that restricted attempt. Rerunning
the same commands with process permission resolved both errors without changing
the dependencies. An initial inline SQLite check lost its quotation marks in
PowerShell; sending the JavaScript through standard input corrected the check.

Setup follows the official [Vite guide](https://vite.dev/guide/),
[Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite),
and [Express starter](https://expressjs.com/en/starter/hello-world/).

## Part 2: Poll Service

The Poll Service supports poll creation with one question and 2-4 choices,
unique six-digit room codes, public retrieval by ID or room code, and host-only
closing. Questions, ordered options with stable IDs, room codes, status, and
host-token hashes are stored in SQLite. The host token is returned only at creation.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/polls` | Create a poll; return its host token once |
| GET | `/polls/room/:roomCode` | Read a public poll by six-digit code |
| GET | `/polls/:id` | Read a public poll by ID |
| PATCH | `/polls/:id/close` | Close a poll with `Authorization: Bearer <hostToken>` |

Closed polls remain readable with `status: "closed"`. Poll details, IDs, and
room codes survive restarts. Validation and errors return JSON.

Run the Poll Service's automated HTTP and SQLite tests from the project root:

```powershell
npm --prefix services/poll-service test
```

See the [Poll Service API guide](services/poll-service/README.md) for request and
response examples, error codes, and database details.

Part 2 verification on November 1, 2026: **8 automated tests passed, 0 failed**.
All service source files also passed JavaScript syntax checks. A separate check
started the real `src/index.js` process and restarted it twice, confirming that
questions, options and their IDs, room codes, status, and host authorization
persist. That check also verified service-relative database paths when launching
from the project root. Verification used isolated temporary databases and ports;
the temporary files and verification process were removed afterward.

The automated test runner initially hit the sandbox's `spawn EPERM` restriction
and passed when run with process permission. Port 3001 was occupied during the
process-restart check (`EADDRINUSE`), so that check used an available temporary
port. Its startup-readiness check was also corrected to wait for both startup
log lines before asserting the database path. The existing process on port 3001
was left running, and the Poll Service's default port remains 3001.

## Part 3: Voting Service

The Voting Service on port 3002 accepts anonymous votes and stores them in its
own SQLite database. It calls `GET /polls/:id` on the Poll Service to check that
the poll exists, is open, and contains the selected option before accepting a
vote. A database `UNIQUE (poll_id, participant_id)` constraint enforces one vote
per participant ID per poll, including simultaneous requests.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/votes` | Submit `{ "pollId": 1, "optionId": 1, "participantId": "participant-1" }` |
| GET | `/votes/:pollId/counts` | Read counts grouped by option, including zero votes, plus the total |
| GET | `/votes/:pollId/total` | Read the total number of votes for a poll |

Poll and option IDs must be positive safe integer numbers. Participant IDs are
case-sensitive strings of 1-100 characters after trimming, without null
characters. Clients should reuse the same anonymous participant ID for duplicate
protection. These identifiers do not introduce user accounts or authentication.

Count endpoints also verify the poll exists through the Poll Service. Closed
polls remain readable, while new votes on them return 409. Missing polls return
404; invalid options return 400; duplicate votes return 409. If the Poll Service
is unavailable or exceeds the three-second request timeout, voting returns 503
without writing a vote. Unexpected upstream responses return 502.

The open-state check and vote insert belong to separate services. A poll can
close after the REST check and before insertion; there is no transaction spanning
both services. This keeps the requested REST integration simple.

Run the integration and persistence tests from the project root:

```powershell
npm --prefix services/voting-service test
```

Tests use temporary databases and the real Poll Service API without changing
existing polls or votes. See the [Voting Service API guide](services/voting-service/README.md)
for examples and storage details.

Part 3 verification on November 2, 2026: **10 automated tests passed, 0 failed**.
The tests cover successful votes, option membership, closed and missing polls,
database-enforced duplicates, simultaneous duplicate requests, grouped counts,
totals, validation, Poll Service failures and timeouts, and persistence. All four
Voting Service source files passed JavaScript syntax checks.

A separate check started the actual Voting Service process and restarted it
twice, confirming that votes, counts, totals, and duplicate protection persist.
It also checked real Poll Service REST integration and service-relative database
paths when starting from the project root. Port 3002 was already occupied, so
this check used a free temporary port. Existing processes and normal databases
were left alone; verification processes and temporary databases were removed.
A file checksum check confirmed that all 21 existing source, configuration, and
documentation files outside the Voting Service and this README were unchanged.
No dependencies were added.

## Scope

Parts 1-3 contain project structure, configured ports and CORS, a static frontend,
service health endpoints, and persistent Poll and Voting Service APIs. The client
and Results Service remain at their Part 1 implementation. Socket.IO events and
live charts are reserved for later parts after approval.
