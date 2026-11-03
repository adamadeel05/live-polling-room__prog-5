# Run and demonstrate the project - Part 7

Live Polling Room (Slido Lite) is a Programming 5 project with one React client
and exactly three independent Express microservices. This guide runs the
submitted project and demonstrates its existing features.

## Install from a fresh copy

Install Node.js 22.12 or newer and npm, then open a terminal in the project
root, where `client` and `services` are located. Install each application's
dependencies from its own lockfile:

```powershell
npm --prefix client ci
npm --prefix services/poll-service ci
npm --prefix services/voting-service ci
npm --prefix services/results-service ci
```

The default settings work without `.env` files. Each application includes an
`.env.example` for changing its configuration; the [root README](../README.md)
explains those values.

## Choose how to run

For normal development, open four terminals in the project root and run one
command in each. Start all services before using the full interface.

| Application | Command | Default address |
| --- | --- | --- |
| Poll Service | `npm --prefix services/poll-service start` | `http://localhost:3001` |
| Voting Service | `npm --prefix services/voting-service start` | `http://localhost:3002` |
| Results Service | `npm --prefix services/results-service start` | `http://localhost:3003` |
| React client | `npm --prefix client run dev` | `http://localhost:5173` |

Open the client address in a browser. Stop a normal process with Ctrl+C in its
terminal. All three services expose `/health`, for example:

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3002/health
Invoke-RestMethod http://localhost:3003/health
```

For a disposable demonstration, or when normal ports are occupied, use the
isolated preview instead of starting four normal processes:

```powershell
npm --prefix client run preview:integration
```

This starts all four applications on free ports with temporary Poll and Voting
databases. Keep its terminal open and use the printed client URL in every
browser profile. Its addresses differ from the normal defaults above. Existing
processes and normal database files are left alone. Type `stop` into that
terminal when finished to stop its processes and remove its temporary data.

## Short classroom demonstration

1. On the home page, choose **Create poll**. Enter a question such as
   "Which topic should we study next?" and three options: React, Node.js, and
   SQLite. Create the poll and keep the resulting host tab open.
2. Point out the generated six-digit room code and use **Copy room code**.
   In a participant browser, choose **Join poll**, enter that code, select an
   option, and submit. Show the confirmation and the host's updated total,
   Recharts bars, counts, and percentages without refreshing the host page.
3. Use different browser profiles or browser applications for other anonymous
   participants. For example, three participants choosing React, Node.js, and
   Node.js produce counts of 1, 2, and 0, with percentages 33.33%, 66.67%, and 0%.
   Several tabs or windows in one profile share the same participant ID.
4. Reload a participant page or open the same room in another tab of that
   profile. Confirmation remains and the total does not increase. The database
   also rejects a repeated request from the same participant with 409; the
   automated system test checks that rule directly.
5. If demonstrating the restart and reconnect checks below, do them while this
   poll is still open. Then return to the creating host tab, choose **Close
   voting**, and confirm. A new participant joining that code cannot submit a
   vote. Refocusing an existing participant page refreshes its closed status;
   the host's final results remain readable.

For separate participants, use separate profiles rather than clearing anyone's
browser data. Private windows can share one private session and therefore one
participant ID.

## Persistence and reconnect demonstration

Use the isolated preview for these commands. Type them into its open terminal,
and wait for each command's completion message.

| Command | Demonstration |
| --- | --- |
| `restart-poll` | Reload the original host tab: question, room code, options, status, and host controls remain |
| `restart-voting` | Select **Refresh results**: recorded votes and counts remain |
| `stop-results` | Host shows a connection problem; a new participant can still submit a vote |
| `start-results` | Host reconnects automatically and receives current stored counts, including the outage vote |
| `stop` | End the isolated demonstration and clean up its temporary databases |

Normal runs persist data in `services/poll-service/data/polls.db` and
`services/voting-service/data/votes.db`. Polls/options belong to the first
database; votes belong to the second. Restarting those services preserves their
files. The isolated preview uses separate temporary files and retains them
across its restart commands until `stop`.

## Explain the architecture

The React client uses REST to create/read polls, submit votes, close polls, and
request an initial result snapshot. The Poll Service manages questions, ordered
options, six-digit codes, and host-authorized closing. The Voting Service checks
polls through the Poll REST API and stores votes in its own SQLite database.

After accepting a vote, Voting notifies Results. The Results Service reads the
Poll and Voting APIs, calculates percentages, and uses Socket.IO poll rooms to
send complete snapshots to the host. Recharts displays those snapshots; Results
has no database. Each service has its own package manifest and process. See the
[Mermaid architecture diagrams](architecture.md) and [API guide](api.md) for the
request flow and endpoint contracts.

There are no user accounts. The host token authorizes closing and is saved only
in the creating tab's session storage, never in a URL or local storage. The
backend stores its hash and public poll reads do not disclose it. Keep the
creating tab open; if browser storage cannot save host access, refreshing loses
the in-memory fallback.

Anonymous participant IDs and vote receipts use local storage. One ID can vote
once per poll; using a new profile or clearing storage creates a different ID,
so this is duplicate prevention by client identity rather than proof of a
person. Notifications are best-effort: a Results outage does not reject an
accepted vote, and reconnecting or refreshing recovers the stored totals.

## Run the automated checks

From the project root:

```powershell
npm --prefix services/poll-service test
npm --prefix services/voting-service test
npm --prefix services/results-service test
npm --prefix client test
npm --prefix client run build
```

The client command includes the real four-process system tests. To run just
that subset:

```powershell
npm --prefix client run test:integration
```

## Part 7 verification record

Verified on November 3, 2026: **64 tests passed, 0 failed**: Poll 9, Voting 16,
Results 12, and client 27. The production build passed. The checks include the
real four-process workflow, service restarts, and Socket.IO reconnection.
Regression tests also cover unsupported JSON charset/encoding responses and
preserving closed status when a snapshot has an older, lower vote total.

Frontend unit/static-rendering checks and HTTP/Socket.IO tests do not verify
browser clicks or rendered layout. The current Computer Use attempt failed with
`Computer Use native pipe is unavailable: failed to connect native pipe: The system cannot find the file specified. (os error 2)`.
Browser discovery also reported `The browser access host is unavailable`.
Interactive and visual browser checks remain **unverified**. The checklist below
is for manual completion; no item has been marked as passed.

## Final manual browser checklist

- [ ] At 1366 by 768, 390 by 844, and 320 pixels wide, check all screens for
  readable content, usable controls, chart resizing, and horizontal overflow.
- [ ] Create polls with 2, 3, and 4 distinct options; check required-field and
  duplicate-option errors, including long questions and answer text.
- [ ] Join by code, submit a vote, reload to retain confirmation, and verify
  another tab in the same profile cannot add a duplicate vote.
- [ ] With distinct participant profiles, confirm the host's chart, option
  counts, total, and percentages update without refreshing.
- [ ] Close voting from the host tab, confirm the closed state, and check that
  a new participant cannot submit while final results remain readable.
- [ ] Navigate with the keyboard, check visible focus and input labels, confirm
  errors are understandable, and check that the decorative chart adds no empty
  keyboard stop; the text result rows remain available.
- [ ] Reload the host and participant pages, then use the isolated restart and
  Results outage commands above to check persistence and automatic reconnection.

The [integration guide](integration-testing.md) gives the detailed isolated
walkthrough and verification record.
