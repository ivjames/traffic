const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");
const statsEl = document.getElementById("stats");
const controlsEl = document.getElementById("controls");
const scenarioSelect = document.getElementById("scenario");
const runScenarioBtn = document.getElementById("runScenario");
const scenarioStatusEl = document.getElementById("scenarioStatus");

const LANES = 5;
const ROAD_LENGTH = 3200;
const BASE_LANE_HEIGHT = canvas.height / (LANES + 1);
const DT = 0.16;
const MAX_CARS = 520;

const settings = {
  inflow: 0.56,
  desiredSpeed: 33,
  aggressiveness: 0.55,
  reactionTime: 1.1,
  laneDiscipline: 0.6,
  mergePoliteness: 0.5,
  truckFraction: 0.16,
  eventStrength: 0.25,
};

const controlDefs = [
  ["inflow", "Inflow rate", [0.1, 1.3, 0.01], "cars / s / lane"],
  ["desiredSpeed", "Desired speed", [18, 44, 0.5], "m/s"],
  ["aggressiveness", "Aggressiveness", [0.05, 1, 0.01], "0-1"],
  ["reactionTime", "Reaction time", [0.4, 2.2, 0.01], "s"],
  ["laneDiscipline", "Lane discipline", [0, 1, 0.01], "0-1"],
  ["mergePoliteness", "Merge politeness", [0, 1, 0.01], "0-1"],
  ["truckFraction", "Truck share", [0, 0.5, 0.01], "fraction"],
  ["eventStrength", "Bottleneck strength", [0, 1, 0.01], "0-1"],
];

const scenarios = {
  none: {
    label: "Manual only",
    steps: [],
  },
  morning: {
    label: "Morning commute",
    steps: [
      { at: 0, patch: { inflow: 0.67, desiredSpeed: 34, eventStrength: 0.12 }, note: "Demand begins rising." },
      { at: 40, patch: { inflow: 0.92, laneDiscipline: 0.42, eventStrength: 0.3 }, note: "Heavy merge pressure at bottleneck." },
      { at: 90, patch: { inflow: 1.15, reactionTime: 1.24, eventStrength: 0.65 }, note: "Shockwaves form across center lanes." },
      { at: 145, patch: { inflow: 0.74, laneDiscipline: 0.58, eventStrength: 0.25 }, note: "Peak clears, flow starts recovering." },
    ],
  },
  rain: {
    label: "Sudden rain event",
    steps: [
      { at: 0, patch: { inflow: 0.6, desiredSpeed: 33, eventStrength: 0.18 }, note: "Normal dry conditions." },
      { at: 30, patch: { desiredSpeed: 24, reactionTime: 1.75, laneDiscipline: 0.72 }, note: "Rain starts: cautious car-following." },
      { at: 90, patch: { desiredSpeed: 22, eventStrength: 0.52, mergePoliteness: 0.62 }, note: "Visibility drops, queues stretch." },
      { at: 160, patch: { desiredSpeed: 31, reactionTime: 1.2, eventStrength: 0.2 }, note: "Weather clears and flow normalizes." },
    ],
  },
  weekend: {
    label: "Weekend truck wave",
    steps: [
      { at: 0, patch: { inflow: 0.5, truckFraction: 0.18, desiredSpeed: 35 }, note: "Light free-flow traffic." },
      { at: 55, patch: { truckFraction: 0.38, laneDiscipline: 0.36, eventStrength: 0.32 }, note: "Truck platoons enter corridor." },
      { at: 110, patch: { truckFraction: 0.44, inflow: 0.86, reactionTime: 1.3 }, note: "Mixed-flow friction triggers rolling slowdowns." },
      { at: 170, patch: { truckFraction: 0.2, inflow: 0.58, eventStrength: 0.16 }, note: "Truck surge ends; speeds rebound." },
    ],
  },
};

let running = true;
let cars = [];
let simTime = 0;
let nextId = 1;
let activeScenario = "none";
let pendingSteps = [];
let lastScenarioNote = "Manual mode: use sliders or run an auto scenario.";
const controlBindings = new Map();

const fmt = (v, n = 2) => Number(v).toFixed(n);

function buildControls() {
  controlDefs.forEach(([key, label, [min, max, step], units]) => {
    const wrapper = document.createElement("label");
    wrapper.className = "control";

    const header = document.createElement("div");
    header.className = "control-header";
    const title = document.createElement("span");
    title.textContent = label;
    const value = document.createElement("span");
    value.textContent = `${fmt(settings[key])} ${units}`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = settings[key];
    slider.addEventListener("input", () => {
      settings[key] = Number(slider.value);
      value.textContent = `${fmt(settings[key])} ${units}`;
      if (activeScenario !== "none") {
        lastScenarioNote = "Manual override applied while scenario is running.";
      }
    });

    header.append(title, value);
    wrapper.append(header, slider);
    controlsEl.append(wrapper);

    controlBindings.set(key, { slider, value, units });
  });
}

