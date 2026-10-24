import { ATTRACT, ENTRY, EXIT, WALL, type CellKind } from "./presets";
import type { World } from "./engine";

export type Projection = "plan" | "iso";

export type View = {
  projection: Projection;
  showHeat: boolean;
  showFlow: boolean;
  showPeople: boolean;
  image: HTMLImageElement | null;
  imageAlpha: number;
};

export type Layout =
  | { kind: "plan"; ox: number; oy: number; scale: number; cols: number; rows: number }
  | {
      kind: "iso";
      ox: number;
      oy: number;
      s: number;
      hw: number;
      hh: number;
      cols: number;
      rows: number;
    };

const HEAT: string[] = [];
for (let i = 0; i < 24; i++) {
  const t = i / 23;
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.45) {
    const u = t / 0.45;
    r = 15 + (196 - 15) * u;
    g = 110 + (130 - 110) * u;
    b = 110 + (42 - 110) * u;
  } else {
    const u = (t - 0.45) / 0.55;
    r = 196 + (168 - 196) * u;
    g = 130 + (36 - 130) * u;
    b = 42 + (28 - 42) * u;
  }
  const a = 0.12 + t * 0.62;
  HEAT.push(`rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`);
}

function heatColor(h: number) {
  const t = Math.max(0, Math.min(1, h / 16));
  return HEAT[Math.min(23, (t * 23) | 0)];
}

export function layoutOf(
  cssW: number,
  cssH: number,
  cols: number,
  rows: number,
  kind: Projection,
): Layout {
  const pad = 18;
  if (kind === "plan") {
    const scale = Math.min((cssW - pad * 2) / cols, (cssH - pad * 2) / rows);
    const ox = (cssW - cols * scale) / 2;
    const oy = (cssH - rows * scale) / 2;
    return { kind, ox, oy, scale, cols, rows };
  }
  const availW = Math.max(40, cssW - pad * 2);
  const availH = Math.max(40, cssH - pad * 2);
  const span = cols + rows;
  const s = Math.min(availW / span, availH / (span * 0.5 + 1.05));
  const hw = s;
  const hh = s * 0.5;
  const wallH = s * 0.92;
  const width = span * hw;
  const height = span * hh + wallH;
  const ox = (cssW - width) / 2 + rows * hw;
  const oy = (cssH - height) / 2 + wallH;
  return { kind, ox, oy, s, hw, hh, cols, rows };
}

function isoPoint(L: Extract<Layout, { kind: "iso" }>, x: number, y: number, z: number) {
  return {
    px: L.ox + (x - y) * L.hw,
    py: L.oy + (x + y) * L.hh - z * L.s,
  };
}

export function pick(layout: Layout, px: number, py: number): { x: number; y: number } | null {
  if (layout.kind === "plan") {
    const x = Math.floor((px - layout.ox) / layout.scale);
    const y = Math.floor((py - layout.oy) / layout.scale);
    if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) return null;
    return { x, y };
  }
  const a = (px - layout.ox) / layout.hw;
  const b = (py - layout.oy) / layout.hh;
  const x = Math.floor((a + b) / 2);
  const y = Math.floor((b - a) / 2);
  if (x < 0 || y < 0 || x >= layout.cols || y >= layout.rows) return null;
  return { x, y };
}

function token(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

let ink = "#1a1814";
let paper = "#f3efe6";
let floor = "#f7f1e4";
let teal = "#0f6e6e";
let clay = "#c45c26";

function readTokens() {
  ink = token("--color-ink", ink);
  paper = token("--color-paper", paper);
  teal = token("--color-teal", teal);
  clay = token("--color-clay", clay);
  floor = "#f7f1e4";
}

export function draw(canvas: HTMLCanvasElement, world: World, view: View): Layout {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx || cssW < 2 || cssH < 2) {
    return layoutOf(cssW, cssH, world.cols, world.rows, view.projection);
  }
  readTokens();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const layout = layoutOf(cssW, cssH, world.cols, world.rows, view.projection);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, cssW, cssH);
  if (layout.kind === "plan") drawPlan(ctx, world, view, layout);
  else drawIso(ctx, world, view, layout);
  return layout;
}

