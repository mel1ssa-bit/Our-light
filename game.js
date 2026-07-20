(() => {
  const COLS = 20;
  const ROWS = 20;
  const MAX_LEVEL = 3;
  const GOLDEN_MIN_MS = 10000;
  const GOLDEN_MAX_MS = 20000;
  const GOLDEN_LIVE_MS = 3800;

  // 3 fases: faceis de jogar, cobra inteligente (nao se mata sozinha)
  const LEVELS = {
    1: {
      name: "FACIL",
      startLen: 3,
      snakeTickMs: 240,
      foodRatio: 0.5,
      growEvery: 18,
      aiMistake: 0.1,
      hesitate: 0.04,
    },
    2: {
      name: "MEDIO",
      startLen: 4,
      snakeTickMs: 200,
      foodRatio: 0.55,
      growEvery: 14,
      aiMistake: 0.07,
      hesitate: 0.02,
    },
    3: {
      name: "DESAFIO",
      startLen: 5,
      snakeTickMs: 175,
      foodRatio: 0.6,
      growEvery: 12,
      aiMistake: 0.04,
      hesitate: 0,
    },
  };

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayCard = document.querySelector(".overlay-card");
  const winTrophy = document.getElementById("win-trophy");
  const overlayEyebrow = document.getElementById("overlay-eyebrow");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("start-btn");
  const levelEl = document.getElementById("level");
  const snakeSizeEl = document.getElementById("snake-size");
  const bestEl = document.getElementById("best");
  const hints = document.querySelectorAll(".hint");

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const OPPOSITE = {
    up: "down",
    down: "up",
    left: "right",
    right: "left",
  };

  if (!canvas || !ctx || !startBtn) {
    document.body.innerHTML =
      "<p style='font-family:sans-serif;padding:2rem'>Não foi possível iniciar o jogo. Abra o arquivo <strong>index.html</strong>.</p>";
    return;
  }

  let cell = canvas.width / COLS;
  let state = "menu";
  let level = 1;
  let best = 1;
  try {
    best = Number(localStorage.getItem("fuga-cobra-best") || "1");
  } catch (_) {
    best = 1;
  }
  let snake = [];
  let food = { x: 10, y: 10 };
  let foodDir = null;
  let pendingFoodDir = null;
  let movesUntilGrow = 16;
  let snakeTickMs = 230;
  let foodTickMs = 120;
  let aiMistakeChance = 0.1;
  let hesitateChance = 0.04;
  let lastSnakeTick = 0;
  let lastFoodTick = 0;
  let animId = null;
  let pulse = 0;
  let golden = null;
  let nextGoldenAt = 0;
  let winReason = "crash";

  bestEl.textContent = String(Math.min(best, MAX_LEVEL));

  function key(pos) {
    return `${pos.x},${pos.y}`;
  }

  function inBounds(pos) {
    return pos.x >= 0 && pos.x < COLS && pos.y >= 0 && pos.y < ROWS;
  }

  function same(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function occupiedSet(body, ignoreTail = false) {
    const set = new Set();
    const end = ignoreTail ? body.length - 1 : body.length;
    for (let i = 0; i < end; i += 1) set.add(key(body[i]));
    return set;
  }

  /** BFS: caminho mais curto da cabeça até a comida, evitando o corpo. */
  function findPath(start, goal, body, growing = false) {
    const blocked = occupiedSet(body, !growing);
    const queue = [start];
    const cameFrom = new Map();
    cameFrom.set(key(start), null);
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];
      if (same(current, goal)) break;

      for (const dir of Object.values(DIRS)) {
        const next = { x: current.x + dir.x, y: current.y + dir.y };
        const id = key(next);
        if (!inBounds(next) || cameFrom.has(id) || blocked.has(id)) continue;
        cameFrom.set(id, current);
        queue.push(next);
      }
    }

    if (!cameFrom.has(key(goal))) return null;

    const path = [];
    let cur = goal;
    while (cur && !same(cur, start)) {
      path.push(cur);
      cur = cameFrom.get(key(cur));
    }
    path.reverse();
    return path;
  }

  /** Vizinhos seguros, do mais perto ao mais longe da comida. */
  function rankedSafeSteps(head, goal, body, growing = false) {
    const blocked = occupiedSet(body, !growing);
    const options = [];

    for (const dir of Object.values(DIRS)) {
      const next = { x: head.x + dir.x, y: head.y + dir.y };
      if (!inBounds(next) || blocked.has(key(next))) continue;
      const dist = Math.abs(next.x - goal.x) + Math.abs(next.y - goal.y);
      options.push({ next, dist });
    }

    options.sort((a, b) => a.dist - b.dist);
    return options.map((o) => o.next);
  }

  function nextSnakeHead() {
    const head = snake[0];
    const growing = movesUntilGrow <= 1;
    const path = findPath(head, food, snake, growing);
    const safe = rankedSafeSteps(head, food, snake, growing);

    // Sempre prefere passo seguro. Erro leve = 2ª melhor opção (ainda foge do suicídio).
    if (safe.length === 0) {
      for (const dir of Object.values(DIRS)) {
        return { x: head.x + dir.x, y: head.y + dir.y };
      }
      return head;
    }

    if (path && path.length > 0) {
      const best = path[0];
      if (Math.random() < aiMistakeChance && safe.length > 1) {
        const alt = safe.find((s) => !same(s, best)) || safe[1];
        return alt;
      }
      // Garante que o passo do BFS ainda é seguro neste turno
      if (safe.some((s) => same(s, best))) return best;
    }

    return safe[0];
  }

  function randomSafeCell() {
    const blocked = occupiedSet(snake);
    blocked.add(key(food));
    if (golden) blocked.add(key(golden));
    const free = [];
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (!blocked.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    if (!free.length) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  function scheduleGolden(now = performance.now()) {
    nextGoldenAt =
      now + GOLDEN_MIN_MS + Math.random() * (GOLDEN_MAX_MS - GOLDEN_MIN_MS);
    golden = null;
  }

  function updateGolden(now) {
    if (golden) {
      if (now >= golden.expiresAt) {
        golden = null;
        scheduleGolden(now);
      }
      return;
    }
    if (now >= nextGoldenAt) {
      const spot = randomSafeCell();
      if (spot) {
        golden = {
          x: spot.x,
          y: spot.y,
          expiresAt: now + GOLDEN_LIVE_MS,
        };
      } else {
        scheduleGolden(now);
      }
    }
  }

  function spawnFoodAwayFromSnake() {
    const blocked = occupiedSet(snake);
    const free = [];
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (!blocked.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    const head = snake[0];
    free.sort((a, b) => {
      const da = Math.abs(a.x - head.x) + Math.abs(a.y - head.y);
      const db = Math.abs(b.x - head.x) + Math.abs(b.y - head.y);
      return db - da;
    });
    return free[Math.floor(free.length * 0.15)] || free[0] || { x: 10, y: 10 };
  }

  function resetLevel(lvl) {
    level = Math.min(Math.max(1, lvl), MAX_LEVEL);
    const cfg = LEVELS[level];
    const midY = Math.floor(ROWS / 2);
    snake = [];
    for (let i = 0; i < cfg.startLen; i += 1) {
      snake.push({ x: 2 + i, y: midY });
    }
    snake.reverse();
    food = spawnFoodAwayFromSnake();
    foodDir = null;
    pendingFoodDir = null;
    movesUntilGrow = cfg.growEvery;
    snakeTickMs = cfg.snakeTickMs;
    foodTickMs = cfg.snakeTickMs * cfg.foodRatio;
    aiMistakeChance = cfg.aiMistake;
    hesitateChance = cfg.hesitate;
    winReason = "crash";
    scheduleGolden();
    levelEl.textContent = `${level}/${MAX_LEVEL}`;
    snakeSizeEl.textContent = String(snake.length);
  }

  function showOverlay({ eyebrow, title, text, button, win = false }) {
    overlayEyebrow.textContent = eyebrow;
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startBtn.textContent = button;
    if (overlayCard) overlayCard.classList.toggle("is-win", win);
    if (winTrophy) {
      winTrophy.classList.toggle("hidden", !win);
      winTrophy.setAttribute("aria-hidden", win ? "false" : "true");
    }
    hints.forEach((h) => {
      h.style.display = win ? "none" : "";
    });
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
    if (overlayCard) overlayCard.classList.remove("is-win");
    if (winTrophy) {
      winTrophy.classList.add("hidden");
      winTrophy.setAttribute("aria-hidden", "true");
    }
    hints.forEach((h) => {
      h.style.display = "";
    });
  }

  function winLevel() {
    const cleared = level >= MAX_LEVEL;
    state = cleared ? "cleared" : "won";

    if (level > best) {
      best = level;
      try {
        localStorage.setItem("fuga-cobra-best", String(best));
      } catch (_) {
        /* ignore */
      }
      bestEl.textContent = String(best);
    }

    const how =
      winReason === "golden"
        ? "Voce pegou a maca dourada."
        : "A cobra colidiu.";
    const cfg = LEVELS[level];

    if (cleared) {
      showOverlay({
        eyebrow: "FIM DE JOGO",
        title: "Que bom que voce nao foi comido",
        text: `${how} Voce passou as 3 fases!`,
        button: "► JOGAR DE NOVO",
        win: true,
      });
    } else {
      showOverlay({
        eyebrow: `FASE ${level} · ${cfg.name}`,
        title: "Que bom que voce nao foi comido",
        text: `${how} Proxima: fase ${level + 1} (${LEVELS[level + 1].name}).`,
        button: "► PROXIMA",
        win: true,
      });
    }
  }

  function loseGame() {
    state = "lost";
    showOverlay({
      eyebrow: "GAME OVER",
      title: "TE COMERAM",
      text: `Fase ${level}/${MAX_LEVEL}. Fuja ou pegue a maca dourada pra vencer.`,
      button: "► DE NOVO",
    });
  }

  function moveFood() {
    const dirName = pendingFoodDir || foodDir;
    if (!dirName) return;
    const dir = DIRS[dirName];
    const next = { x: food.x + dir.x, y: food.y + dir.y };
    if (!inBounds(next)) return;
    if (snake.some((s) => same(s, next))) return;
    food = next;
    foodDir = dirName;

    if (golden && same(food, golden)) {
      winReason = "golden";
      golden = null;
      winLevel();
    }
  }

  function moveSnake() {
    // chance da cobra hesitar (mais facil)
    if (Math.random() < hesitateChance) return;

    const nextHead = nextSnakeHead();

    if (!inBounds(nextHead) || snake.some((s) => same(s, nextHead))) {
      winReason = "crash";
      winLevel();
      return;
    }

    snake.unshift(nextHead);

    if (same(nextHead, food)) {
      loseGame();
      return;
    }

    movesUntilGrow -= 1;
    if (movesUntilGrow <= 0) {
      movesUntilGrow = LEVELS[level].growEvery;
    } else {
      snake.pop();
    }

    snakeSizeEl.textContent = String(snake.length);
  }

  function drawGrid() {
    // Fundo xadrez estilo Flash dos anos 2000
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const odd = (x + y) % 2 === 0;
        ctx.fillStyle = odd ? "#2a1420" : "#351828";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // Borda interna pixel
    ctx.fillStyle = "#ff4d9a";
    ctx.fillRect(0, 0, canvas.width, 2);
    ctx.fillRect(0, canvas.height - 2, canvas.width, 2);
    ctx.fillRect(0, 0, 2, canvas.height);
    ctx.fillRect(canvas.width - 2, 0, 2, canvas.height);
  }

  function px(n) {
    return Math.round(n);
  }

  function drawSnake() {
    snake.forEach((seg, i) => {
      const x = px(seg.x * cell);
      const y = px(seg.y * cell);
      const s = px(cell);

      if (i === 0) {
        ctx.fillStyle = "#6bcf8e";
        ctx.fillRect(x, y, s, s);
        ctx.fillStyle = "#a8efc0";
        ctx.fillRect(x + 2, y + 2, s - 4, 3);
        // Olhos pixel
        const dx = Math.sign(food.x - seg.x);
        const dy = Math.sign(food.y - seg.y);
        const ex = x + Math.floor(s / 2) + dx * 2 - 3;
        const ey = y + Math.floor(s / 2) + dy * 2 - 2;
        ctx.fillStyle = "#1a0812";
        ctx.fillRect(ex, ey, 3, 3);
        ctx.fillRect(ex + 5, ey, 3, 3);
        ctx.fillStyle = "#ff4d9a";
        ctx.fillRect(ex + 1 + dx, ey + 1 + dy, 1, 1);
        ctx.fillRect(ex + 6 + dx, ey + 1 + dy, 1, 1);
      } else {
        const shade = i % 2 === 0 ? "#6bcf8e" : "#2f8a55";
        ctx.fillStyle = shade;
        ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
        ctx.fillStyle = "#1a0812";
        ctx.fillRect(x + 1, y + s - 2, s - 2, 1);
        ctx.fillRect(x + s - 2, y + 1, 1, s - 2);
      }
    });
  }

  function drawGolden() {
    if (!golden) return;
    const x = px(golden.x * cell);
    const y = px(golden.y * cell);
    const s = px(cell);
    const left = Math.max(0, golden.expiresAt - performance.now());
    const urgent = left < 1200;
    const blink = Math.floor(pulse / (urgent ? 6 : 10)) % 2 === 0;

    ctx.fillStyle = blink ? "#ffe566" : "#ffc107";
    ctx.fillRect(x + 3, y + 4, s - 6, s - 7);
    ctx.fillStyle = "#fff3b0";
    ctx.fillRect(x + 4, y + 5, 3, 3);
    ctx.fillStyle = "#c49200";
    ctx.fillRect(x + 3, y + s - 4, s - 6, 2);
    ctx.fillStyle = "#6bcf8e";
    ctx.fillRect(x + Math.floor(s / 2) - 1, y + 1, 2, 3);
    // brilho pixel
    if (blink) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 5, y + 6, 2, 2);
    }
  }

  function drawFood() {
    const x = px(food.x * cell);
    const y = px(food.y * cell);
    const s = px(cell);
    const blink = Math.floor(pulse / 12) % 2 === 0;

    ctx.fillStyle = blink ? "#ff79b8" : "#ff4d9a";
    ctx.fillRect(x + 3, y + 4, s - 6, s - 7);
    ctx.fillStyle = "#ffc1dc";
    ctx.fillRect(x + 4, y + 5, 3, 3);
    ctx.fillStyle = "#8b1e4a";
    ctx.fillRect(x + 3, y + s - 4, s - 6, 2);
    ctx.fillStyle = "#6bcf8e";
    ctx.fillRect(x + Math.floor(s / 2) - 1, y + 1, 2, 3);
    ctx.fillStyle = "#2f8a55";
    ctx.fillRect(x + Math.floor(s / 2) + 1, y + 2, 3, 2);
  }

  function draw() {
    ctx.imageSmoothingEnabled = false;
    drawGrid();
    drawSnake();
    drawGolden();
    drawFood();
  }

  function loop(ts) {
    animId = requestAnimationFrame(loop);
    pulse += 1;

    if (state === "playing") {
      updateGolden(ts);
      if (ts - lastFoodTick >= foodTickMs) {
        lastFoodTick = ts;
        moveFood();
      }
      if (state === "playing" && ts - lastSnakeTick >= snakeTickMs) {
        lastSnakeTick = ts;
        moveSnake();
      }
    }

    cell = canvas.width / COLS;
    draw();
  }

  function startGame(fromLevel = 1) {
    resetLevel(fromLevel);
    state = "playing";
    hideOverlay();
    const now = performance.now();
    lastFoodTick = now;
    lastSnakeTick = now;
  }

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      showOverlay({
        eyebrow: "PAUSA",
        title: "PERSEGUICAO OFF",
        text: "A cobra te persegue. Sem saida, ela pode se bater — use isso a seu favor.",
        button: "► CONTINUAR",
      });
    } else if (state === "paused") {
      state = "playing";
      hideOverlay();
      const now = performance.now();
      lastFoodTick = now;
      lastSnakeTick = now;
    }
  }

  function handleDirection(name) {
    if (state !== "playing") return;
    if (foodDir && OPPOSITE[foodDir] === name && pendingFoodDir === null) {
      // Permite reverter (comida não tem "corpo" impedindo)
    }
    pendingFoodDir = name;
    if (!foodDir) foodDir = name;
  }

  const keyMap = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    W: "up",
    s: "down",
    S: "down",
    a: "left",
    A: "left",
    d: "right",
    D: "right",
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (state === "playing" || state === "paused") togglePause();
      return;
    }
    const dir = keyMap[e.key];
    if (!dir) return;
    e.preventDefault();
    handleDirection(dir);
  });

  startBtn.addEventListener("click", () => {
    if (state === "won") {
      startGame(level + 1);
    } else if (state === "cleared") {
      startGame(1);
    } else if (state === "paused") {
      state = "playing";
      hideOverlay();
      const now = performance.now();
      lastFoodTick = now;
      lastSnakeTick = now;
    } else {
      startGame(state === "lost" ? level : 1);
    }
  });

  // Teclado virtual (mobile)
  const pauseBtn = document.getElementById("pause-btn");
  document.querySelectorAll(".dpad-btn[data-dir]").forEach((btn) => {
    const press = (e) => {
      e.preventDefault();
      btn.classList.add("is-pressed");
      handleDirection(btn.dataset.dir);
    };
    const release = () => btn.classList.remove("is-pressed");
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
  });

  if (pauseBtn) {
    pauseBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pauseBtn.classList.add("is-pressed");
      if (state === "playing" || state === "paused") togglePause();
    });
    pauseBtn.addEventListener("pointerup", () => pauseBtn.classList.remove("is-pressed"));
    pauseBtn.addEventListener("pointerleave", () => pauseBtn.classList.remove("is-pressed"));
  }

  // Toque / swipe simples em mobile
  let touchStart = null;
  canvas.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchend",
    (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        handleDirection(dx > 0 ? "right" : "left");
      } else {
        handleDirection(dy > 0 ? "down" : "up");
      }
    },
    { passive: true }
  );

  // Mostra a cobra já na tela inicial (antes de clicar em Começar)
  resetLevel(1);
  state = "menu";
  draw();
  animId = requestAnimationFrame(loop);
})();
