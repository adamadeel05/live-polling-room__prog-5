# Live Polling Room (Slido Lite)

Live Polling Room is a Programming 5 university project written in JavaScript.
Its goal is to let a host create a poll, share a six-digit room code, and collect
anonymous votes while the results update instantly on the host's screen.

## User flow

1. The host creates a question with several answer options.
2. The application generates a six-digit room code for participants.
3. Participants enter the code and vote without creating accounts.
4. The host watches a live results chart and can close the poll.

## Current implementation and documentation: Parts 1-7

The React interface connects persistent REST APIs, a Socket.IO results stream,
and a Recharts results chart. Hosts create and close polls, and participants
join by room code and receive confirmation after voting.

| Component | Implemented behavior |
| --- | --- |
| React client, port 5173 | Home, poll creation, room joining, participant voting, and a live host results screen with chart and text counts |
| Poll Service, port 3001 | Create polls with 2-4 options, generate unique six-digit room codes, retrieve polls, and authorize host-only closing |
| Voting Service, port 3002 | Validate and store anonymous votes, prevent duplicate votes per participant and poll, and return counts and totals |
| Results Service, port 3003 | Aggregate poll results through REST and broadcast fresh snapshots to Socket.IO poll rooms |

Polls, ordered options, room codes, status, and host-token hashes persist in the
Poll Service's SQLite database. Votes persist in a separate Voting Service
database. The Voting Service checks the Poll Service through REST before
accepting votes. All three services expose `GET /health`.

After saving a vote, the Voting Service sends a best-effort notification to the
Results Service. Results are read from the Poll and Voting APIs and broadcast
to subscribers of that poll. Joining or reconnecting retrieves a fresh snapshot.

The project has no user accounts or login system. A host token authorizes
closing a poll. An anonymous participant ID supports duplicate detection; it
does not prove a person's identity.

Host controls are restored from the creating tab's session storage. Anonymous
participant IDs and vote receipts use local storage so they survive reloads.
The interface includes loading, validation, duplicate-vote, closed-poll, and
service-error states, with retry controls for failed requests.

## Technology stack

| Area | Technology |
| --- | --- |
| Frontend | React, Vite, Tailwind CSS |
| Backend | Node.js, Express.js, `cors`, `dotenv` |
| Persistence | SQLite through `better-sqlite3` |
| Service communication | REST over HTTP using Node's built-in `fetch` |
| Live updates | Socket.IO poll rooms and complete result snapshots |
| Charts | Recharts, with visible text counts and percentages alongside the chart |
| Language | JavaScript |

Each application has its own package manifest and lockfile. The services run
as independent processes, with no shared database or shared server code.

## Running and checking the project

Use Node.js 22.12 or newer and npm. Follow the [root README](../README.md) for
installation, the four development commands, configuration, and health checks.
From the project root, useful checks are:

```powershell
npm --prefix services/poll-service test
npm --prefix services/voting-service test
npm --prefix services/results-service test
npm --prefix client test
npm --prefix client run build
```

Part 5 uses the existing backend contracts and installed dependencies. The
responsive interface uses teal, cream, and lime, labelled forms, keyboard
controls, and readable result rows alongside its chart.

Part 6 adds isolated full-system checks using real service processes, a Vite
client, temporary SQLite files, and free ports. Automated HTTP/Socket.IO checks
and manual browser checks are recorded separately in the
[integration guide](integration-testing.md).

Part 7 provides the final [submission and classroom demonstration guide](submission-guide.md):
fresh installation, normal or isolated startup, a host/participant demonstration,
service restart and reconnect checks, and all test/build commands. It documents
the existing application and its verification limits without adding features.

Part 7 verification on November 3, 2026 passed **64 tests, 0 failed**: Poll 9,
Voting 16, Results 12, and client 27. The production build passed. Final review
added regression checks for unsupported JSON charset/encoding errors and closed
status in older snapshots, adjusted decorative-chart keyboard focus, and removed
the unused SQLite dependency from Results.

Interactive browser and rendered-layout checks remain **unverified** because
Computer Use could not connect to its native pipe. The submission guide includes
an unchecked manual checklist for desktop/mobile layout, forms, voting, chart
updates, keyboard access, reloads, and reconnects.

See the [architecture](architecture.md) for service ownership and request flows,
the [API reference](api.md) for endpoint details, and the
[client guide](../client/README.md) for browser routes and storage behavior.
