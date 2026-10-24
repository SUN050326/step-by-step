import {
  ATTRACT,
  ENTRY,
  EXIT,
  WALL,
  type Plan,
} from "./presets";

export const MAX_AGENTS = 1000;
const INF = 1e9;

export type ScenarioId = "daily" | "peak" | "evac";

export const SCENARIOS: Record<
  ScenarioId,
  {
    label: string;
    hint: string;
    visit: number;
    dwell: readonly [number, number];
    speed: number;
    spawnScale: number;
    seed: number;
  }
> = {
  daily: {
    label: "日常",
    hint: "进场、短暂停下、再离开",
    visit: 0.7,
    dwell: [4, 12],
    speed: 1.15,
    spawnScale: 1,
    seed: 0.07,
  },
  peak: {
    label: "高峰",
    hint: "到达加快，几乎不停留",
    visit: 0.2,
    dwell: [1, 2.5],
    speed: 1.3,
    spawnScale: 2.2,
    seed: 0.1,
  },
  evac: {
    label: "疏散",
    hint: "场内的人同时走向最近出口",
    visit: 0,
    dwell: [0, 0],
    speed: 1.65,
    spawnScale: 0,
    seed: 0.42,
  },
};

export const SCENARIO_LIST: ScenarioId[] = ["daily", "peak", "evac"];

const N8: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 10],
  [-1, 0, 10],
  [0, 1, 10],
  [0, -1, 10],
  [1, 1, 14],
  [1, -1, 14],
  [-1, 1, 14],
  [-1, -1, 14],
];

export type Label = { x: number; y: number; text: string };

export type Hud = {
  alive: number;
  departed: number;
  avgTravel: number;
  perMin: number;
  peak: number;
  hot: number;
  maxNow: number;
  losCode: string;
  losName: string;
  series: { t: number; n: number }[];
  seconds: number;
  hasExit: boolean;
};

export type World = {
  cols: number;
  rows: number;
  cells: Uint8Array;
  exitDist: Float32Array;
  attractDist: Float32Array;
  heat: Float32Array;
  count: number;
  x: Float32Array;
  y: Float32Array;
  nxp: Float32Array;
  nyp: Float32Array;
  mode: Uint8Array;
  dwell: Float32Array;
  age: Float32Array;
  dx: Float32Array;
  dy: Float32Array;
  dead: Uint8Array;
  head: Int32Array;
  next: Int32Array;
  cellCount: Uint16Array;
  departed: number;
  travelSum: number;
  simTime: number;
  spawnAcc: number;
  sampleAcc: number;
  depTick: number;
  peakDensity: number;
  hot: number;
  maxNow: number;
  occSeries: number[];
  depSeries: number[];
  scenario: ScenarioId;
  ratePerMin: number;
  walkMul: number;
  entries: number[];
  exits: number[];
  attractors: number[];
  labels: Label[];
  hasExit: boolean;
};

export function createWorld(plan: Plan, override?: Uint8Array): World {
  const n = plan.cols * plan.rows;
  const cells =
    override && override.length === n ? override.slice() : plan.cells.slice();
  const world: World = {
    cols: plan.cols,
    rows: plan.rows,
    cells,
    exitDist: new Float32Array(n),
    attractDist: new Float32Array(n),
    heat: new Float32Array(n),
    count: 0,
    x: new Float32Array(MAX_AGENTS),
    y: new Float32Array(MAX_AGENTS),
    nxp: new Float32Array(MAX_AGENTS),
    nyp: new Float32Array(MAX_AGENTS),
    mode: new Uint8Array(MAX_AGENTS),
    dwell: new Float32Array(MAX_AGENTS),
    age: new Float32Array(MAX_AGENTS),
    dx: new Float32Array(MAX_AGENTS),
    dy: new Float32Array(MAX_AGENTS),
    dead: new Uint8Array(MAX_AGENTS),
    head: new Int32Array(n),
    next: new Int32Array(MAX_AGENTS),
    cellCount: new Uint16Array(n),
    departed: 0,
    travelSum: 0,
    simTime: 0,
    spawnAcc: 0,
    sampleAcc: 0,
    depTick: 0,
    peakDensity: 0,
    hot: 0,
    maxNow: 0,
    occSeries: [],
    depSeries: [],
    scenario: "daily",
    ratePerMin: plan.defaultRate,
    walkMul: 1,
    entries: [],
    exits: [],
    attractors: [],
    labels: [],
    hasExit: false,
  };
  world.head.fill(-1);
  rebuild(world);
  return world;
}

