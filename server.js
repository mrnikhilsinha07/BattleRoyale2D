const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const WIDTH = 1800;
const HEIGHT = 1200;
const MAX_PLAYERS = 10;
const TICK_MS = 50;
const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 240;
const BULLET_SPEED = 760;
const BULLET_RADIUS = 5;
const MAGAZINE_SIZE = 24;
const RELOAD_MS = 1300;
const SHOOT_COOLDOWN_MS = 180;

const OBSTACLES = [
  { x: 260, y: 220, w: 180, h: 90 },
  { x: 590, y: 140, w: 110, h: 210 },
  { x: 920, y: 240, w: 240, h: 80 },
  { x: 1370, y: 160, w: 140, h: 190 },
  { x: 160, y: 540, w: 100, h: 220 },
  { x: 480, y: 720, w: 250, h: 90 },
  { x: 850, y: 540, w: 140, h: 180 },
  { x: 1190, y: 760, w: 210, h: 100 },
  { x: 1510, y: 560, w: 100, h: 210 },
  { x: 760, y: 930, w: 240, h: 70 }
];

const rooms = new Map();
const playerColors = ["#ffca6b", "#7dd3fc", "#f9a8d4", "#a7f3d0", "#c4b5fd", "#fdba74", "#fca5a5", "#bef264", "#93c5fd", "#e9d5ff"];

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function randomSpawn() {
  // Spawn every player well inside the initial safe zone. Previously, random
  // corner spawns could start outside the circle and drain health before players
  // had a chance to see or control their characters.
  const centerX = WIDTH / 2;
  const centerY = HEIGHT / 2;
  const maxSpawnRadius = 500;
  for (let i = 0; i < 160; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * maxSpawnRadius;
    const p = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    };
    if (!OBSTACLES.some(o => circleRect(p.x, p.y, PLAYER_RADIUS + 8, o))) return p;
  }
  return { x: centerX - 70, y: centerY };
}

function circleRect(cx, cy, r, rect) {
  const x = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const y = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return (cx - x) ** 2 + (cy - y) ** 2 < r ** 2;
}

function collidesObstacle(x, y, radius) {
  return OBSTACLES.some(o => circleRect(x, y, radius, o));
}

function roomSummary(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, alive: p.alive, ready: p.ready
    }))
  };
}

function emitRoom(room) {
  io.to(room.code).emit("roomUpdate", roomSummary(room));
}

function removeFromRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.players.delete(socket.id);
  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  if (room.status === "playing" && [...room.players.values()].filter(p => p.alive).length <= 1) {
    finishMatch(room);
  } else {
    emitRoom(room);
  }
}

function finishMatch(room) {
  if (room.status !== "playing") return;
  room.status = "finished";
  const winner = [...room.players.values()].find(p => p.alive);
  io.to(room.code).emit("matchOver", { winner: winner ? { id: winner.id, name: winner.name } : null });
  emitRoom(room);
}

function startMatch(room) {
  if (room.status === "playing") return;
  room.status = "playing";
  room.startedAt = Date.now();
  room.bullets = [];
  room.zone = { x: WIDTH / 2, y: HEIGHT / 2, radius: 820 };
  let i = 0;
  for (const p of room.players.values()) {
    const spawn = randomSpawn();
    p.x = spawn.x;
    p.y = spawn.y;
    p.hp = 100;
    p.alive = true;
    p.ammo = MAGAZINE_SIZE;
    p.reloadingUntil = 0;
    p.lastShot = 0;
    p.input = { up: false, down: false, left: false, right: false, angle: 0 };
    p.color = playerColors[i++ % playerColors.length];
  }
  io.to(room.code).emit("matchStarted", { width: WIDTH, height: HEIGHT, obstacles: OBSTACLES });
  emitRoom(room);
}

app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules", "phaser", "dist")));
app.get("/health", (_req, res) => res.json({ ok: true, game: "LAST STAND" }));

