# LAST STAND

A browser-based 2D multiplayer battle royale built with Phaser, Node.js, Express, and Socket.IO.

## Current playable build

- Create a room and share its five-character room code.
- Join from another browser/device.
- Host starts a match once at least two players are in the room.
- Up to 10 players per room.
- WASD or arrow keys to move; mouse to aim and fire; `R` to reload.
- Mobile movement pad, fire, and reload controls.
- Server-managed movement, ammunition, hits, health, eliminations, and shrinking safe zone.

## Requirements

- Node.js 20+
- npm

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser. For multiplayer testing, open a second browser window or another device on the same network. For other people to connect over the internet, deploy the server to a Node-compatible host and share its URL.

## Deploy to Render

This repository includes `render.yaml`. Create a new Web Service from the GitHub repository and use the Node runtime. Render should detect the blueprint configuration automatically.

## Controls

- `W`, `A`, `S`, `D` or arrow keys: move
- Mouse: aim
- Hold left mouse button: fire
- `R`: reload
- Mobile: on-screen movement, fire, and reload controls

## Notes

This is an early playable build. Matchmaking, combat, and UI should be tested with multiple clients before a public tournament or production launch. No login is required.


### Character visibility fix
The arena camera now centers directly on the local player, and rendering continues while waiting for state packets or after elimination. If the arena still appears blank, check the browser Console (F12) for runtime errors.