function buildFlow(
  cells: Uint8Array,
  cols: number,
  rows: number,
  goals: Uint8Array,
): Float32Array {
  const n = cells.length;
  const dist = new Float32Array(n);
  dist.fill(INF);
  const heapI: number[] = [];
  const heapD: number[] = [];
  const push = (i: number, d: number) => {
    heapI.push(i);
    heapD.push(d);
    let k = heapI.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= heapD[k]) break;
      [heapD[p], heapD[k]] = [heapD[k], heapD[p]];
      [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
      k = p;
    }
  };
  const pop = (): [number, number] | null => {
    if (!heapI.length) return null;
    const i = heapI[0];
    const d = heapD[0];
    const li = heapI.pop()!;
    const ld = heapD.pop()!;
    if (heapI.length) {
      heapI[0] = li;
      heapD[0] = ld;
      let k = 0;
      for (;;) {
        let s = k;
        const l = k * 2 + 1;
        const r = l + 1;
        if (l < heapD.length && heapD[l] < heapD[s]) s = l;
        if (r < heapD.length && heapD[r] < heapD[s]) s = r;
        if (s === k) break;
        [heapD[s], heapD[k]] = [heapD[k], heapD[s]];
        [heapI[s], heapI[k]] = [heapI[k], heapI[s]];
        k = s;
      }
    }
    return [i, d];
  };

  for (let i = 0; i < n; i++) {
    if (goals[i]) {
      dist[i] = 0;
      push(i, 0);
    }
  }

  while (true) {
    const got = pop();
    if (!got) break;
    const [i, d] = got;
    if (d !== dist[i]) continue;
    const x = i % cols;
    const y = (i / cols) | 0;
    for (let k = 0; k < N8.length; k++) {
      const dx = N8[k][0];
      const dy = N8[k][1];
      const cost = N8[k][2];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (dx !== 0 && dy !== 0) {
        if (cells[y * cols + nx] === WALL || cells[ny * cols + x] === WALL) continue;
      }
      const ni = ny * cols + nx;
      if (cells[ni] === WALL) continue;
      const nd = d + cost;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        push(ni, nd);
      }
    }
  }
  return dist;
}

function computeLabels(cells: Uint8Array, cols: number, rows: number): Label[] {
  const seen = new Uint8Array(cells.length);
  const labels: Label[] = [];
  const kinds: Array<[number, string]> = [
    [ENTRY, "入口"],
    [EXIT, "出口"],
  ];
  const stack: number[] = [];
  for (const [kind, text] of kinds) {
    for (let i = 0; i < cells.length; i++) {
      if (seen[i] || cells[i] !== kind) continue;
      seen[i] = 1;
      stack.push(i);
      let minX = cols;
      let minY = rows;
      let maxX = 0;
      let maxY = 0;
      let cnt = 0;
      while (stack.length) {
        const c = stack.pop()!;
        const x = c % cols;
        const y = (c / cols) | 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        cnt++;
        const ns = [c - 1, c + 1, c - cols, c + cols];
        for (const ni of ns) {
          if (ni < 0 || ni >= cells.length || seen[ni] || cells[ni] !== kind) continue;
          if (ni === c - 1 && x === 0) continue;
          if (ni === c + 1 && x === cols - 1) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      if (cnt >= 1) {
        labels.push({
          x: (minX + maxX + 1) / 2,
          y: (minY + maxY + 1) / 2,
          text,
        });
      }
    }
  }
  return labels;
}

export function rebuild(world: World) {
  const { cells, cols, rows } = world;
  const n = cells.length;
  const exitG = new Uint8Array(n);
  const attrG = new Uint8Array(n);
  world.entries = [];
  world.exits = [];
  world.attractors = [];
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (c === ENTRY) {
      world.entries.push(i);
      if (world.scenario === "evac") exitG[i] = 1;
    } else if (c === EXIT) {
      world.exits.push(i);
      exitG[i] = 1;
    } else if (c === ATTRACT) {
      world.attractors.push(i);
      attrG[i] = 1;
    }
  }
  world.exitDist = buildFlow(cells, cols, rows, exitG);
  if (world.attractors.length) {
    world.attractDist = buildFlow(cells, cols, rows, attrG);
  } else {
    world.attractDist = new Float32Array(n);
    world.attractDist.fill(INF);
  }
  world.labels = computeLabels(cells, cols, rows);
  world.hasExit = exitG.some((v) => v === 1);
  let i = 0;
  while (i < world.count) {
    const cx = Math.floor(world.x[i]);
    const cy = Math.floor(world.y[i]);
    if (
      cx < 0 ||
      cy < 0 ||
      cx >= cols ||
      cy >= rows ||
      cells[cy * cols + cx] === WALL
    ) {
      removeAt(world, i);
    } else {
      i++;
    }
  }
}

function removeAt(world: World, i: number) {
  const last = world.count - 1;
  if (i !== last) {
    world.x[i] = world.x[last];
    world.y[i] = world.y[last];
    world.mode[i] = world.mode[last];
    world.dwell[i] = world.dwell[last];
    world.age[i] = world.age[last];
    world.dx[i] = world.dx[last];
    world.dy[i] = world.dy[last];
  }
  world.count = last;
}

function walkable(world: World, x: number, y: number) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= world.cols || cy >= world.rows) return false;
  return world.cells[cy * world.cols + cx] !== WALL;
}

