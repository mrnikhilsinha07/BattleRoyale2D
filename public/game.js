(() => {
  const socket = io();
  const $ = id => document.getElementById(id);
  const menu = $("menu");
  const lobby = $("lobby");
  const gamePanel = $("gamePanel");
  const resultPanel = $("resultPanel");
  const notice = $("notice");
  const lobbyNotice = $("lobbyNotice");
  const playerNameInput = $("playerName");
  let roomCode = "";
  let isHost = false;
  let latestRoom = null;
  let game = null;
  let localPlayerId = null;
  let latestState = null;
  let matchActive = false;
  let pointerDown = false;
  let lastInputSend = 0;
  let mobileMove = { x: 0, y: 0 };
  let mobileAim = 0;
  let lastShotSent = 0;

  function show(el) { [menu, lobby, gamePanel, resultPanel].forEach(x => x.classList.add("hidden")); el.classList.remove("hidden"); }
  function playerName() { return playerNameInput.value.trim().slice(0, 16) || "Player"; }
  function setNotice(text, error = false) { notice.textContent = text; notice.classList.toggle("error", error); }
  function setLobbyNotice(text, error = false) { lobbyNotice.textContent = text; lobbyNotice.classList.toggle("error", error); }

  $("createBtn").addEventListener("click", () => {
    setNotice("Creating room…");
    socket.emit("createRoom", { name: playerName() });
  });
  $("joinBtn").addEventListener("click", () => {
    const code = $("roomCode").value.trim().toUpperCase();
    if (code.length < 4) return setNotice("Enter the room code your friend shared.", true);
    setNotice("Joining room…");
    socket.emit("joinRoom", { name: playerName(), code });
  });
  $("roomCode").addEventListener("input", e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
  $("copyCodeBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(roomCode); $("copyCodeBtn").textContent = "COPIED"; setTimeout(() => $("copyCodeBtn").textContent = "COPY", 1200); }
    catch { setLobbyNotice(`Share room code: ${roomCode}`); }
  });
  $("startBtn").addEventListener("click", () => socket.emit("startMatch"));
  $("leaveBtn").addEventListener("click", leaveRoom);
  $("quitGameBtn").addEventListener("click", leaveRoom);
  $("backToLobbyBtn").addEventListener("click", () => {
    resultPanel.classList.add("hidden");
    if (latestRoom && latestRoom.status === "lobby") renderLobby(latestRoom);
    else { resetToMenu(); }
  });

  function resetToMenu() {
    if (game) { game.destroy(true); game = null; }
    matchActive = false;
    latestState = null;
    roomCode = "";
    latestRoom = null;
    // Keep localPlayerId: the Socket.IO connection remains open when returning to the menu.
    // Clearing it here made START MATCH disappear when the same tab created another room.
    show(menu);
    setNotice("No downloads. No account. Just play.");
  }

  function leaveRoom() {
    socket.emit("leaveRoom");
    if (game) { game.destroy(true); game = null; }
    matchActive = false;
    resetToMenu();
  }

  socket.on("connect", () => { localPlayerId = socket.id; });
  socket.on("disconnect", () => {
    if (!menu.classList.contains("hidden")) setNotice("Connection lost. Refresh to reconnect.", true);
    else setLobbyNotice("Connection lost. Refresh to reconnect.", true);
  });
  socket.on("notice", message => {
    if (lobby.classList.contains("hidden")) setNotice(message, true);
    else setLobbyNotice(message, true);
  });
  socket.on("roomJoined", data => {
    // A new room can be created on the same socket after leaving a previous match.
    // Restore the current socket ID here so host-only controls render reliably.
    localPlayerId = socket.id;
    roomCode = data.code;
    isHost = data.host;
    latestRoom = data.summary;
    show(lobby);
    renderLobby(latestRoom);
  });
  socket.on("roomUpdate", summary => {
    latestRoom = summary;
    if (!lobby.classList.contains("hidden")) renderLobby(summary);
  });
  socket.on("matchStarted", config => {
    matchActive = true;
    show(gamePanel);
    $("gameRoot").innerHTML = "";
    createGame(config);
  });
  socket.on("gameState", state => {
    latestState = state;
    updateHud(state);
  });
  socket.on("playerEliminated", info => {
    if (info.id === localPlayerId) setGameTip("You were eliminated. Watch the remaining players.");
  });
  socket.on("matchOver", result => {
    matchActive = false;
    $("resultTitle").textContent = result.winner ? (result.winner.id === localPlayerId ? "VICTORY" : "MATCH OVER") : "NO WINNER";
    $("resultText").textContent = result.winner ? `${result.winner.name} is the last player standing.` : "Everyone was eliminated.";
    show(resultPanel);
  });
  socket.on("reloaded", () => {});

  function renderLobby(summary) {
    $("roomCodeDisplay").textContent = summary.code;
    $("playerList").innerHTML = "";
    summary.players.forEach(p => {
      const card = document.createElement("div");
      card.className = "player-card";
      const dot = document.createElement("span");
      dot.className = "player-dot";
      dot.style.background = p.color;
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = p.name;
      const status = document.createElement("small");
      status.textContent = p.alive ? "READY" : "ELIMINATED";
      info.append(name, status);
      card.append(dot, info);
      if (p.id === summary.hostId) {
        const host = document.createElement("span");
        host.className = "host-tag";
        host.textContent = "HOST";
        card.append(host);
      }
      $("playerList").append(card);
    });
    $("startBtn").classList.toggle("hidden", summary.hostId !== localPlayerId);
    $("startBtn").disabled = summary.players.length < 2;
    $("startBtn").style.opacity = summary.players.length < 2 ? ".5" : "1";
    setLobbyNotice(summary.players.length < 2 ? "Waiting for at least one more player to join…" : `${summary.players.length} players ready. Host can start the match.`);
  }

  function setGameTip(text) {
    const tip = document.querySelector(".game-tip");
    if (tip) tip.textContent = text;
  }

  function updateHud(state) {
    $("aliveCount").textContent = state.aliveCount;
    const me = state.players.find(p => p.id === localPlayerId);
    if (me) {
      $("healthValue").textContent = Math.max(0, Math.ceil(me.hp));
      $("ammoValue").textContent = `${me.ammo} / 24${me.reloading ? " · RELOADING" : ""}`;
      $("healthValue").style.color = me.hp <= 30 ? "#ff6b68" : "#edf4f6";
    }
    $("zoneValue").textContent = state.zone.radius < 200 ? "CRITICAL" : `${Math.ceil(state.zone.radius)}m`;
  }

  function createGame(config) {
    const W = config.width;
    const H = config.height;
    const obstacles = config.obstacles;
    const scene = {
      create() {
        this.cameras.main.setBounds(0, 0, W, H);
        this.physics?.world?.setBounds(0, 0, W, H);
        this.add.rectangle(W / 2, H / 2, W, H, 0x233b31).setDepth(-10);
        const grid = this.add.graphics().setDepth(-9);
        grid.lineStyle(1, 0xffffff, 0.035);
        for (let x = 0; x <= W; x += 60) { grid.lineBetween(x, 0, x, H); }
        for (let y = 0; y <= H; y += 60) { grid.lineBetween(0, y, W, y); }
        this.obstacleGraphics = this.add.graphics();
        obstacles.forEach(o => {
          this.obstacleGraphics.fillStyle(0x000000, 0.22);
          this.obstacleGraphics.fillRoundedRect(o.x + 7, o.y + 8, o.w, o.h, 9);
          this.obstacleGraphics.fillStyle(0x52675a, 1);
          this.obstacleGraphics.fillRoundedRect(o.x, o.y, o.w, o.h, 8);
          this.obstacleGraphics.lineStyle(3, 0x809481, 0.7);
          this.obstacleGraphics.strokeRoundedRect(o.x, o.y, o.w, o.h, 8);
          this.obstacleGraphics.fillStyle(0x9aa995, 0.28);
          this.obstacleGraphics.fillRect(o.x + 10, o.y + 10, Math.max(12, o.w - 20), 5);
        });
        this.zoneGraphics = this.add.graphics().setDepth(2);
        this.bulletGraphics = this.add.graphics().setDepth(5);
        this.playersLayer = this.add.container(0, 0).setDepth(4);
        this.playerObjects = new Map();
        this.labelObjects = new Map();
        this.healthObjects = new Map();
        this.input.mouse.disableContextMenu();
        this.cameras.main.setZoom(Math.min(1, (window.innerWidth - 40) / 900));
        // Camera is centered explicitly on the local player in update(). This avoids
        // blank/off-screen arenas caused by following a non-rendering Zone object.
        this.cameras.main.setRoundPixels(true);
        this.keys = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys("W,A,S,D");
        this.input.keyboard.on("keydown-R", () => socket.emit("reload"));
        this.input.on("pointerdown", pointer => { if (pointer.leftButtonDown()) pointerDown = true; });
        this.input.on("pointerup", () => pointerDown = false);
        this.input.on("gameout", () => pointerDown = false);
        this.add.text(18, 18, "LAST STAND  /  LIVE ARENA", { fontFamily: "Arial", fontSize: "13px", color: "#d7e8d7", fontStyle: "bold" }).setScrollFactor(0).setDepth(20);
        this.add.text(W - 18, 18, "STAY INSIDE THE ZONE", { fontFamily: "Arial", fontSize: "11px", color: "#c9f269", fontStyle: "bold" }).setOrigin(1, 0).setScrollFactor(0).setDepth(20);
        this.add.text(W / 2, H / 2, "WAITING FOR PLAYERS…", { fontFamily: "Arial", fontSize: "22px", color: "#d7e8d7", fontStyle: "bold" }).setOrigin(0.5).setAlpha(0.6).setDepth(-5);
      },
      update(time) {
        if (!matchActive) return;
        // Always draw the latest authoritative state, even while the local player
        // is waiting for its first state packet or has been eliminated.
        scene.renderState.call(this);
        const pointer = this.input.activePointer;
        const me = latestState?.players?.find(p => p.id === localPlayerId);
        if (!me) {
          setGameTip("Connecting to arena…");
          return;
        }
        this.cameras.main.centerOn(me.x, me.y);
        if (!me.alive) return;
        const worldPointer = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const angle = Math.atan2(worldPointer.y - me.y, worldPointer.x - me.x);
        const up = this.keys.up.isDown || this.wasd.W.isDown || mobileMove.y < -0.25;
        const down = this.keys.down.isDown || this.wasd.S.isDown || mobileMove.y > 0.25;
        const left = this.keys.left.isDown || this.wasd.A.isDown || mobileMove.x < -0.25;
        const right = this.keys.right.isDown || this.wasd.D.isDown || mobileMove.x > 0.25;
        if (time - lastInputSend > 40) {
          socket.emit("playerInput", { up, down, left, right, angle });
          lastInputSend = time;
        }
        const shouldFire = pointerDown || this.input.activePointer.isDown && this.input.activePointer.leftButtonDown();
        if ((shouldFire || mobileFireHeld) && time - lastShotSent > 150) {
          socket.emit("shoot", { angle: mobileFireHeld ? mobileAim : angle });
          lastShotSent = time;
        }
      },
      renderState() {
        if (!latestState || !Array.isArray(latestState.players)) return;
        this.zoneGraphics.clear();
        const z = latestState.zone;
        this.zoneGraphics.fillStyle(0x7db6ff, 0.055);
        this.zoneGraphics.fillCircle(z.x, z.y, z.radius);
        this.zoneGraphics.lineStyle(5, 0x79b9ff, 0.85);
        this.zoneGraphics.strokeCircle(z.x, z.y, z.radius);
        this.bulletGraphics.clear();
        (latestState.bullets || []).forEach(b => {
          this.bulletGraphics.fillStyle(0xfff0a5, 1);
          this.bulletGraphics.fillCircle(b.x, b.y, 5);
          this.bulletGraphics.fillStyle(0xffb84d, 0.25);
          this.bulletGraphics.fillCircle(b.x, b.y, 10);
        });
        const existing = new Set();
        latestState.players.forEach(p => {
          existing.add(p.id);
          let obj = this.playerObjects.get(p.id);
          if (!obj) {
            const g = this.add.graphics();
            const label = this.add.text(0, 0, p.name, { fontFamily: "Arial", fontSize: "13px", color: "#ffffff", stroke: "#122018", strokeThickness: 4 }).setOrigin(0.5, 1);
            const hp = this.add.graphics();
            obj = { g, label, hp };
            this.playerObjects.set(p.id, obj);
          }
          const { g, label, hp } = obj;
          g.clear();
          if (p.alive) {
            const safeColor = /^#[0-9a-fA-F]{6}$/.test(p.color || "") ? p.color : "#7dd3fc";
            const color = Phaser.Display.Color.HexStringToColor(safeColor).color;
            g.fillStyle(0x000000, 0.25); g.fillCircle(p.x + 2, p.y + 4, 20);
            g.fillStyle(color, 1); g.fillCircle(p.x, p.y, 17);
            g.lineStyle(p.id === localPlayerId ? 3 : 2, p.id === localPlayerId ? 0xc9f269 : 0xf4f5f0, 1);
            g.strokeCircle(p.x, p.y, 17);
            g.lineStyle(7, 0x26343a, 1); g.lineBetween(p.x, p.y, p.x + Math.cos(p.angle) * 28, p.y + Math.sin(p.angle) * 28);
            g.lineStyle(3, 0xb7c7c6, 1); g.lineBetween(p.x, p.y, p.x + Math.cos(p.angle) * 27, p.y + Math.sin(p.angle) * 27);
            hp.clear(); hp.fillStyle(0x101820, 0.9); hp.fillRoundedRect(p.x - 20, p.y - 31, 40, 5, 2);
            hp.fillStyle(p.hp <= 30 ? 0xff6b68 : 0xc9f269, 1); hp.fillRoundedRect(p.x - 20, p.y - 31, 40 * Math.max(0, p.hp) / 100, 5, 2);
            label.setPosition(p.x, p.y - 35).setAlpha(1);
          } else {
            hp.clear();
            label.setPosition(p.x, p.y - 15).setAlpha(0.35).setText(`${p.name} · OUT`);
          }
        });
        for (const [id, obj] of this.playerObjects) {
          if (!existing.has(id)) { obj.g.destroy(); obj.label.destroy(); obj.hp.destroy(); this.playerObjects.delete(id); }
        }
      }
    };

    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "gameRoot",
      width: 960,
      height: 640,
      backgroundColor: "#233b31",
      render: { antialias: true, pixelArt: false },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene,
      input: { activePointers: 3 }
    });
  }

  let mobileFireHeld = false;
  const mobileFire = $("mobileFire");
  mobileFire.addEventListener("pointerdown", e => { e.preventDefault(); mobileFireHeld = true; });
  ["pointerup", "pointercancel", "pointerleave"].forEach(evt => mobileFire.addEventListener(evt, () => mobileFireHeld = false));
  $("mobileReload").addEventListener("click", () => socket.emit("reload"));

  const touchPad = $("touchPad");
  const touchStick = $("touchStick");
  let touchPointerId = null;
  function updateTouch(e) {
    const rect = touchPad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const max = rect.width * 0.32;
    const len = Math.hypot(dx, dy) || 1;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    mobileMove = { x: dx / max, y: dy / max };
    touchStick.style.left = `${rect.width / 2 - 20 + dx}px`;
    touchStick.style.top = `${rect.height / 2 - 20 + dy}px`;
  }
  touchPad.addEventListener("pointerdown", e => { e.preventDefault(); touchPointerId = e.pointerId; touchPad.setPointerCapture(e.pointerId); updateTouch(e); });
  touchPad.addEventListener("pointermove", e => { if (e.pointerId === touchPointerId) updateTouch(e); });
  function resetTouch() { touchPointerId = null; mobileMove = { x: 0, y: 0 }; touchStick.style.left = "33px"; touchStick.style.top = "33px"; }
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(evt => touchPad.addEventListener(evt, resetTouch));

  // On touch devices, aim toward the closest visible opponent.
  function updateMobileAim() {
    if (!latestState) return;
    const me = latestState.players.find(p => p.id === localPlayerId);
    if (!me) return;
    const opponents = latestState.players.filter(p => p.alive && p.id !== localPlayerId);
    if (!opponents.length) return;
    opponents.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    mobileAim = Math.atan2(opponents[0].y - me.y, opponents[0].x - me.x);
  }
  setInterval(() => { if (mobileFireHeld) updateMobileAim(); }, 100);
})();
