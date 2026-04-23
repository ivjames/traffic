const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d");
const statsEl = document.getElementById("stats");
const controlsEl = document.getElementById("controls");

const LANES = 5;
const ROAD_LENGTH = 19600;
const BASE_LANE_HEIGHT = canvas.height / (LANES + 1);
const LANE_HEIGHT_SCALE = 0.7;
const LANE_HEIGHT = BASE_LANE_HEIGHT * LANE_HEIGHT_SCALE;
const DT = 0.12;
const MAX_CARS = 90;
const LANE_VISUAL_BLEND_RATE = 0.12;
const CAR_VISUAL_LENGTH_PX = 20;
const TRUCK_VISUAL_LENGTH_PX = 45;
const ROAD_UNITS_PER_PIXEL = ROAD_LENGTH / canvas.width;
const TRUCK_MIN_LANE = LANES - 2;

const settings = {
  inflow: 0.18,
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

let running = true;
let cars = [];
let simTime = 0;
let nextId = 1;

const fmt = (v, n = 2) => Number(v).toFixed(n);

function getRoadTop() {
  return (canvas.height - LANES * LANE_HEIGHT) * 0.5;
}

function laneBoundaryY(index) {
  return getRoadTop() + index * LANE_HEIGHT;
}

function laneCenterY(lane) {
  return getRoadTop() + (lane + 0.5) * LANE_HEIGHT;
}

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
    });

    header.append(title, value);
    wrapper.append(header, slider);
    controlsEl.append(wrapper);
  });
}

function spawnCar(lane, truckOverride = null) {
  if (cars.length >= MAX_CARS) return;
  const requestedTruck = truckOverride === null ? Math.random() < settings.truckFraction : truckOverride;
  const truck = requestedTruck && lane >= TRUCK_MIN_LANE;
  const visualLengthPx = truck ? TRUCK_VISUAL_LENGTH_PX : CAR_VISUAL_LENGTH_PX;
  const desiredSpeedFactor = truck ? 0.55 + Math.random() * 0.38 : 0.72 + Math.random() * 0.62;
  const initialSpeed = truck ? 16 + Math.random() * 10 : 18 + Math.random() * 18;
  cars.push({
    id: nextId++,
    x: 0,
    lane,
    laneVisual: lane,
    v: initialSpeed,
    a: 0,
    // Collision length matches marker length to avoid visual overlap.
    length: visualLengthPx * ROAD_UNITS_PER_PIXEL,
    visualLengthPx,
    truck,
    preferredGap: visualLengthPx * ROAD_UNITS_PER_PIXEL * (1 + Math.random() * 2),
    aggressiveness: Math.min(1, Math.max(0.02, settings.aggressiveness + (Math.random() - 0.5) * 0.3)),
    desiredSpeed: settings.desiredSpeed * desiredSpeedFactor,
    reactionTime: settings.reactionTime * (0.7 + Math.random() * 0.7),
    laneBias: (Math.random() - 0.5) * (1 - settings.laneDiscipline),
  });
}

function seedTraffic() {
  cars = [];
  nextId = 1;
  for (let lane = 0; lane < LANES; lane++) {
    const count = 7;
    for (let i = 0; i < count; i++) {
      spawnCar(lane);
      cars[cars.length - 1].x = (i / count) * ROAD_LENGTH + Math.random() * 8;
      cars[cars.length - 1].laneVisual = lane;
    }
  }
}

function getLaneCars(lane) {
  return cars.filter((c) => c.lane === lane).sort((a, b) => a.x - b.x);
}

function forwardDistance(xFrom, xTo) {
  return xTo >= xFrom ? xTo - xFrom : ROAD_LENGTH - xFrom + xTo;
}

function centerGap(rearX, rearLength, frontX, frontLength) {
  return forwardDistance(rearX, frontX) - (rearLength + frontLength) * 0.5;
}