function drawPlan(
  ctx: CanvasRenderingContext2D,
  world: World,
  view: View,
  L: Extract<Layout, { kind: "plan" }>,
) {
  const { cols, rows, cells } = world;
  const { ox, oy, scale } = L;
  ctx.save();
  ctx.shadowColor = "rgba(26,24,20,0.12)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = floor;
  ctx.fillRect(ox, oy, cols * scale, rows * scale);
  ctx.restore();

  if (view.image && view.image.complete && view.image.naturalWidth) {
    ctx.save();
    ctx.globalAlpha = view.imageAlpha;
    ctx.drawImage(view.image, ox, oy, cols * scale, rows * scale);
    ctx.restore();
  }

  ctx.beginPath();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== ENTRY) continue;
    const x = i % cols;
    const y = (i / cols) | 0;
    ctx.rect(ox + x * scale, oy + y * scale, scale, scale);
  }
  ctx.fillStyle = "rgba(15,110,110,0.2)";
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EXIT) continue;
    const x = i % cols;
    const y = (i / cols) | 0;
    ctx.rect(ox + x * scale, oy + y * scale, scale, scale);
  }
  ctx.fillStyle = "rgba(196,92,38,0.2)";
  ctx.fill();

  if (view.showHeat) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === WALL) continue;
      const h = world.heat[i];
      if (h < 0.2) continue;
      const x = i % cols;
      const y = (i / cols) | 0;
      ctx.fillStyle = heatColor(h);
      ctx.fillRect(ox + x * scale, oy + y * scale, scale + 0.5, scale + 0.5);
    }
  }

  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== ATTRACT) continue;
    const x = i % cols;
    const y = (i / cols) | 0;
    const cx = ox + (x + 0.5) * scale;
    const cy = oy + (y + 0.5) * scale;
    const r = Math.max(2, scale * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fillStyle = clay;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (scale >= 10) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(26,24,20,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.moveTo(ox + x * scale + 0.5, oy);
      ctx.lineTo(ox + x * scale + 0.5, oy + rows * scale);
    }
    for (let y = 0; y <= rows; y++) {
      ctx.moveTo(ox, oy + y * scale + 0.5);
      ctx.lineTo(ox + cols * scale, oy + y * scale + 0.5);
    }
    ctx.stroke();
  }

  ctx.beginPath();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== WALL) continue;
    const x = i % cols;
    const y = (i / cols) | 0;
    ctx.rect(ox + x * scale, oy + y * scale, scale + 0.4, scale + 0.4);
  }
  ctx.fillStyle = ink;
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, cols * scale - 1, rows * scale - 1);

  if (view.showFlow) drawFlow(ctx, world, ox, oy, scale);

  if (view.showPeople) drawPeople(ctx, world, ox, oy, scale);

  drawLabels(ctx, world, (x, y) => ({
    px: ox + x * scale,
    py: oy + y * scale,
  }), Math.max(11, scale * 0.72));

  const bar = scale * 4;
  const bx = ox + 8;
  const by = oy + rows * scale - 14;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + bar, by);
  ctx.moveTo(bx, by - 3);
  ctx.lineTo(bx, by + 3);
  ctx.moveTo(bx + bar, by - 3);
  ctx.lineTo(bx + bar, by + 3);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `500 11px "Noto Sans SC", "WenQuanYi Zen Hei", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("4 米", bx, by - 4);
}

function drawPeople(
  ctx: CanvasRenderingContext2D,
  world: World,
  ox: number,
  oy: number,
  scale: number,
) {
  const r = Math.max(3.6, scale * 0.28);
  const drawSet = (modeExit: boolean, color: string) => {
    ctx.beginPath();
    for (let i = 0; i < world.count; i++) {
      if ((world.mode[i] === 2) !== modeExit) continue;
      const px = ox + world.x[i] * scale;
      const py = oy + world.y[i] * scale;
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(26,24,20,0.28)";
    ctx.stroke();
  };
  drawSet(true, "#1c4744");
  drawSet(false, clay);

  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,253,248,0.9)";
  ctx.lineWidth = 1.25;
  for (let i = 0; i < world.count; i++) {
    const px = ox + world.x[i] * scale;
    const py = oy + world.y[i] * scale;
    ctx.moveTo(px, py);
    ctx.lineTo(px + world.dx[i] * r, py + world.dy[i] * r);
  }
  ctx.stroke();
}

function drawFlow(
  ctx: CanvasRenderingContext2D,
  world: World,
  ox: number,
  oy: number,
  scale: number,
) {
  ctx.strokeStyle = "rgba(26,24,20,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = scale > 16 ? 3 : 4;
  for (let y = 1; y < world.rows - 1; y += step) {
    for (let x = 1; x < world.cols - 1; x += step) {
      const i = y * world.cols + x;
      if (world.cells[i] === WALL || world.cells[i] === EXIT) continue;
      if (world.exitDist[i] > 1e8) continue;
      let sx = 0;
      let sy = 0;
      const here = world.exitDist[i];
      for (let k = 0; k < 4; k++) {
        const oxd = k === 0 ? 1 : k === 1 ? -1 : 0;
        const oyd = k === 2 ? 1 : k === 3 ? -1 : 0;
        const nx = x + oxd;
        const ny = y + oyd;
        const v = world.exitDist[ny * world.cols + nx];
        if (v < here) {
          sx += oxd;
          sy += oyd;
        }
      }
      if (!sx && !sy) continue;
      const len = Math.hypot(sx, sy) || 1;
      const cx = ox + (x + 0.5) * scale;
      const cy = oy + (y + 0.5) * scale;
      const lenPx = scale * 0.34;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (sx / len) * lenPx, cy + (sy / len) * lenPx);
    }
  }
  ctx.stroke();
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  world: World,
  project: (x: number, y: number) => { px: number; py: number },
  size: number,
) {
  ctx.font = `600 ${size}px "Noto Sans SC", "WenQuanYi Zen Hei", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  for (const label of world.labels) {
    const p = project(label.x, label.y);
    ctx.strokeStyle = "rgba(247,241,228,0.92)";
    ctx.strokeText(label.text, p.px, p.py);
    ctx.fillStyle = ink;
    ctx.fillText(label.text, p.px, p.py);
  }
}