function applySettingsPatch(patch) {
  Object.entries(patch).forEach(([key, val]) => {
    settings[key] = val;
    const binding = controlBindings.get(key);
    if (binding) {
      binding.slider.value = String(val);
      binding.value.textContent = `${fmt(val)} ${binding.units}`;
    }
  });
}

function populateScenarioOptions() {
  Object.entries(scenarios).forEach(([key, config]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = config.label;
    scenarioSelect.append(opt);
  });
}

function queueScenario(name) {
  const selected = scenarios[name] ?? scenarios.none;
  activeScenario = name;
  pendingSteps = selected.steps.map((step) => ({ ...step }));
  lastScenarioNote = selected.steps.length ? `Scenario loaded: ${selected.label}` : "Manual mode active.";
}

function processScenarioSteps() {
  if (activeScenario === "none" || pendingSteps.length === 0) return;

  while (pendingSteps.length > 0 && simTime >= pendingSteps[0].at) {
    const step = pendingSteps.shift();
    applySettingsPatch(step.patch);
    lastScenarioNote = `t=${fmt(simTime, 0)}s: ${step.note}`;
  }

  if (pendingSteps.length === 0 && activeScenario !== "none") {
    lastScenarioNote = `${scenarios[activeScenario].label} complete. Keep tuning manually.`;
    activeScenario = "none";
  }
}

function spawnCar(lane) {
  if (cars.length >= MAX_CARS) return;
  const truck = Math.random() < settings.truckFraction;
  cars.push({
    id: nextId++,
    x: 0,
    lane,
    v: truck ? 22 + Math.random() * 3 : 24 + Math.random() * 9,
    a: 0,
    length: truck ? 16 : 7,
    truck,
    aggressiveness: Math.min(1, Math.max(0.02, settings.aggressiveness + (Math.random() - 0.5) * 0.18)),
    desiredSpeed: settings.desiredSpeed * (truck ? 0.68 : 1) * (0.9 + Math.random() * 0.24),
    reactionTime: settings.reactionTime * (0.82 + Math.random() * 0.35),
    laneBias: (Math.random() - 0.5) * (1 - settings.laneDiscipline),
  });
}

function seedTraffic() {
  cars = [];
  nextId = 1;
  for (let lane = 0; lane < LANES; lane++) {
    const count = 35;
    for (let i = 0; i < count; i++) {
      spawnCar(lane);
      cars[cars.length - 1].x = (i / count) * ROAD_LENGTH + Math.random() * 8;
    }
  }
}

function getLaneCars(lane) {
  return cars.filter((c) => c.lane === lane).sort((a, b) => a.x - b.x);
}

function gapAhead(car, laneCars) {
  const idx = laneCars.findIndex((c) => c.id === car.id);
  const lead = laneCars[(idx + 1) % laneCars.length];
  const dx = lead.x > car.x ? lead.x - car.x : ROAD_LENGTH - car.x + lead.x;
  return { lead, gap: dx - lead.length };
}

function desiredGap(car, dv) {
  const minGap = car.truck ? 4.8 : 2.2;
  return minGap + Math.max(0, car.v * car.reactionTime + (car.v * dv) / (2.2 * Math.sqrt(1.4 * 2.4)));
}

function computeAcceleration(car, laneCars) {
  const { lead, gap } = gapAhead(car, laneCars);
  const dv = car.v - lead.v;
  const sStar = desiredGap(car, dv);
  const eventZone = car.x > ROAD_LENGTH * 0.57 && car.x < ROAD_LENGTH * 0.71;
  const bottleneck = eventZone ? 1 - settings.eventStrength * 0.65 : 1;
  const accelMax = 1.1 + car.aggressiveness * 1.8;
  const comfortableBraking = 1.3 + car.aggressiveness * 1.6;
  const free = 1 - Math.pow(car.v / Math.max(6, car.desiredSpeed * bottleneck), 4);
  const interaction = Math.pow(sStar / Math.max(0.6, gap), 2);
  return accelMax * free - comfortableBraking * interaction;
}

function laneChangeScore(car, targetLane, laneMap) {
  if (targetLane < 0 || targetLane >= LANES) return -Infinity;
  const currentCars = laneMap.get(car.lane);
  const targetCars = laneMap.get(targetLane);
  const aCurrent = computeAcceleration(car, currentCars);
  const aTarget = computeAcceleration(car, targetCars);

  const idxBehind = targetCars.findLastIndex((c) => c.x < car.x);
  const follower = idxBehind >= 0 ? targetCars[idxBehind] : targetCars[targetCars.length - 1];
  if (!follower) return aTarget - aCurrent;

  const before = computeAcceleration(follower, targetCars);
  const virtualLane = [...targetCars, { ...car, lane: targetLane }].sort((a, b) => a.x - b.x);
  const after = computeAcceleration(follower, virtualLane);

  const safety = after > -4.4 ? 0 : -999;
  const courtesy = settings.mergePoliteness * Math.max(0, before - after);
  return aTarget - aCurrent - courtesy + safety + car.laneBias;
}