function gapsAroundPosition(laneCars, x, length) {
  if (laneCars.length === 0) {
    return { gapAhead: Infinity, gapBehind: Infinity };
  }

  const front = laneCars.find((c) => c.x > x) ?? null;
  let rear = null;
  for (let i = laneCars.length - 1; i >= 0; i--) {
    if (laneCars[i].x < x) {
      rear = laneCars[i];
      break;
    }
  }

  return {
    gapAhead: front ? centerGap(x, length, front.x, front.length) : Infinity,
    gapBehind: rear ? centerGap(rear.x, rear.length, x, length) : Infinity,
  };
}

function leadInOpenLane(laneCars, x) {
  return laneCars.find((c) => c.x > x) ?? null;
}

function canSpawnAtStart(lane, length) {
  const laneCars = getLaneCars(lane);
  if (laneCars.length === 0) return true;

  const lead = leadInOpenLane(laneCars, 0);
  if (!lead) return true;

  const gap = centerGap(0, length, lead.x, lead.length);
  return gap > 8;
}

function gapAhead(car, laneCars) {
  if (laneCars.length === 0) {
    return { lead: car, gap: ROAD_LENGTH };
  }

  const idx = laneCars.findIndex((c) => c.id === car.id);
  if (idx === -1) {
    // During lane-change evaluation, the car may be assessed in a lane it is not yet part of.
    const lead = leadInOpenLane(laneCars, car.x);
    if (!lead) return { lead: car, gap: ROAD_LENGTH };
    return { lead, gap: centerGap(car.x, car.length, lead.x, lead.length) };
  }

  const lead = laneCars[idx + 1];
  if (!lead) return { lead: car, gap: ROAD_LENGTH };
  return { lead, gap: centerGap(car.x, car.length, lead.x, lead.length) };
}

function desiredGap(car, dv) {
  const minGap = car.preferredGap ?? car.length;
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
  if (car.truck && targetLane < TRUCK_MIN_LANE) return -Infinity;
  const currentCars = laneMap.get(car.lane);
  const targetCars = laneMap.get(targetLane);

  const { gapAhead, gapBehind } = gapsAroundPosition(targetCars, car.x, car.length);
  const minMergeGap = 1.5 + car.v * 0.25;
  if (gapAhead < minMergeGap || gapBehind < minMergeGap) return -Infinity;

  const aCurrent = computeAcceleration(car, currentCars);
  const aTarget = computeAcceleration(car, targetCars);

  let idxBehind = -1;
  for (let i = targetCars.length - 1; i >= 0; i--) {
    if (targetCars[i].x < car.x) {
      idxBehind = i;
      break;
    }
  }
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
      const truck = Math.random() < settings.truckFraction && lane >= TRUCK_MIN_LANE;
      const length = (truck ? TRUCK_VISUAL_LENGTH_PX : CAR_VISUAL_LENGTH_PX) * ROAD_UNITS_PER_PIXEL;
      if (canSpawnAtStart(lane, length)) spawnCar(lane, truck);
    }
  }
}

function enforceLaneSeparation(laneCars) {
  const minGap = 0.5;
  for (let i = 0; i < laneCars.length - 1; i++) {
    const rear = laneCars[i];
    const front = laneCars[i + 1];
    const maxRearX = front.x - (rear.length + front.length) * 0.5 - minGap;
    if (rear.x > maxRearX) {
      rear.x = maxRearX;
      rear.v = Math.min(rear.v, front.v);
    }
  }
}

