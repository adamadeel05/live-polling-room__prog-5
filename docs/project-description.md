# Live Polling Room (Slido Lite)

Live Polling Room is a Programming 5 university project written in JavaScript.
Its goal is to let a host create a poll, share a six-digit room code, and collect
anonymous votes while the results update instantly on the host's screen.

## Intended experience

1. The host creates a question with several answer options.
2. The application generates a six-digit room code for participants.
3. Participants enter the code and vote without creating accounts.
4. The host watches a live results chart and can close the poll.

## Current implementation: Parts 1-4

The project provides persistent REST APIs and a Socket.IO results stream.
The React client is a static setup page; it does not yet create polls, join
rooms, submit votes, or display results.

| Component | Implemented behavior |
| --- | --- |
| React client, port 5173 | Static project page and configured service URLs |
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

## Technology stack

| Area | Technology |
| --- | --- |
| Frontend | React, Vite, Tailwind CSS |
| Backend | Node.js, Express.js, `cors`, `dotenv` |
| Persistence | SQLite through `better-sqlite3` |
| Service communication | REST over HTTP using Node's built-in `fetch` |
| Live updates | Socket.IO poll rooms and complete result snapshots |
| Planned charts | Recharts, installed but unused |
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
npm --prefix client run build
```

The next implementation stages will connect the React screens to the APIs and
Socket.IO stream, then add Recharts visualizations. The backend supports live
results; the browser interface and charts remain planned work.

See the [architecture](architecture.md) for service ownership and request flows,
and the [API reference](api.md) for endpoint details.