function drawIso(
  ctx: CanvasRenderingContext2D,
  world: World,
  view: View,
  L: Extract<Layout, { kind: "iso" }>,
) {
  const { cols, rows, cells } = world;
  const h = 0.92;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const k = cells[i] as CellKind;
      if (k === WALL) {
        drawWall(ctx, L, x, y, h, cells, cols, rows);
        continue;
      }
      const tint =
        k === ENTRY ? "rgba(15,110,110,0.28)" : k === EXIT ? "rgba(196,92,38,0.28)" : floor;
      traceDiamond(ctx, L, x, y, 0);
      ctx.fillStyle = tint;
      ctx.fill();
      if (view.showHeat && world.heat[i] >= 0.2) {
        traceDiamond(ctx, L, x, y, 0.02);
        ctx.fillStyle = heatColor(world.heat[i]);
        ctx.fill();
      }
      if (k === ATTRACT) {
        const c = isoPoint(L, x + 0.5, y + 0.5, 0.05);
        ctx.fillStyle = clay;
        ctx.beginPath();
        ctx.arc(c.px, c.py, Math.max(2, L.s * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
      if (view.showPeople) {
        let a = world.head[i];
        while (a !== -1) {
          drawIsoPerson(ctx, L, world, a);
          a = world.next[a];
        }
      }
    }
  }
  drawLabels(
    ctx,
    world,
    (x, y) => isoPoint(L, x, y, 0.15),
    Math.max(11, L.s * 0.85),
  );
}

function traceDiamond(
  ctx: CanvasRenderingContext2D,
  L: Extract<Layout, { kind: "iso" }>,
  x: number,
  y: number,
  z: number,
) {
  const p00 = isoPoint(L, x, y, z);
  const p10 = isoPoint(L, x + 1, y, z);
  const p11 = isoPoint(L, x + 1, y + 1, z);
  const p01 = isoPoint(L, x, y + 1, z);
  ctx.beginPath();
  ctx.moveTo(p00.px, p00.py);
  ctx.lineTo(p10.px, p10.py);
  ctx.lineTo(p11.px, p11.py);
  ctx.lineTo(p01.px, p01.py);
  ctx.closePath();
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  L: Extract<Layout, { kind: "iso" }>,
  x: number,
  y: number,
  h: number,
  cells: Uint8Array,
  cols: number,
  rows: number,
) {
  const p10 = isoPoint(L, x + 1, y, 0);
  const p11 = isoPoint(L, x + 1, y + 1, 0);
  const p01 = isoPoint(L, x, y + 1, 0);
  const t00 = isoPoint(L, x, y, h);
  const t10 = isoPoint(L, x + 1, y, h);
  const t11 = isoPoint(L, x + 1, y + 1, h);
  const t01 = isoPoint(L, x, y + 1, h);
  const rightOpen = x + 1 >= cols || cells[y * cols + x + 1] !== WALL;
  const leftOpen = y + 1 >= rows || cells[(y + 1) * cols + x] !== WALL;
  if (rightOpen) {
    ctx.beginPath();
    ctx.moveTo(p10.px, p10.py);
    ctx.lineTo(p11.px, p11.py);
    ctx.lineTo(t11.px, t11.py);
    ctx.lineTo(t10.px, t10.py);
    ctx.closePath();
    ctx.fillStyle = "#241f1b";
    ctx.fill();
  }
  if (leftOpen) {
    ctx.beginPath();
    ctx.moveTo(p01.px, p01.py);
    ctx.lineTo(p11.px, p11.py);
    ctx.lineTo(t11.px, t11.py);
    ctx.lineTo(t01.px, t01.py);
    ctx.closePath();
    ctx.fillStyle = "#3a342c";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(t00.px, t00.py);
  ctx.lineTo(t10.px, t10.py);
  ctx.lineTo(t11.px, t11.py);
  ctx.lineTo(t01.px, t01.py);
  ctx.closePath();
  ctx.fillStyle = "#4e463d";
  ctx.fill();
}

function drawIsoPerson(
  ctx: CanvasRenderingContext2D,
  L: Extract<Layout, { kind: "iso" }>,
  world: World,
  i: number,
) {
  const foot = isoPoint(L, world.x[i], world.y[i], 0);
  const head = isoPoint(L, world.x[i], world.y[i], 0.62);
  const color = world.mode[i] === 2 ? "#1c4744" : clay;
  ctx.fillStyle = "rgba(26,24,20,0.18)";
  ctx.beginPath();
  ctx.ellipse(foot.px, foot.py, Math.max(2, L.s * 0.16), Math.max(1, L.s * 0.08), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, L.s * 0.14);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(foot.px, foot.py);
  ctx.lineTo(head.px, head.py);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(head.px, head.py, Math.max(1.7, L.s * 0.1), 0, Math.PI * 2);
  ctx.fill();
}