function update() {
  simTime += DT;
  maybeSpawnVehicles();

  const laneMap = new Map();
  for (let lane = 0; lane < LANES; lane++) {
    laneMap.set(lane, getLaneCars(lane));
  }

  for (const car of cars) {
    const laneCars = laneMap.get(car.lane);
    const aCurrent = computeAcceleration(car, laneCars);
    const speedDeficit = Math.max(0, (car.desiredSpeed - car.v) / Math.max(1, car.desiredSpeed));
    const accelDeficit = Math.max(0, 0.9 - aCurrent);
    const mergePressure = Math.min(1, speedDeficit * 0.9 + accelDeficit * 0.45);
    const evaluateChance = Math.min(0.88, 0.2 + mergePressure * 0.65);

    if (Math.random() < evaluateChance) {
      const left = laneChangeScore(car, car.lane - 1, laneMap);
      const right = laneChangeScore(car, car.lane + 1, laneMap);
      const threshold = Math.max(0.04, 0.24 + (1 - car.aggressiveness) * 0.6 - mergePressure * 0.32);
      if (left > right && left > threshold) car.lane -= 1;
      else if (right > threshold) car.lane += 1;
    }
  }

  for (let lane = 0; lane < LANES; lane++) laneMap.set(lane, getLaneCars(lane));

  const proposedAdvance = new Map();
  cars.forEach((car) => {
    const laneCars = laneMap.get(car.lane);
    car.a = computeAcceleration(car, laneCars);
    car.v = Math.max(0, Math.min(48, car.v + car.a * DT));
    proposedAdvance.set(car.id, car.v * DT);
  });

  for (let lane = 0; lane < LANES; lane++) {
    const laneCars = getLaneCars(lane);
    if (laneCars.length <= 1) {
      laneCars.forEach((car) => {
        const dx = proposedAdvance.get(car.id) ?? 0;
        car.x += dx;
      });
      continue;
    }

    laneCars.forEach((car, index) => {
      const lead = laneCars[index + 1] ?? null;
      const maxDx = lead ? Math.max(0, centerGap(car.x, car.length, lead.x, lead.length)) : Infinity;
      const desiredDx = proposedAdvance.get(car.id) ?? 0;
      const dx = Math.min(desiredDx, maxDx);
      car.v = dx / DT;
      car.x += dx;
    });

    enforceLaneSeparation(laneCars);
  }

  // Remove vehicles that have fully left the visible road segment.
  cars = cars.filter((car) => car.x - car.length * 0.5 <= ROAD_LENGTH + 2);

  // Smooth lane transitions for rendering so merges are continuous.
  const laneBlend = Math.min(1, DT * LANE_VISUAL_BLEND_RATE);
  cars.forEach((car) => {
    if (typeof car.laneVisual !== "number") car.laneVisual = car.lane;
    car.laneVisual += (car.lane - car.laneVisual) * laneBlend;
  });
}

function drawRoad() {
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const roadTop = laneBoundaryY(0);
  const roadBottom = laneBoundaryY(LANES);

  ctx.fillStyle = "#111827";
  ctx.fillRect(0, roadTop, canvas.width, roadBottom - roadTop);

  for (let i = 0; i <= LANES; i++) {
    const y = laneBoundaryY(i);
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
    if (car.x + car.length * 0.5 < 0 || car.x - car.length * 0.5 > ROAD_LENGTH) return;

    const px = (car.x / ROAD_LENGTH) * canvas.width;
    const laneY = laneCenterY(car.laneVisual);
    const py = laneY - 11;
    const w = car.visualLengthPx ?? (car.truck ? TRUCK_VISUAL_LENGTH_PX : CAR_VISUAL_LENGTH_PX);

    const speedRatio = Math.max(0, Math.min(1.25, car.v / Math.max(12, car.desiredSpeed)));
    const colorProgress = Math.pow(Math.min(1, speedRatio), 0.6);
    const hue = 8 + colorProgress * 132;
    const lightness = 45 + colorProgress * 20;
    ctx.fillStyle = car.truck
      ? `hsl(${hue * 0.5}, 90%, ${Math.min(70, lightness + 4)}%)`
      : `hsl(${hue}, 92%, ${lightness}%)`;
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
}

function frame() {
  if (running) {
    update();
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
  seedTraffic();
});

buildControls();
seedTraffic();
frame();