function addAgent(world: World, x: number, y: number, mode: number) {
  if (world.count >= MAX_AGENTS) return;
  const i = world.count++;
  world.x[i] = x;
  world.y[i] = y;
  world.mode[i] = mode;
  world.dwell[i] = 0;
  world.age[i] = 0;
  world.dx[i] = 1;
  world.dy[i] = 0;
}

function seed(world: World, prob: number) {
  const { cells, cols, rows } = world;
  for (let i = 0; i < cells.length; i++) {
    if (world.count >= MAX_AGENTS - 20) return;
    const c = cells[i];
    if (c === WALL || c === EXIT) continue;
    if (world.scenario === "evac" && c === ENTRY) continue;
    if (world.exitDist[i] > 1e8) continue;
    if (Math.random() > prob) continue;
    const x = (i % cols) + 0.25 + Math.random() * 0.5;
    const y = ((i / cols) | 0) + 0.25 + Math.random() * 0.5;
    const spec = SCENARIOS[world.scenario];
    const mode =
      world.attractors.length && Math.random() < spec.visit ? 0 : 2;
    addAgent(world, x, y, mode);
  }
}

export function prime(world: World) {
  if (world.scenario === "evac") {
    seed(world, SCENARIOS.evac.seed);
    for (let i = 0; i < 12; i++) step(world, 0.05);
    return;
  }
  seed(world, SCENARIOS[world.scenario].seed);
  for (let i = 0; i < 40; i++) step(world, 0.1);
}

export function resetCrowd(world: World) {
  world.count = 0;
  world.departed = 0;
  world.travelSum = 0;
  world.simTime = 0;
  world.spawnAcc = 0;
  world.sampleAcc = 0;
  world.depTick = 0;
  world.peakDensity = 0;
  world.hot = 0;
  world.maxNow = 0;
  world.occSeries = [];
  world.depSeries = [];
  world.heat.fill(0);
  prime(world);
}

export function paintDisk(
  world: World,
  cx: number,
  cy: number,
  kind: number,
  radius: number,
): boolean {
  let changed = false;
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      if (x < 0 || y < 0 || x >= world.cols || y >= world.rows) continue;
      const i = y * world.cols + x;
      if (world.cells[i] !== kind) {
        world.cells[i] = kind;
        changed = true;
      }
    }
  }
  return changed;
}

function buildHash(world: World) {
  world.head.fill(-1);
  world.cellCount.fill(0);
  const { cols, rows } = world;
  for (let i = 0; i < world.count; i++) {
    let cx = Math.floor(world.x[i]);
    let cy = Math.floor(world.y[i]);
    if (cx < 0) cx = 0;
    if (cy < 0) cy = 0;
    if (cx >= cols) cx = cols - 1;
    if (cy >= rows) cy = rows - 1;
    const c = cy * cols + cx;
    world.next[i] = world.head[c];
    world.head[c] = i;
    world.cellCount[c]++;
  }
}

function steer(
  dist: Float32Array,
  x: number,
  y: number,
  cols: number,
  rows: number,
): [number, number] {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return [0, 0];
  const here = dist[cy * cols + cx];
  if (here > 1e8) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < 8; k++) {
    const nx = cx + N8[k][0];
    const ny = cy + N8[k][1];
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const v = dist[ny * cols + nx];
    if (v < here) {
      const w = here - v;
      sx += (nx + 0.5 - x) * w;
      sy += (ny + 0.5 - y) * w;
    }
  }
  const len = Math.hypot(sx, sy);
  if (len < 1e-4) return [0, 0];
  return [sx / len, sy / len];
}