io.on("connection", socket => {
  socket.on("createRoom", payload => {
    removeFromRoom(socket);
    const name = String(payload?.name || "Player").trim().slice(0, 16) || "Player";
    const code = makeCode();
    const room = {
      code, hostId: socket.id, status: "lobby", players: new Map(), bullets: [],
      zone: { x: WIDTH / 2, y: HEIGHT / 2, radius: 820 }, startedAt: 0
    };
    room.players.set(socket.id, {
      id: socket.id, name, color: playerColors[0], alive: true, ready: true,
      x: WIDTH / 2, y: HEIGHT / 2, hp: 100, ammo: MAGAZINE_SIZE,
      reloadingUntil: 0, lastShot: 0,
      input: { up: false, down: false, left: false, right: false, angle: 0 }
    });
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("roomJoined", { code, host: true, summary: roomSummary(room) });
    emitRoom(room);
  });

  socket.on("joinRoom", payload => {
    removeFromRoom(socket);
    const code = String(payload?.code || "").trim().toUpperCase();
    const name = String(payload?.name || "Player").trim().slice(0, 16) || "Player";
    const room = rooms.get(code);
    if (!room) return socket.emit("notice", "Room code not found.");
    if (room.status !== "lobby") return socket.emit("notice", "That match has already started.");
    if (room.players.size >= MAX_PLAYERS) return socket.emit("notice", "This room is full (10 players maximum).");
    room.players.set(socket.id, {
      id: socket.id, name, color: playerColors[room.players.size % playerColors.length],
      alive: true, ready: true, x: WIDTH / 2, y: HEIGHT / 2, hp: 100,
      ammo: MAGAZINE_SIZE, reloadingUntil: 0, lastShot: 0,
      input: { up: false, down: false, left: false, right: false, angle: 0 }
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit("roomJoined", { code, host: false, summary: roomSummary(room) });
    emitRoom(room);
  });

  socket.on("startMatch", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return socket.emit("notice", "Only the room host can start the match.");
    if (room.players.size < 2) return socket.emit("notice", "Invite at least one more player before starting.");
    startMatch(room);
  });

  socket.on("playerInput", input => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!p || room.status !== "playing" || !p.alive) return;
    p.input = {
      up: !!input?.up, down: !!input?.down, left: !!input?.left, right: !!input?.right,
      angle: Number.isFinite(input?.angle) ? input.angle : p.input.angle
    };
  });

  socket.on("shoot", payload => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!p || room.status !== "playing" || !p.alive) return;
    const now = Date.now();
    if (now < p.reloadingUntil || now - p.lastShot < SHOOT_COOLDOWN_MS || p.ammo <= 0) return;
    const angle = Number(payload?.angle);
    if (!Number.isFinite(angle)) return;
    p.lastShot = now;
    p.ammo -= 1;
    room.bullets.push({
      id: `${socket.id}-${now}-${Math.random()}`, ownerId: socket.id,
      x: p.x + Math.cos(angle) * 26, y: p.y + Math.sin(angle) * 26,
      vx: Math.cos(angle) * BULLET_SPEED, vy: Math.sin(angle) * BULLET_SPEED,
      life: 1.25
    });
  });

  socket.on("reload", () => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!p || room.status !== "playing" || !p.alive || p.ammo === MAGAZINE_SIZE || Date.now() < p.reloadingUntil) return;
    p.reloadingUntil = Date.now() + RELOAD_MS;
  });

  socket.on("leaveRoom", () => removeFromRoom(socket));
  socket.on("disconnect", () => removeFromRoom(socket));
});

setInterval(() => {
  const dt = TICK_MS / 1000;
  const now = Date.now();

  for (const room of rooms.values()) {
    if (room.status !== "playing") continue;

    const elapsed = (now - room.startedAt) / 1000;
    const shrink = Math.min(1, elapsed / 150);
    room.zone.radius = 820 - shrink * 700;

    for (const p of room.players.values()) {
      if (!p.alive) continue;
      if (p.reloadingUntil && now >= p.reloadingUntil) {
        p.ammo = MAGAZINE_SIZE;
        p.reloadingUntil = 0;
        io.to(p.id).emit("reloaded");
      }
      let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      dx = dx / len * PLAYER_SPEED * dt;
      dy = dy / len * PLAYER_SPEED * dt;
      const nx = Math.max(PLAYER_RADIUS, Math.min(WIDTH - PLAYER_RADIUS, p.x + dx));
      const ny = Math.max(PLAYER_RADIUS, Math.min(HEIGHT - PLAYER_RADIUS, p.y + dy));
      if (!collidesObstacle(nx, p.y, PLAYER_RADIUS)) p.x = nx;
      if (!collidesObstacle(p.x, ny, PLAYER_RADIUS)) p.y = ny;

      if (Math.hypot(p.x - room.zone.x, p.y - room.zone.y) > room.zone.radius) {
        p.hp -= 8 * dt;
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          io.to(room.code).emit("playerEliminated", { id: p.id, name: p.name, byZone: true });
        }
      }
    }

    const nextBullets = [];
    for (const b of room.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WIDTH || b.y > HEIGHT) continue;
      if (OBSTACLES.some(o => b.x >= o.x && b.x <= o.x + o.w && b.y >= o.y && b.y <= o.y + o.h)) continue;
      let hit = false;
      for (const p of room.players.values()) {
        if (!p.alive || p.id === b.ownerId) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_RADIUS + BULLET_RADIUS) {
          p.hp -= 25;
          hit = true;
          io.to(b.ownerId).emit("hitConfirmed", { targetId: p.id, hp: Math.max(0, p.hp) });
          if (p.hp <= 0) {
            p.hp = 0;
            p.alive = false;
            io.to(room.code).emit("playerEliminated", { id: p.id, name: p.name, by: b.ownerId });
          }
          break;
        }
      }
      if (!hit) nextBullets.push(b);
    }
    room.bullets = nextBullets;

    const alive = [...room.players.values()].filter(p => p.alive);
    if (alive.length <= 1 && room.players.size >= 2) finishMatch(room);

    io.to(room.code).emit("gameState", {
      players: [...room.players.values()].map(p => ({
        id: p.id, name: p.name, x: p.x, y: p.y, hp: p.hp, ammo: p.ammo,
        alive: p.alive, color: p.color, angle: p.input.angle,
        reloading: p.reloadingUntil > now
      })),
      bullets: room.bullets.map(b => ({ id: b.id, x: b.x, y: b.y })),
      zone: room.zone,
      aliveCount: alive.length,
      elapsed
    });
  }
}, TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`LAST STAND server listening on http://localhost:${PORT}`);
});
