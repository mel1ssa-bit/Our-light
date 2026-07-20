(() => {
  "use strict";

  const SAVE_KEY = "jardim-lento-v2";
  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo");
  const FOCUS_SEC = DEMO ? 15 : 25 * 60;
  const BREAK_SEC = DEMO ? 8 : 5 * 60;

  // Logical pixels — Kindle 10: canvas 320x280 (2x)
  const GW = 160;
  const GH = 140;
  const SCALE = 2;
  const KINDLE = true; // layout/anim tuned for e-ink 600x800
  const AMBIENT_MS = KINDLE ? 2000 : 100; // slow refresh on e-ink
  const TIMER_MS = 1000; // update clock once per second

  const PLANTS = {
    daisy: {
      name: "margarida",
      maxStage: 4,
      stages: ["semente", "broto", "botão", "flor", "flor cheia"],
    },
    succulent: {
      name: "suculenta",
      maxStage: 3,
      stages: ["semente", "folha", "cacho", "plena"],
    },
    mushroom: {
      name: "cogumelo",
      maxStage: 3,
      stages: ["espores", "talinho", "chapéu", "bosque"],
    },
  };

  const REWARDS = [
    {
      id: "bird",
      text: "Um passarinho veio te visitar!",
    },
    {
      id: "snail",
      text: "O caracol saiu pra passear!",
    },
    {
      id: "bug",
      text: "Uma joaninha pousou no vaso!",
    },
  ];

  // LCD grayscale (verde-acinzentado clássico via cinzas)
  const T = {
    ".": null,
    "0": "#e4ebd8", // highlight
    "1": "#c5ceb6", // sky / light
    "2": "#8f9a82", // mid
    "3": "#5a6552", // dark
    "4": "#2a3228", // ink
  };

  const canvas = document.getElementById("garden");
  canvas.width = GW * SCALE;
  canvas.height = GH * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const buf = document.createElement("canvas");
  buf.width = GW;
  buf.height = GH;
  const g = buf.getContext("2d");

  const el = {
    water: document.getElementById("water"),
    cycle: document.getElementById("cycle"),
    total: document.getElementById("total"),
    hint: document.getElementById("hint"),
    event: document.getElementById("event"),
    mood: document.getElementById("mood"),
    timer: document.getElementById("timer"),
    phase: document.getElementById("phase"),
    btnFocus: document.getElementById("btn-focus"),
    btnBreak: document.getElementById("btn-break"),
    btnSkip: document.getElementById("btn-skip"),
    plantBar: document.getElementById("plant-bar"),
    btnReplant: document.getElementById("btn-replant"),
    btnReset: document.getElementById("btn-reset"),
  };

  /** @type {{ plant: string|null, stage: number, water: number, cycle: number, total: number, animalNote: string|null }} */
  let state;
  let mode = "idle"; // idle | focus | break
  let remaining = FOCUS_SEC;
  let tickId = null;
  let eventTimer = null;
  let animId = null;

  // world creatures / sky (not saved — live ambience)
  const world = {
    t: 0,
    cloud1: 18,
    cloud2: 95,
    birdX: -20,
    birdY: 22,
    birdDir: 1,
    birdReward: false,
    snailX: 20,
    snailVisible: false,
    butterflyX: 40,
    butterflyY: 48,
    butterflyOn: false,
    bugOn: false,
    bugReward: false,
    dew: false,
    rewardId: null, // 'bird' | 'snail' | 'bug' | null
    rewardTicks: 0,
  };

  function emptyState() {
    return {
      plant: null,
      stage: 0,
      water: 0,
      cycle: 0,
      total: 0,
      animalNote: null,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return emptyState();
      const data = JSON.parse(raw);
      return { ...emptyState(), ...data };
    } catch {
      return emptyState();
    }
  }

  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function setMood(text) {
    el.mood.textContent = text;
  }

  function showEvent(text) {
    el.event.hidden = false;
    el.event.textContent = text;
    clearTimeout(eventTimer);
    eventTimer = setTimeout(() => {
      el.event.hidden = true;
    }, 5200);
  }

  function updateHud() {
    el.water.textContent = String(state.water);
    el.cycle.textContent = `${state.cycle}/4`;
    el.total.textContent = String(state.total);
    el.timer.textContent = formatTime(remaining);

    if (mode === "focus") {
      el.phase.textContent = "focando · o vaso escuta";
    } else if (mode === "break") {
      el.phase.textContent = "pausa · bichinhos passeiam";
    } else {
      el.phase.textContent = DEMO ? "demo (?demo)" : "pronto pra focar";
    }

    el.btnFocus.disabled = mode === "focus" || mode === "break" || !state.plant;
    el.btnBreak.disabled = mode === "focus" || mode === "break";
    el.btnSkip.hidden = mode !== "focus" && mode !== "break";
    el.plantBar.hidden = !!state.plant;

    if (!state.plant) {
      el.hint.textContent = "Escolha o que plantar no vaso.";
      setMood("um vaso · sem pressa");
    } else if (mode === "idle") {
      const p = PLANTS[state.plant];
      el.hint.textContent = `${p.name} · ${p.stages[state.stage]}. Foque pra crescer, ou use água.`;
    }
  }

  // ——— sprites ———
  const SPR = {
    cloudBig: [
      "................",
      "....000000......",
      "..0000000000....",
      ".000000000000...",
      ".0000000000000..",
      "..00000000000...",
    ],
    cloudSmall: [
      "..........",
      "...0000...",
      ".00000000.",
      ".00000000.",
      "..000000..",
    ],
    sun: [
      "......4......",
      "......4......",
      "...4.000.4...",
      "....00000....",
      "..400000004..",
      "....00000....",
      "...4.000.4...",
      "......4......",
      "......4......",
    ],
    pot: [
      "....33333333....",
      "...3222222223...",
      "..320000000023..",
      "..32........23..",
      "..32.333333.23..",
      "..32.333333.23..",
      "..322222222223..",
      "...3333333333...",
      "....33333333....",
      ".....333333.....",
      "......3333......",
    ],
    seed: [
      "....",
      ".44.",
      ".43.",
      "....",
    ],
    sprout: [
      "......",
      "..33..",
      ".3223.",
      "..33..",
      "..33..",
      "..33..",
    ],
    bud: [
      ".......",
      "..222..",
      ".24442.",
      ".23332.",
      "..333..",
      "...3...",
      "...3...",
    ],
    daisy: [
      ".........",
      "...0.0...",
      "..00400..",
      ".0044400.",
      "..00400..",
      "...0.0...",
      "....3....",
      "....3....",
      "...233...",
    ],
    daisyFull: [
      "...........",
      "..0..0..0..",
      ".0...4...0.",
      "0...444...0",
      ".0.44444.0.",
      "0...444...0",
      ".0...4...0.",
      "..0..0..0..",
      ".....3.....",
      "....333....",
      ".....3.....",
    ],
    succ1: [
      "......",
      "..33..",
      ".3223.",
      ".3333.",
      "..33..",
    ],
    succ2: [
      "........",
      "...33...",
      "..3223..",
      ".322223.",
      "..3333..",
      "...33...",
    ],
    succ3: [
      "..........",
      "....33....",
      "...3223...",
      "..322223..",
      ".32222223.",
      "..333333..",
      "...3333...",
    ],
    mush1: [
      "......",
      "..33..",
      ".3223.",
      "..33..",
      "..33..",
    ],
    mush2: [
      "........",
      "..2222..",
      ".244442.",
      ".222222.",
      "...33...",
      "...33...",
    ],
    mush3: [
      "..........",
      "...2222...",
      "..244442..",
      ".24444442.",
      "..222222..",
      "....33....",
      "....33....",
      "...3333...",
    ],
    bird: [
      "........",
      ".4...4..",
      "..444...",
      "...4.4..",
    ],
    bird2: [
      "........",
      "..4.4...",
      "..444...",
      "...4.4..",
    ],
    snail: [
      ".........",
      "...222...",
      "..24442..",
      "..24242.3",
      ".22222233",
      "..2222...",
    ],
    butterfly: [
      ".........",
      ".0.4.0...",
      "00.4.00..",
      ".0.4.0...",
      "...4.....",
    ],
    butterfly2: [
      ".........",
      "..0.0....",
      ".00.00...",
      "..0.0....",
      "...4.....",
    ],
    bug: [
      "......",
      ".4..4.",
      ".4444.",
      ".4..4.",
    ],
    drop: [
      ".0.",
      "010",
      ".1.",
    ],
    flowerTiny: [
      ".0.",
      "040",
      ".3.",
    ],
    grassTuft: [
      ".3.3",
      "3.3.",
      ".3..",
    ],
  };

  function blit(sprite, ox, oy, flipX) {
    const h = sprite.length;
    const w = sprite[0].length;
    for (let y = 0; y < h; y++) {
      const row = sprite[y];
      for (let x = 0; x < w; x++) {
        const ch = flipX ? row[w - 1 - x] : row[x];
        const c = T[ch];
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }

  function fill(x, y, w, h, tone) {
    g.fillStyle = T[tone];
    g.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  function plantSprite() {
    if (!state.plant) return null;
    const s = state.stage;
    if (state.plant === "daisy") {
      if (s <= 0) return SPR.seed;
      if (s === 1) return SPR.sprout;
      if (s === 2) return SPR.bud;
      if (s === 3) return SPR.daisy;
      return SPR.daisyFull;
    }
    if (state.plant === "succulent") {
      if (s <= 0) return SPR.seed;
      if (s === 1) return SPR.succ1;
      if (s === 2) return SPR.succ2;
      return SPR.succ3;
    }
    // mushroom
    if (s <= 0) return SPR.seed;
    if (s === 1) return SPR.mush1;
    if (s === 2) return SPR.mush2;
    return SPR.mush3;
  }

  function drawScene() {
    // ---- SKY ----
    fill(0, 0, GW, 78, "1");
    fill(0, 0, GW, 28, "0");
    // soft horizon bands
    fill(0, 64, GW, 8, "1");
    fill(0, 70, GW, 8, "2");

    // sun (top-right)
    blit(SPR.sun, 128, 4);

    // fluffy clouds (parallax-ish)
    blit(SPR.cloudBig, Math.floor(world.cloud1), 10);
    blit(SPR.cloudSmall, Math.floor(world.cloud2), 28);
    blit(SPR.cloudSmall, Math.floor(world.cloud1 * 0.5 + 70) % 150 - 10, 8);

    // bird in the sky lane
    const birdSpr = (world.t >> 3) % 2 === 0 ? SPR.bird : SPR.bird2;
    blit(birdSpr, Math.floor(world.birdX), Math.floor(world.birdY), world.birdDir < 0);

    // butterfly in mid-air lane
    if (world.butterflyOn) {
      const bf = (world.t >> 2) % 2 === 0 ? SPR.butterfly : SPR.butterfly2;
      blit(bf, Math.floor(world.butterflyX), Math.floor(world.butterflyY));
    }

    // ---- GROUND ----
    fill(0, 78, GW, GH - 78, "2");
    fill(0, 86, GW, GH - 86, "3");
    // grass edge
    for (let x = 0; x < GW; x += 4) {
      fill(x, 76, 2, 4, "3");
      fill(x + 2, 78, 1, 3, "4");
    }
    // dirt path for animals
    fill(0, 118, GW, 14, "2");
    fill(0, 120, GW, 10, "3");
    for (let x = 4; x < GW; x += 10) {
      fill(x, 122, 5, 2, "2");
    }

    // little wild flowers & tufts (decoration)
    blit(SPR.flowerTiny, 12, 98);
    blit(SPR.flowerTiny, 28, 102);
    blit(SPR.grassTuft, 18, 108);
    blit(SPR.flowerTiny, 132, 100);
    blit(SPR.grassTuft, 140, 106);
    blit(SPR.grassTuft, 8, 112);
    blit(SPR.grassTuft, 148, 112);

    // fence posts far left/right
    for (let i = 0; i < 5; i++) {
      fill(4 + i * 3, 88, 2, 18, "4");
      fill(142 + i * 3, 88, 2, 18, "4");
    }
    fill(4, 90, 14, 2, "4");
    fill(142, 90, 14, 2, "4");

    // ---- HERO POT (center) ----
    const potX = 72;
    const potY = 108;
    const pot = SPR.pot;
    const potW = pot[0].length;
    const potH = pot.length;

    // shadow under pot (grounds it)
    fill(potX + 2, potY - 1, potW - 4, 3, "4");
    fill(potX + 4, potY + 1, potW - 8, 2, "3");

    const plant = plantSprite();
    if (plant) {
      const pw = plant[0].length;
      const ph = plant.length;
      blit(plant, potX + Math.floor((potW - pw) / 2), potY - potH - ph + 4);
    } else {
      // empty hint sparkle
      fill(potX + 7, potY - potH - 6, 2, 2, "0");
      fill(potX + 6, potY - potH - 5, 4, 1, "0");
    }

    blit(pot, potX, potY - potH);

    if (world.dew && state.plant) {
      blit(SPR.drop, potX + potW - 3, potY - potH - 8);
    }

    if ((world.bugOn || world.bugReward) && state.plant) {
      blit(SPR.bug, potX + potW - 2, potY - potH - 10);
    }

    // snail on the animal path
    if (world.snailVisible || mode === "break" || world.rewardId === "snail") {
      blit(SPR.snail, Math.floor(world.snailX), 122);
    }

    // little reward sparkles near active visitor
    if (world.rewardTicks > 0 && world.t % 2 === 0) {
      if (world.rewardId === "bird") {
        fill(Math.floor(world.birdX) + 8, Math.floor(world.birdY) - 3, 2, 2, "0");
      } else if (world.rewardId === "snail") {
        fill(Math.floor(world.snailX) + 4, 118, 2, 2, "0");
      } else if (world.rewardId === "bug") {
        fill(potX + potW + 2, potY - potH - 12, 2, 2, "0");
      }
    }

    // LCD scanline feel (subtle)
    for (let y = 0; y < GH; y += 2) {
      g.fillStyle = "rgba(42,50,40,0.06)";
      g.fillRect(0, y, GW, 1);
    }

    // present
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
  }

  function tickWorld() {
    world.t += 1;
    if (world.rewardTicks > 0) world.rewardTicks -= 1;
    if (world.rewardTicks <= 0 && world.rewardId) {
      world.rewardId = null;
      world.birdReward = false;
      world.bugReward = false;
    }

    // clouds drift slowly (values tuned for 2s tick on Kindle)
    world.cloud1 += 1.2;
    world.cloud2 += 0.8;
    if (world.cloud1 > GW + 10) world.cloud1 = -20;
    if (world.cloud2 > GW + 10) world.cloud2 = -16;

    // bird — during reward: fly across the middle of the sky
    if (world.birdReward || world.rewardId === "bird") {
      world.birdDir = 1;
      world.birdX += 8;
      world.birdY = 20 + Math.sin(world.t / 3) * 4;
      if (world.birdX > GW + 10) world.birdX = -12;
    } else {
      world.birdX += 5 * world.birdDir;
      world.birdY = 18 + Math.sin(world.t / 4) * 3;
      if (world.birdX > GW + 10) {
        world.birdDir = -1;
        world.birdY = 14 + Math.random() * 16;
      }
      if (world.birdX < -16) {
        world.birdDir = 1;
        world.birdY = 14 + Math.random() * 16;
      }
    }

    // butterfly sometimes (ambient only)
    if (world.butterflyOn) {
      world.butterflyX += 6;
      world.butterflyY = 44 + Math.sin(world.t / 2) * 5;
      if (world.butterflyX > GW + 8) world.butterflyOn = false;
    } else if (!world.rewardId && world.t % 12 === 0) {
      world.butterflyOn = true;
      world.butterflyX = -8;
      world.butterflyY = 46;
    }

    // snail — reward or break: clearly creeping on the path
    if (world.rewardId === "snail" || mode === "break") {
      world.snailVisible = true;
      world.snailX += world.rewardId === "snail" ? 5 : 3;
      if (world.snailX > GW) world.snailX = -10;
    } else if (state.plant && world.t % 20 < 10) {
      world.snailVisible = true;
      world.snailX += 2;
      if (world.snailX > GW) world.snailX = -10;
    } else {
      world.snailVisible = false;
    }

    // ladybug — reward sticks on pot; ambient blinks when plant is grown
    if (world.bugReward || world.rewardId === "bug") {
      world.bugOn = true;
    } else {
      world.bugOn = state.plant && state.stage >= 2 && world.t % 10 < 5;
    }

    drawScene();
  }

  function spawnReward(forcedId) {
    const pick = forcedId
      ? REWARDS.find((r) => r.id === forcedId) || REWARDS[0]
      : REWARDS[state.total % REWARDS.length];

    world.rewardId = pick.id;
    world.rewardTicks = 5; // ~10s with 2s ambient ticks
    world.birdReward = pick.id === "bird";
    world.bugReward = pick.id === "bug";

    if (pick.id === "bird") {
      world.birdX = -12;
      world.birdY = 22;
      world.birdDir = 1;
    } else if (pick.id === "snail") {
      world.snailVisible = true;
      world.snailX = 8;
    } else if (pick.id === "bug") {
      world.bugOn = true;
    }

    return pick;
  }

  function startAmbience() {
    stopAmbience();
    animId = setInterval(tickWorld, AMBIENT_MS);
    tickWorld();
  }

  function stopAmbience() {
    if (animId != null) {
      clearInterval(animId);
      animId = null;
    }
  }

  function grow() {
    if (!state.plant) return false;
    const max = PLANTS[state.plant].maxStage;
    if (state.stage >= max) return false;
    state.stage += 1;
    world.dew = true;
    setTimeout(() => {
      world.dew = false;
    }, 4000);
    return true;
  }

  function rewardFocus() {
    state.total += 1;
    state.cycle += 1;

    let growMsg = "";
    if (!state.plant) {
      state.water += 1;
      growMsg = "+1 água. Plante algo no vaso.";
    } else if (grow()) {
      const p = PLANTS[state.plant];
      growMsg = `O foco regou a ${p.name}. Agora: ${p.stages[state.stage]}.`;
      setMood("ela cresceu com você");
    } else {
      state.water += 1;
      growMsg = "Planta plena! +1 água guardada.";
      setMood("vaso feliz");
    }

    // Sempre solta uma recompensa visível: pássaro → caracol → joaninha → …
    const reward = spawnReward();
    showEvent(`${growMsg} ${reward.text}`);

    if (state.cycle >= 4) {
      state.cycle = 0;
      state.water += 1;
      // ciclo completo: os três aparecem juntos um pouquinho
      world.birdReward = true;
      world.birdX = -12;
      world.snailVisible = true;
      world.snailX = 20;
      world.bugReward = true;
      world.bugOn = true;
      world.rewardId = "bird";
      world.rewardTicks = 6;
      setTimeout(() => {
        showEvent("Ciclo completo! +1 água · pássaro, caracol e joaninha vieram juntos!");
      }, 700);
      setMood("festa no jardim");
    }

    save();
    updateHud();
  }

  function startFocus() {
    if (mode !== "idle" || !state.plant) return;
    mode = "focus";
    remaining = FOCUS_SEC;
    world.dew = false;
    setMood("respirando…");
    el.hint.textContent = "Foco rolando. Ao terminar, o vaso cresce.";
    updateHud();
    runTicker();
  }

  function startBreak() {
    if (mode !== "idle") return;
    mode = "break";
    remaining = BREAK_SEC;
    world.snailVisible = true;
    world.snailX = 10;
    setMood("pausa · caracol time");
    showEvent("Pausa! Os bichinhos aproveitam o caminho.");
    updateHud();
    runTicker();
  }

  function endTimer() {
    stopTicker();
    if (mode === "focus") {
      mode = "idle";
      rewardFocus();
      setMood("foco ok · pausa?");
    } else if (mode === "break") {
      mode = "idle";
      showEvent("Pausa acabou. O caracol foi se esconder.");
      setMood("pronto quando quiser");
      save();
    }
    remaining = FOCUS_SEC;
    updateHud();
  }

  function skipTimer() {
    if (mode === "focus") {
      stopTicker();
      mode = "idle";
      remaining = FOCUS_SEC;
      showEvent("Foco pulado — sem cobrança.");
      setMood("sem pressa");
      updateHud();
    } else if (mode === "break") {
      endTimer();
    }
  }

  function runTicker() {
    stopTicker();
    const started = Date.now();
    const total = remaining;
    tickId = setInterval(function () {
      remaining = total - (Date.now() - started) / 1000;
      if (remaining <= 0) {
        remaining = 0;
        updateHud();
        endTimer();
        return;
      }
      updateHud();
    }, TIMER_MS);
    updateHud();
  }

  function stopTicker() {
    if (tickId != null) {
      clearInterval(tickId);
      tickId = null;
    }
  }

  function plantAt(type) {
    if (!PLANTS[type]) return;
    if (state.plant && !confirm("Trocar a planta atual?")) return;
    state.plant = type;
    state.stage = 0;
    world.dew = false;
    showEvent(`Plantou ${PLANTS[type].name}. Foque pra ver crescer.`);
    setMood("semente nova");
    save();
    updateHud();
  }

  function replant() {
    if (!state.plant) {
      showEvent("O vaso já está vazio.");
      return;
    }
    if (!confirm("Remover a planta e escolher outra?")) return;
    state.plant = null;
    state.stage = 0;
    save();
    updateHud();
    showEvent("Vaso limpo. Escolha de novo.");
  }

  function resetAll() {
    if (!confirm("Reset total do jardim?")) return;
    stopTicker();
    mode = "idle";
    remaining = FOCUS_SEC;
    state = emptyState();
    save();
    setMood("do zero");
    showEvent("Tudo limpo.");
    updateHud();
  }

  function onCanvasTap() {
    if (mode !== "idle") {
      showEvent("Durante o timer, só observar.");
      return;
    }
    if (!state.plant) {
      showEvent("Escolha uma semente nos botões abaixo.");
      return;
    }
    if (state.water > 0) {
      const max = PLANTS[state.plant].maxStage;
      if (state.stage < max) {
        state.water -= 1;
        grow();
        showEvent(`Usou 1 água na ${PLANTS[state.plant].name}.`);
        save();
        updateHud();
      } else {
        showEvent("Já está plena. Guarde a água.");
      }
    } else {
      el.hint.textContent = "Sem água. Faça FOCAR 25 pra regar com atenção.";
    }
  }

  canvas.addEventListener("pointerdown", onCanvasTap);
  el.btnFocus.addEventListener("click", startFocus);
  el.btnBreak.addEventListener("click", startBreak);
  el.btnSkip.addEventListener("click", skipTimer);
  el.btnReplant.addEventListener("click", replant);
  el.btnReset.addEventListener("click", resetAll);
  el.plantBar.querySelectorAll("[data-plant]").forEach((btn) => {
    btn.addEventListener("click", () => plantAt(btn.getAttribute("data-plant")));
  });

  state = load();
  if (DEMO) setMood("demo rápida");
  updateHud();
  startAmbience();
})();