function wallPush(world: World, x: number, y: number): [number, number] {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let sx = 0;
  let sy = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= world.cols || ny >= world.rows) continue;
      if (world.cells[ny * world.cols + nx] !== WALL) continue;
      const dx = x - (nx + 0.5);
      const dy = y - (ny + 0.5);
      const d = Math.hypot(dx, dy);
      if (d < 0.9 && d > 1e-4) {
        const f = (0.9 - d) / 0.9;
        sx += (dx / d) * f;
        sy += (dy / d) * f;
      }
    }
  }
  return [sx, sy];
}

function slide(world: World, x: number, y: number, vx: number, vy: number, dt: number) {
  const nx = x + vx * dt;
  const ny = y + vy * dt;
  if (walkable(world, nx, ny)) return [nx, ny] as const;
  if (walkable(world, nx, y)) return [nx, y] as const;
  if (walkable(world, x, ny)) return [x, ny] as const;
  return [x, y] as const;
}

const REACH = 0.5;
const REACH2 = REACH * REACH;

export function step(world: World, dt: number) {
  const spec = SCENARIOS[world.scenario];
  const perSec = (world.ratePerMin / 60) * spec.spawnScale;
  world.spawnAcc += perSec * dt;
  if (world.spawnAcc > 8) world.spawnAcc = 8;
  let tries = 0;
  while (world.spawnAcc >= 1 && world.count < MAX_AGENTS && world.entries.length && tries < 10) {
    tries++;
    const ei = world.entries[(Math.random() * world.entries.length) | 0];
    if (world.cellCount[ei] >= 2) {
      if (tries === 10) world.spawnAcc -= 0.2;
      continue;
    }
    const gx = ei % world.cols;
    const gy = (ei / world.cols) | 0;
    const mode = world.attractors.length && Math.random() < spec.visit ? 0 : 2;
    addAgent(
      world,
      gx + 0.2 + Math.random() * 0.6,
      gy + 0.2 + Math.random() * 0.6,
      mode,
    );
    world.spawnAcc -= 1;
  }

  buildHash(world);
  const { cols, rows, cells } = world;

  for (let i = 0; i < world.count; i++) {
    const x = world.x[i];
    const y = world.y[i];
    world.age[i] += dt;
    let mode = world.mode[i];
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) {
      world.dead[i] = 1;
      continue;
    }
    const ci = cy * cols + cx;
    const here = cells[ci];

    if (mode === 0 && (world.attractors.length === 0 || world.attractDist[ci] > 1e8)) {
      mode = 2;
    }
    if (mode === 0 && world.attractDist[ci] < 1) {
      mode = 1;
      const [a, b] = spec.dwell;
      world.dwell[i] = a + Math.random() * Math.max(0, b - a);
    }
    if (mode === 1) {
      world.dwell[i] -= dt;
      if (world.dwell[i] <= 0) mode = 2;
    }
    world.mode[i] = mode;

    if (
      mode === 2 &&
      (here === EXIT || (world.scenario === "evac" && here === ENTRY))
    ) {
      world.dead[i] = 1;
      continue;
    }
    world.dead[i] = 0;

    let nNear = 0;
    let sepx = 0;
    let sepy = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox;
        const yy = cy + oy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        let j = world.head[yy * cols + xx];
        while (j !== -1) {
          if (j !== i) {
            const dx = x - world.x[j];
            const dy = y - world.y[j];
            const d2 = dx * dx + dy * dy;
            if (d2 < REACH2 && d2 > 1e-8) {
              const d = Math.sqrt(d2);
              nNear++;
              const f = (REACH - d) / REACH;
              sepx += (dx / d) * f;
              sepy += (dy / d) * f;
            }
          }
          j = world.next[j];
        }
      }
    }

    let dirx = 0;
    let diry = 0;
    let speed = spec.speed * world.walkMul;
    if (mode === 1) {
      const ang = world.simTime * 1.2 + i * 1.7;
      dirx = Math.cos(ang);
      diry = Math.sin(ang);
      speed *= 0.16;
    } else {
      const field = mode === 0 ? world.attractDist : world.exitDist;
      const steered = steer(field, x, y, cols, rows);
      dirx = steered[0];
      diry = steered[1];
      const slow = nNear <= 1 ? 1 : nNear === 2 ? 0.78 : nNear === 3 ? 0.58 : nNear === 4 ? 0.44 : 0.32;
      speed *= slow;
    }

    const push = wallPush(world, x, y);
    let vx = dirx * speed + sepx * 1.3 + push[0] * 1.15;
    let vy = diry * speed + sepy * 1.3 + push[1] * 1.15;
    const mag = Math.hypot(vx, vy);
    const cap = Math.max(0.3, speed) * 1.4;
    if (mag > cap) {
      vx = (vx / mag) * cap;
      vy = (vy / mag) * cap;
    }
    const [nx, ny] = slide(world, x, y, vx, vy, dt);
    world.nxp[i] = nx;
    world.nyp[i] = ny;
    const ddx = nx - x;
    const ddy = ny - y;
    const dl = Math.hypot(ddx, ddy);
    if (dl > 0.002) {
      world.dx[i] = ddx / dl;
      world.dy[i] = ddy / dl;
    } else if (dirx || diry) {
      world.dx[i] = dirx;
      world.dy[i] = diry;
    }

    const ncx = Math.floor(nx);
    const ncy = Math.floor(ny);
    const nk = cells[ncy * cols + ncx];
    if (
      mode === 2 &&
      (nk === EXIT || (world.scenario === "evac" && nk === ENTRY))
    ) {
      world.dead[i] = 1;
    }
  }

  let w = 0;
  for (let i = 0; i < world.count; i++) {
    if (world.dead[i]) {
      world.departed++;
      world.travelSum += world.age[i];
      world.depTick++;
      continue;
    }
    world.x[w] = world.nxp[i];
    world.y[w] = world.nyp[i];
    if (w !== i) {
      world.mode[w] = world.mode[i];
      world.dwell[w] = world.dwell[i];
      world.age[w] = world.age[i];
      world.dx[w] = world.dx[i];
      world.dy[w] = world.dy[i];
    }
    w++;
  }
  world.count = w;

  relax(world);

  const decay = Math.exp(-dt / 8);
  let maxNow = 0;
  let hot = 0;
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] === WALL) {
      world.heat[c] = 0;
      continue;
    }
    const occ = world.cellCount[c];
    world.heat[c] = world.heat[c] * decay + occ * dt;
    if (occ > maxNow) maxNow = occ;
    if (occ >= 3) hot++;
  }
  world.maxNow = maxNow;
  world.hot = hot;
  if (maxNow > world.peakDensity) world.peakDensity = maxNow;

  world.simTime += dt;
  world.sampleAcc += dt;
  if (world.sampleAcc >= 1) {
    world.sampleAcc -= 1;
    world.occSeries.push(world.count);
    world.depSeries.push(world.depTick);
    world.depTick = 0;
    if (world.occSeries.length > 90) {
      world.occSeries.shift();
      world.depSeries.shift();
    }
  }
}