function maybeSpawnVehicles() {
  for (let lane = 0; lane < LANES; lane++) {
    if (Math.random() < settings.inflow * DT) {
      const laneCars = getLaneCars(lane);
      const hasRoom = laneCars.every((c) => !(c.x < 45 || c.x > ROAD_LENGTH - 45));
      if (hasRoom) spawnCar(lane);
    }
  }
}

function update() {
  simTime += DT;
  processScenarioSteps();
  maybeSpawnVehicles();

  const laneMap = new Map();
  for (let lane = 0; lane < LANES; lane++) {
    laneMap.set(lane, getLaneCars(lane));
  }

  for (const car of cars) {
    if (Math.random() < 0.22) {
      const left = laneChangeScore(car, car.lane - 1, laneMap);
      const right = laneChangeScore(car, car.lane + 1, laneMap);
      const threshold = 0.2 + (1 - car.aggressiveness) * 0.65;
      if (left > right && left > threshold) car.lane -= 1;
      else if (right > threshold) car.lane += 1;
    }
  }

  for (let lane = 0; lane < LANES; lane++) laneMap.set(lane, getLaneCars(lane));

  cars.forEach((car) => {
    const laneCars = laneMap.get(car.lane);
    car.a = computeAcceleration(car, laneCars);
    car.v = Math.max(0, Math.min(48, car.v + car.a * DT));
    car.x = (car.x + car.v * DT + ROAD_LENGTH) % ROAD_LENGTH;
  });
}

function drawRoad() {
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const roadTop = BASE_LANE_HEIGHT * 0.65;
  const roadBottom = BASE_LANE_HEIGHT * (LANES + 0.35);

  ctx.fillStyle = "#111827";
  ctx.fillRect(0, roadTop, canvas.width, roadBottom - roadTop);

  for (let i = 0; i <= LANES; i++) {
    const y = BASE_LANE_HEIGHT * (i + 0.5);
    ctx.strokeStyle = i === 0 || i === LANES ? "#e5e7eb88" : "#94a3b866";
    ctx.setLineDash(i === 0 || i === LANES ? [] : [16, 15]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  const x1 = (ROAD_LENGTH * 0.57 / ROAD_LENGTH) * canvas.width;
  const x2 = (ROAD_LENGTH * 0.71 / ROAD_LENGTH) * canvas.width;
  ctx.fillStyle = `rgba(251, 113, 133, ${0.12 + settings.eventStrength * 0.15})`;
  ctx.fillRect(x1, roadTop, x2 - x1, roadBottom - roadTop);
  ctx.setLineDash([]);
}

function drawCars() {
  cars.forEach((car) => {
    const px = (car.x / ROAD_LENGTH) * canvas.width;
    const laneY = BASE_LANE_HEIGHT * (car.lane + 1);
    const py = laneY - 11;
    const w = (car.length / ROAD_LENGTH) * canvas.width * 5.1;

    const speedRatio = car.v / Math.max(12, car.desiredSpeed);
    const hue = Math.max(0, Math.min(130, speedRatio * 130));
    ctx.fillStyle = car.truck ? `hsl(${hue * 0.4}, 85%, 60%)` : `hsl(${hue}, 80%, 56%)`;
    ctx.fillRect(px - w * 0.5, py, w, 21);
  });
}

function updateStats() {
  const meanSpeed = cars.reduce((sum, c) => sum + c.v, 0) / Math.max(1, cars.length);
  const density = cars.length / (ROAD_LENGTH / 1000);
  const stopAndGo = cars.filter((c) => c.v < 7).length;
  const critical = stopAndGo > cars.length * 0.24;

  statsEl.innerHTML = "";
  const pills = [
    `Cars: ${cars.length}`,
    `Avg speed: ${fmt(meanSpeed * 2.237, 1)} mph`,
    `Density: ${fmt(density, 0)} veh/km`,
    `${stopAndGo} slow vehicles`,
    `Time: ${fmt(simTime, 0)} s`,
  ];

  pills.forEach((text, i) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    if (critical && i === 3) pill.classList.add("warn");
    pill.textContent = text;
    statsEl.append(pill);
  });

  scenarioStatusEl.textContent = lastScenarioNote;
}

function frame() {
  if (running) {
    for (let i = 0; i < 2; i++) update();
  }
  drawRoad();
  drawCars();
  updateStats();
  requestAnimationFrame(frame);
}

document.getElementById("toggleRun").addEventListener("click", (event) => {
  running = !running;
  event.target.textContent = running ? "Pause" : "Resume";
});

document.getElementById("reset").addEventListener("click", () => {
  simTime = 0;
  queueScenario("none");
  seedTraffic();
});

runScenarioBtn.addEventListener("click", () => {
  simTime = 0;
  queueScenario(scenarioSelect.value);
  seedTraffic();
  running = true;
  document.getElementById("toggleRun").textContent = "Pause";
});

buildControls();
populateScenarioOptions();
queueScenario("none");
seedTraffic();
frame();
