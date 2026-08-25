# Steem Curation Trial (Auto-Vote Tool)

A high-performance, real-time Steem curation trail dashboard. This tool allows users to seamlessly follow Steem curation trail leaders without surrendering their private keys to a third-party service, by granting posting authority client-side via Steem Keychain or local Active Key signing.

## Features

- **Live Steem Blockchain Streaming**: Streams blocks in real time and automatically dispatches votes on behalf of followers within seconds.
- **Real-time Dashboard**: WebSocket-powered React frontend that pushes live Voting Power and vote logs directly to your screen without heavy API polling.
- **Dual Authentication Modes (Zero-Knowledge)**:
  - **Steem Keychain**: 1-click login and secure posting authority management without ever exposing private keys.
  - **Active Key (Local Sign)**: Grant the bot account `posting` authority to vote seamlessly in the background 24/7. Your Active Key is processed purely client-side in the browser and is never sent to the server.
- **Multiple Trail Support**: Follow multiple trail leaders concurrently. Customize your vote weight (%), time delay (minutes), and minimum Voting Power threshold.
- **Responsive UI**: Clean, modern dark-mode dashboard fully optimized for mobile devices and wide screens.

## Tech Stack

- **Frontend**: React 18, Vite, Lucide Icons, pure CSS modules.
- **Backend**: Node.js, Express, WebSockets (`ws`).
- **Database**: SQLite3 (via `better-sqlite3`) utilizing WAL mode for concurrent read/write speed.
- **Blockchain**: `steem-js` and direct JSON-RPC fetching with automated node failover.

---

## Local Development

### 1. Prerequisites

- Node.js (v18+)
- A Steem bot account and its private posting key.

### 2. Setup

Clone the repository and install dependencies:

```bash
npm install
```

Create a `.env` file in the root directory:

```env
# Server Port
PORT=5000

# Your central voting bot account
BOT_ACCOUNT="your_bot_account_name"

# Private POSTING key for the bot account
BOT_POSTING_KEY="5J..."
```

### 3. Run the App

Start both the frontend Vite server and the Node backend concurrently:

```bash
# Terminal 1: Start the backend server
npm run server

# Terminal 2: Start the frontend development server
npm run dev
```

Visit `http://localhost:3000` in your browser.

---

## Production / Docker Deployment

The application is configured to serve both the backend API/WebSockets and the compiled frontend static files from a single Node container.

### 1. Build the Docker Image

```bash
docker build -t steem-curation-trial .
```

### 2. Run the Container

You can pass your environment variables directly into the container using your `.env` file. Note that we map port `5000` because the Node server hosts both the API and the static React build.

```bash
docker run -d \
  -p 5000:5000 \
  --env-file .env \
  --name curation-trial \
  steem-curation-trial
```

Visit `http://localhost:5000` in your browser to access the live production app.

---

## Architecture Notes

- **Real-Time Data**: The frontend connects to `ws://localhost:5000/ws`. Upon connection, it subscribes to the logged-in username. The backend pushes live user profiles, Voting Power, and vote logs over this socket every 6 seconds to eliminate HTTP polling overhead.
- **Block Streamer**: `server/steemStreamer.js` monitors the tip of the Steem blockchain. If it detects a vote from any watched trail leader, it immediately fans out asynchronous votes to all users following that leader via `voteEngine.js`.
- **Database**: `curation_trial.db` is stored locally in the `/server` directory. In a production Docker environment, you should map this file to a persistent volume to avoid losing user data when the container restarts.