function relax(world: World) {
  buildHash(world);
  const minD = 0.34;
  const minD2 = minD * minD;
  const { cols, rows } = world;
  for (let i = 0; i < world.count; i++) {
    let x = world.x[i];
    let y = world.y[i];
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let px = 0;
    let py = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox;
        const yy = cy + oy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        let j = world.head[yy * cols + xx];
        while (j !== -1) {
          if (j !== i) {
            const dx = x - world.x[j];
            const dy = y - world.y[j];
            const d2 = dx * dx + dy * dy;
            if (d2 < minD2 && d2 > 1e-8) {
              const d = Math.sqrt(d2);
              const f = (minD - d) * 0.5;
              px += (dx / d) * f;
              py += (dy / d) * f;
            } else if (d2 <= 1e-8) {
              px += 0.04;
            }
          }
          j = world.next[j];
        }
      }
    }
    const pushed = wallPush(world, x, y);
    const nx = x + px + pushed[0] * 0.2;
    const ny = y + py + pushed[1] * 0.2;
    if (walkable(world, nx, ny)) {
      world.x[i] = nx;
      world.y[i] = ny;
    }
  }
  buildHash(world);
}

const LOS = [
  { code: "A", name: "宽松" },
  { code: "B", name: "顺畅" },
  { code: "C", name: "稳定" },
  { code: "D", name: "受限" },
  { code: "E", name: "拥挤" },
  { code: "F", name: "堵塞" },
];

export function snapshot(world: World): Hud {
  const secs = world.depSeries.length;
  let sum = 0;
  for (const n of world.depSeries) sum += n;
  const perMin = secs ? (sum / secs) * 60 : 0;
  const idx = Math.max(0, Math.min(5, world.maxNow));
  const los = LOS[idx];
  return {
    alive: world.count,
    departed: world.departed,
    avgTravel: world.departed ? world.travelSum / world.departed : 0,
    perMin,
    peak: world.peakDensity,
    hot: world.hot,
    maxNow: world.maxNow,
    losCode: los.code,
    losName: los.name,
    series: world.occSeries.map((n, t) => ({ t, n })),
    seconds: world.simTime,
    hasExit: world.hasExit,
  };
}
