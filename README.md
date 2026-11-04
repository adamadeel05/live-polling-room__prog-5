# Live Polling Room (Slido Lite)

A real-time audience polling application built with React and three independent Node.js microservices. Hosts can create multiple-choice polls, share a six-digit room code, and view live results as participants vote anonymously.

## Features

- Create polls with a question and 2–4 answer options.
- Join a poll using a six-digit room code, without creating an account.
- Submit one vote per browser-generated participant ID per poll.
- View live vote counts and percentages with animated charts.
- Close voting using host-only authorization.
- Preserve polls and votes across service restarts.
- Reconnect to live results automatically after a temporary disconnection.
- Use the responsive interface on desktop and mobile browsers.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, Vite, Tailwind CSS |
| Backend | Node.js, Express.js |
| Data storage | SQLite (`better-sqlite3`) |
| API communication | REST over HTTP |
| Live updates | Socket.IO |
| Charts | Recharts |
| Language | JavaScript |

## Architecture

The application consists of one React client and three independently running backend services.

| Application | Directory | Default port | Responsibility |
| --- | --- | --- | --- |
| React client | `client/` | 5173 | Poll creation, joining, voting, and live results |
| Poll Service | `services/poll-service/` | 3001 | Polls, options, room codes, and closing |
| Voting Service | `services/voting-service/` | 3002 | Vote validation, storage, and duplicate prevention |
| Results Service | `services/results-service/` | 3003 | Results aggregation and real-time broadcasts |

The Poll and Voting services maintain separate SQLite databases. The Voting Service validates polls through the Poll Service API and notifies the Results Service when votes are recorded. The Results Service retrieves current counts and broadcasts updates through Socket.IO.

See [architecture and Mermaid diagrams](docs/architecture.md) for the complete data flow.

## Getting started

**Requirements:** Node.js 22.12 or newer and npm.

### Install dependencies

From the project root:

```bash
npm --prefix client ci
npm --prefix services/poll-service ci
npm --prefix services/voting-service ci
npm --prefix services/results-service ci
```

### Start the application

Run each command in a separate terminal:

```bash
npm --prefix services/poll-service start
```

```bash
npm --prefix services/voting-service start
```

```bash
npm --prefix services/results-service start
```

```bash
npm --prefix client run dev
```

Open **http://localhost:5173** in your browser. The three backend services must be running for poll creation, voting, and live results to work. Stop each process with `Ctrl+C`.

Each backend exposes a health endpoint at `GET /health`, for example `http://localhost:3001/health`.

### Basic usage

1. Select **Create Poll**, enter a question and options, and create a room.
2. Share the generated room code with participants.
3. Participants select **Join Poll**, enter the code, and submit a vote.
4. The host watches the results update automatically and can close voting.

Use different browser profiles to simulate different participants. The host's control token is kept in the creating tab's session storage, so retain that tab while managing the poll.

## Configuration

The default local settings work without additional configuration. Each application includes an `.env.example` file for custom ports and service URLs.

| Setting | Used by |
| --- | --- |
| `PORT`, `CLIENT_ORIGIN` | Backend services |
| `DATABASE_PATH` | Poll and Voting services |
| `POLL_SERVICE_URL`, `RESULTS_SERVICE_URL` | Voting Service |
| `POLL_SERVICE_URL`, `VOTING_SERVICE_URL` | Results Service |
| `VITE_POLL_SERVICE_URL`, `VITE_VOTING_SERVICE_URL`, `VITE_RESULTS_SERVICE_URL` | React client |

The default SQLite files are `services/poll-service/data/polls.db` and `services/voting-service/data/votes.db`. Local database files, dependencies, build outputs, and `.env` files are excluded from Git.

## Tests

Run the automated suites and production build from the project root:

```bash
npm --prefix services/poll-service test
npm --prefix services/voting-service test
npm --prefix services/results-service test
npm --prefix client test
npm --prefix client run build
```

The client tests include real-process integration checks covering voting, duplicate prevention, live updates, reconnection, and persistence.

To start an isolated local preview using temporary databases and automatically selected ports:

```bash
npm --prefix client run preview:integration
```

Open the client URL printed in the terminal. Type `stop` in that terminal to end the preview and clean up its temporary data. See the [integration testing guide](docs/integration-testing.md) for more details.

## Documentation

- [Project overview](docs/project-description.md)
- [Architecture and Mermaid diagrams](docs/architecture.md)
- [REST and Socket.IO API reference](docs/api.md)
- [Integration testing](docs/integration-testing.md)
- [Frontend details](client/README.md)
- [Poll Service](services/poll-service/README.md)
- [Voting Service](services/voting-service/README.md)
- [Results Service](services/results-service/README.md)

## Notes

Duplicate-vote prevention relies on a browser-generated participant ID rather than verified user identity. If a result notification is missed during an outage, refreshing or reconnecting retrieves the latest stored counts. See the API and architecture documentation for implementation details and known limitations.
