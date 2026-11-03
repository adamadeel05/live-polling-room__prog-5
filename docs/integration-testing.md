# System integration checks

The Part 6 harness checks the application across all four processes. Part 7
reruns it alongside the final regression tests. Automated protocol checks and
browser checks are recorded separately.

## Isolated test environment

The helper `client/scripts/test-system.js` exports `startTestSystem`. It starts
the real Poll, Voting, and Results `src/index.js` processes plus the Vite client.
It selects free ports and injects the service URLs, client URLs, CORS origin,
and database paths into those processes.

Poll and Voting use fresh SQLite files in an operating-system temporary folder
named `lpr-system-test-*`. The helper owns its child processes and temporary
files, so stopping the test system cleans up that test environment. It does not
stop existing applications or use their normal databases. No normal browser
storage needs to be cleared.

The production architecture is unchanged. Tests use free ports rather than
requiring 3001, 3002, 3003, and 5173 to be available.

## Automated checks

From the project root:

```powershell
npm --prefix client run test:integration
```

This runs `node --test test/system.test.js`. The normal client command also
includes the system test and runs `test/*.test.js` files one at a time:

```powershell
npm --prefix client test
```

| Scenario | What the automated system check exercises |
| --- | --- |
| Start all applications | Real service entry points, health responses, and the Vite client |
| Create and join | Poll creation, returned IDs/options, and lookup by room code |
| Multiple participants | Distinct anonymous IDs submit votes; results and Socket.IO totals update |
| Duplicate vote | Reusing an ID returns 409 without increasing the stored count |
| Close voting | Host-token close succeeds and a new participant cannot vote afterward |
| Results reconnect | A real Results process restart permits automatic socket reconnection and a fresh snapshot |
| Persistence | Real Poll and Voting process restarts preserve the poll, votes, and duplicate protection |

These checks use HTTP requests and a Socket.IO client. They do not click React
forms, execute browser DOM interactions, or verify rendered chart dimensions.
The separate frontend unit and static-rendering tests cover API helpers,
storage, snapshot handling, and server-rendered React markup. A production build
check verifies bundling; none of those checks replaces browser interaction or
visual checks.

## Start an isolated manual preview

From the project root, keep this terminal open:

```powershell
npm --prefix client run preview:integration
```

The runner prints the actual client URL and three API URLs after startup. Use
that client URL for every browser profile in this walkthrough, rather than the
normal development address. This keeps the frontend connected to the temporary
test databases. The printed ports can differ on every run.

Type these commands into the preview terminal when needed:

| Command | Effect |
| --- | --- |
| `restart-poll` | Restart the test Poll process with the same temporary database |
| `restart-voting` | Restart the test Voting process with the same temporary database |
| `stop-results` | Stop only the test Results process |
| `start-results` | Start the test Results process again on its assigned port |
| `stop` | Stop the test system and remove its temporary files |

Wait for the runner's startup or restart confirmation before continuing. Closing
its input stream or sending a termination signal also cleans up the preview.

## Manual browser walkthrough

1. Open the printed client URL in the host browser. Create a new poll with three
   options, then copy its room code. Keep this creating tab open: its host token
   is saved in that tab's session storage.
2. Open the same client URL as a participant, join with the code, choose an
   answer, and submit. Confirm the participant sees confirmation and the host's
   chart, count rows, and total update without a page refresh.
3. Reload the participant page. Confirmation should remain and the vote total
   should stay unchanged. Open the same room in another tab of the same profile:
   it is the same participant, rather than a new vote opportunity.
4. Use another browser profile or browser application for a second participant.
   Join and choose another answer; check both option counts and the new total.
   Separate windows in one profile share an ID. Private windows can also share
   a private session, so use genuinely separate profiles for distinct IDs.
5. Check an invalid or unknown six-digit code and an unavailable-service retry.
   The UI should show a readable error and allow another attempt.

### Persistence and reconnects

While the poll is still open:

1. Run `restart-poll`, wait for readiness, and reload the host tab. Its room code,
   question, ordered options, and host controls should remain available.
2. Run `restart-voting`, wait for readiness, and select **Refresh results** on the
   host. Counts should remain unchanged; the original participant still sees
   confirmation after reloading.
3. Run `stop-results`. The host should show an interrupted or reconnecting state.
   A new participant in another profile should still be able to vote successfully.
4. Run `start-results` and wait. The host should reconnect automatically and
   display the current stored total, including the vote submitted during the
   outage, without requiring manual refresh.

### Close voting

From the original host tab, select **Close voting**, confirm, and check the
closed state. In a fresh participant profile, join the same code: voting should
be unavailable. Refocus an already open participant page to refresh its status.
Submitting a page that became stale before closure must not add a new vote.
Final results should remain readable.

### Desktop, mobile, and accessibility

Check the browser at 1366 by 768, 390 by 844, and 320 pixels wide:

- Create, join, participant, and host screens fit without horizontal overflow.
- Chart resizing preserves readable counts and option rows.
- Buttons and forms remain usable at small widths; keyboard focus is visible,
  labels identify inputs, and errors and confirmations are understandable.
- Create another temporary poll with a long question and distinct answers up
  to 200 characters. Check wrapping, radio choices, host rows, and chart labels.

Run `stop` in the preview terminal when finished. This walkthrough changes only
the temporary test databases and the browser storage for the printed test origin.

## Part 6 verification record

Verified on November 3, 2026: **62 tests passed, 0 failed**. This includes 8 Poll,
16 Voting, 12 Results, and 26 client tests. The client total comprises 22 existing
unit/static-rendering checks and 4 new real-process system tests. The production
build also passed.

The four-process HTTP and Socket.IO workflow, automatic reconnect, and data
persistence after real process restarts passed. The preview's startup, all restart
commands, explicit stop, and cleanup after piped input ends passed smoke checks.
Test setup corrected timeout options and limited test discovery to test files,
run serially to avoid shared Vite-cache contention. No application bug was reproduced or application
source change required. Historical Part 5 results remain in the
[client guide](../client/README.md).

On November 3, 2026, browser discovery returned no browsers and reported
`The browser access host is unavailable`. The manual browser fallback above is
provided for that limitation. React DOM interaction, desktop/mobile rendering,
horizontal overflow, and rendered Recharts sizing remain **unverified**. A source
CSS review, static React rendering, or successful build is not a browser pass.

## Final review verification (Part 7)

On November 3, 2026, all **64 tests passed, 0 failed**: Poll 9, Voting 16,
Results 12, and client 27. The production build passed. The four real-process
system tests reverified REST connections, live updates, duplicate and closed-poll
rejection, Results reconnection, and SQLite persistence after service restarts.

Regression checks reproduced and fixed Poll requests returning 500 instead of
415 for unsupported JSON encodings, and delayed closed snapshots losing closure
when newer counts were already displayed. The decorative chart no longer adds
a hidden keyboard focus target. Results' unused SQLite dependency was removed.

Computer Use app discovery failed with `Computer Use native pipe is
unavailable: failed to connect native pipe: The system cannot find the file
specified. (os error 2)`. Browser discovery also reported `The browser access host
is unavailable`. No browser interaction or visual check passed during
Part 7. Use the [simple final checklist](submission-guide.md#final-manual-browser-checklist)
and the detailed walkthrough above for desktop, mobile, and chart checks.

See the [root README](../README.md), [architecture](architecture.md), and
[API guide](api.md) for startup commands and application contracts.
