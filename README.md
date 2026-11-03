# Live Polling Room (Slido Lite)

A Programming 5 university project built with JavaScript, React, Vite, Tailwind
CSS, Express, SQLite, Socket.IO, and Recharts. A host creates one question with
2-4 options, shares a six-digit room code, watches live results, and closes voting.
Participants join anonymously and vote once per browser-generated participant ID.

Parts 1-7 are complete. The final automated run passed **64 tests, 0 failed**,
and the production build. Browser interaction and visual checks remain manual;
see the verification record below.

Repository: [adamadeel05/live-polling-room__prog-5](https://github.com/adamadeel05/live-polling-room__prog-5)

## Architecture and project structure

There are exactly **three independent Express microservices and one React
client**. Each application has its own `package.json`, lockfile, and process.
There is no API gateway, extra service, npm workspace, or shared database.

| Application | Folder | Default port | Responsibility |
| --- | --- | --- | --- |
| React client | `client/` | 5173 | Host and participant screens; Recharts and Socket.IO client |
| Poll Service | `services/poll-service/` | 3001 | Questions, options, room codes, status, and host-authorized closing |
| Voting Service | `services/voting-service/` | 3002 | Validate votes through Poll REST, persist votes, and prevent duplicates |
| Results Service | `services/results-service/` | 3003 | Read Poll/Voting REST APIs and broadcast counts and percentages |

Poll and Voting each own a SQLite database. Results has no database. Voting
notifies Results after accepting a vote; Results rereads stored counts and sends
`results-update` to the host's poll room. Architecture diagrams use
[Mermaid](docs/architecture.md).

## Install

Use Node.js **22.12 or newer** and npm. The final checks used Node.js 24.14.0.
From the project root, install all four applications from their lockfiles:

```powershell
npm --prefix client ci
npm --prefix services/poll-service ci
npm --prefix services/voting-service ci
npm --prefix services/results-service ci
```

The client uses React, Vite, Tailwind CSS, Recharts, and `socket.io-client`.
All services use Express, `cors`, and `dotenv`. Poll and Voting use
`better-sqlite3`; Results uses the Socket.IO server.

## Run

Open four terminals in the project root and run one command in each:

```powershell
npm --prefix services/poll-service start
```

```powershell
npm --prefix services/voting-service start
```

```powershell
npm --prefix services/results-service start
```

```powershell
npm --prefix client run dev
```

Open **http://localhost:5173** after all three services are running. Each service
has a `GET /health` endpoint at its own address, for example
http://localhost:3001/health. Stop each process with Ctrl+C in its terminal.
Services also support `npm --prefix services/<service-name> run dev` for watch mode.

For an isolated classroom demo, one terminal can start the same four applications
on free ports using disposable databases:

```powershell
npm --prefix client run preview:integration
```

Open its printed client URL. Type `stop` into that terminal to stop the preview
and remove its temporary data. Its restart commands and the complete professor
walkthrough are in the [submission guide](docs/submission-guide.md).

## Demonstrate to your professor

1. Create a poll with three options and show the generated room code.
2. Join from another browser profile, vote, and show the host's live chart and total.
3. Use separate profiles for more participants; reloading one participant must not add a vote.
4. Close voting from the original host tab and show that a new participant cannot vote.
5. Use the isolated preview's restart commands to demonstrate persistence and reconnection.

Several tabs in one profile share one participant ID. Keep the creating host tab
open: its host token is stored in that tab's session storage. See the
[full demo and manual browser checklist](docs/submission-guide.md).

## Configuration and saved data

Default settings work without `.env` files. Copy an application's `.env.example`
to `.env` only when customizing it; do not overwrite an existing local file.

Services accept `PORT` and `CLIENT_ORIGIN` (default `http://localhost:5173`).
Poll and Voting accept `DATABASE_PATH`; relative paths resolve from the owning
service's folder. Voting uses `POLL_SERVICE_URL` and `RESULTS_SERVICE_URL`;
Results uses `POLL_SERVICE_URL` and `VOTING_SERVICE_URL`.

The client accepts `VITE_POLL_SERVICE_URL`, `VITE_VOTING_SERVICE_URL`, and
`VITE_RESULTS_SERVICE_URL`. If addresses change, keep service URLs, client URLs,
and CORS origins consistent, then restart the affected applications.

| Owner | Default persistent file |
| --- | --- |
| Poll Service | `services/poll-service/data/polls.db` |
| Voting Service | `services/voting-service/data/votes.db` |

SQLite creates the files and tables on startup. Restarting services preserves
the data. Normal runs and isolated tests use separate database paths.
`.gitignore` excludes SQLite files/journals, dependencies, local environment
files and secrets, builds, caches, and logs. The four `.env.example` files are
committed so a fresh clone can be configured.

## Tests and production build

From the project root:

```powershell
npm --prefix services/poll-service test
npm --prefix services/voting-service test
npm --prefix services/results-service test
npm --prefix client test
npm --prefix client run build
```

The client command includes the four real-process system tests. Run only those
with `npm --prefix client run test:integration`. Tests use temporary databases
and clean up their own processes. The production build is written to `client/dist`.

Final verification on November 3, 2026:

| Suite | Passed | Failed |
| --- | --- | --- |
| Poll Service | 9 | 0 |
| Voting Service | 16 | 0 |
| Results Service | 12 | 0 |
| Client, including system tests | 27 | 0 |
| **Total** | **64** | **0** |

The production build passed. Tests cover creation/code lookup, host-token privacy
and closing, validation, concurrent duplicates, counts/percentages, live updates,
Results outages and automatic reconnects, and actual Poll/Voting process restarts.
Final review fixed unsupported JSON encodings returning 500 instead of 415,
preserved closure from delayed result snapshots, and removed keyboard focus from
the decorative chart. The unused Results SQLite dependency was removed.

## Verification limits

Computer Use could not connect to its native helper (`os error 2`), and browser
discovery reported `The browser access host is unavailable`. React form
interactions, rendered chart sizing, desktop/mobile overflow, and keyboard
behavior remain **unverified in a browser**. Static rendering, CSS source review,
API/Socket.IO tests, and a build are recorded separately from visual checks.
Use the [manual checklist](docs/submission-guide.md#final-manual-browser-checklist)
before presenting.

The project intentionally uses anonymous IDs rather than user accounts. A new
profile or cleared storage creates another ID. Notifications are best-effort;
a reconnect, refresh, or later notification recovers stored totals after a missed
update. Poll closure and vote insertion occur in different services, so a vote
already being validated can race with closing. These limits are explained in
[architecture](docs/architecture.md) and [API documentation](docs/api.md).

## Documentation

- [Run and demonstrate the submitted project](docs/submission-guide.md)
- [Project description and technology choices](docs/project-description.md)
- [Architecture and Mermaid diagrams](docs/architecture.md)
- [REST and Socket.IO API reference](docs/api.md)
- [Integration tests, safe preview, and browser walkthrough](docs/integration-testing.md)
- [Frontend routes and browser storage](client/README.md)
- [Poll Service](services/poll-service/README.md), [Voting Service](services/voting-service/README.md), [Results Service](services/results-service/README.md)
