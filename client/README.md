# React client - Parts 5-6

The client provides poll creation, room joining, anonymous voting, and a host
results screen with Recharts and Socket.IO. It uses React, Vite, and Tailwind
with the existing dependencies. Navigation uses URL hashes without a router
package.

## Start and configure

Start all three backend services using the [root README](../README.md), then
run this command from the project root:

```powershell
npm --prefix client run dev
```

Open `http://localhost:5173`. The defaults work without an environment file.
To change service addresses, copy `.env.example` to `.env` in this client folder:

```dotenv
VITE_POLL_SERVICE_URL=http://localhost:3001
VITE_VOTING_SERVICE_URL=http://localhost:3002
VITE_RESULTS_SERVICE_URL=http://localhost:3003
```

Restart Vite after changing `.env`. These values are public browser
configuration; host tokens do not belong in them. HTTP requests have a
ten-second timeout, including the response body. The services allow
`http://localhost:5173` through CORS by
default, so update their `CLIENT_ORIGIN` if using another client origin.

## Screens and routes

| Hash route | Screen |
| --- | --- |
| `#/` | Home with create and join actions |
| `#/create` | Question and 2-4 answer options, with validation |
| `#/join` | Six-digit room-code entry |
| `#/join/<roomCode>` | Poll options, anonymous vote submission, and confirmation |
| `#/host/<pollId>` | Room code, live chart, count rows, refresh, and host-only close control |

For example, a join link looks like
`http://localhost:5173/#/join/483921`. Share the code or join link with
participants and keep the creating tab for the host screen. Invalid codes,
missing polls, closed polls, duplicate votes, and service failures have readable
messages. Forms show loading states and prevent repeated submissions while a
request is running.

## Browser storage

| Storage | Key | Contents |
| --- | --- | --- |
| `sessionStorage` | `lpr.host.<pollId>` | Full poll creation response, including its host token |
| `localStorage` | `lpr.participantId` | Stable anonymous participant ID |
| `localStorage` | `lpr.vote.<pollId>` | Vote receipt used to restore confirmation after reload |

Host controls use the creation response saved for that poll in the same tab.
The token is never placed in the URL or `localStorage`. If saving to session
storage fails, the current page keeps the host response in memory, but a refresh
cannot restore it. Closing the tab ends that tab's host session; keep the
originating tab open to retain its controls.

Participants reuse their saved ID for backend duplicate detection. A stored
receipt restores the confirmation screen after a reload. If the receipt is
missing but the same participant ID is reused, the backend's unique constraint
still rejects a second vote. If local storage is unavailable, the form explains
that storage is required instead of repeatedly creating new identities.
Clearing storage or using another browser creates a different anonymous ID;
these IDs do not authenticate people or create accounts.

An already-voted 409 response restores a confirmation receipt with no selected
option, because the existing vote's choice is not returned by that error.

## Live results and closed polls

The host starts an initial `GET /results/:pollId` request alongside its Socket.IO
connection. It emits `join-poll` on every `connect`, including reconnects, and
consumes `results-update` snapshots. Results with a lower total vote count cannot
replace newer data, and stale snapshots cannot reopen a poll already marked
closed. Manual refresh and retry restart the connection and snapshot request
after a failed request or missed best-effort backend notification. There is no
periodic results polling.

The chart is accompanied by readable option rows with counts and percentages.
The layout responds to smaller screens and includes labelled form controls,
keyboard focus states, and accessible status messages.

The host closes a poll through the existing bearer-token Poll API. There is no
backend close event. Participant pages reread the poll on window focus, when the
document becomes visible, and before voting; a closed-poll 409 response also
marks the poll closed. Closed polls remain readable, and the host can still
inspect results.

## Check the client

From the project root:

```powershell
npm --prefix client test
npm --prefix client run build
```

Client tests use Node's built-in test runner to check API requests and errors,
timeouts, browser storage, and out-of-order snapshot handling. Four static React
rendering tests run through Vite to check homepage links, labelled forms, and
accessible results rows. They do not exercise browser events, effects, layout,
or chart sizing. Part 6 adds real-process HTTP and Socket.IO integration tests,
included in the normal client test command. To run only that suite, or to start
an isolated browser preview:

```powershell
npm --prefix client run test:integration
npm --prefix client run preview:integration
```

The preview prints its own client URL and uses temporary databases and free
ports. Follow the [integration guide](../docs/integration-testing.md) for its
restart commands, browser walkthrough, responsive checks, and measured results.
Part 7 has not started.

See the [API guide](../docs/api.md) and [architecture](../docs/architecture.md)
for unchanged service contracts and the vote-to-results flow.

## Part 5 verification record

Verified on November 3, 2026: **22 client tests passed, 0 failed**; the production
build and all 36 backend tests also passed. Interactive and visual browser checks
were blocked when Computer Use could not confidently identify Chrome's current
URL, so the manual browser steps above remain unverified.

## Part 6 verification record

Verified on November 3, 2026: **26 client tests passed, 0 failed**, including the
4 real-process system tests. All **62 project tests** and the production build
passed. HTTP and Socket.IO checks verified the four-process workflow, reconnect,
and persistence without using normal databases.

Browser discovery reported that its access host was unavailable. React DOM
interaction, responsive rendering, and chart sizing remain **unverified**; use
the [isolated manual walkthrough](../docs/integration-testing.md) for those
checks. Part 7 has not started.
