import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
} from "recharts";
import {
  Eraser,
  ImagePlus,
  LogIn,
  LogOut,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import {
  ATTRACT,
  ENTRY,
  EXIT,
  FLOOR,
  WALL,
  getPreset,
  listPresets,
  type CellKind,
} from "@/lib/sim/presets";
import {
  SCENARIOS,
  SCENARIO_LIST,
  createWorld,
  paintDisk,
  rebuild,
  resetCrowd,
  snapshot,
  step,
  type Hud,
  type ScenarioId,
  type World,
} from "@/lib/sim/engine";
import { draw, layoutOf, pick, type Projection, type View } from "@/lib/sim/draw";

const TOOLS: { id: string; label: string; kind: CellKind; icon: typeof Square }[] = [
  { id: "wall", label: "墙", kind: WALL, icon: Square },
  { id: "entry", label: "入口", kind: ENTRY, icon: LogIn },
  { id: "exit", label: "出口", kind: EXIT, icon: LogOut },
  { id: "attract", label: "停留", kind: ATTRACT, icon: MapPin },
  { id: "erase", label: "擦除", kind: FLOOR, icon: Eraser },
];

const KIND_NAME = ["地面", "墙", "入口", "出口", "停留"];
const SPEEDS = [1, 2, 4, 8];
const SAVE_KEY = "buji-plan-v1";

const EMPTY_HUD: Hud = {
  alive: 0,
  departed: 0,
  avgTravel: 0,
  perMin: 0,
  peak: 0,
  hot: 0,
  maxNow: 0,
  losCode: "A",
  losName: "宽松",
  series: [],
  seconds: 0,
  hasExit: true,
};

type Save = {
  presetId: string;
  cols: number;
  rows: number;
  cells: string;
  scenario: ScenarioId;
  rate: number;
  walk: number;
  showHeat: boolean;
  showFlow: boolean;
  showPeople: boolean;
};

function encodeCells(cells: Uint8Array) {
  let s = "";
  for (let i = 0; i < cells.length; i++) s += String.fromCharCode(cells[i]);
  return btoa(s);
}

function decodeCells(b64: string, n: number) {
  try {
    const s = atob(b64);
    if (s.length !== n) return undefined;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  } catch {
    return undefined;
  }
}

function readSave(): Save | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Save;
    if (!data || data.presetId == null || !data.cells) return null;
    return data;
  } catch {
    return null;
  }
}

function fmtTime(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Studio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const readoutRef = useRef<HTMLParagraphElement>(null);
  const visRef = useRef<View & { speed: number; running: boolean; imageUrl: string | null }>({
    projection: "plan",
    showHeat: true,
    showFlow: false,
    showPeople: true,
    image: null,
    imageAlpha: 0.55,
    speed: 1,
    running: true,
    imageUrl: null,
  });
  const toolRef = useRef(WALL as number);
  const brushRef = useRef(0);
  const paintDirty = useRef(false);
  const lastRebuild = useRef(0);

  const [presetId, setPresetId] = useState("metro");
  const [scenario, setScenario] = useState<ScenarioId>("daily");
  const [tool, setTool] = useState("wall");
  const [brush, setBrush] = useState(0);
  const [rate, setRate] = useState(150);
  const [walk, setWalk] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [running, setRunning] = useState(true);
  const [projection, setProjection] = useState<Projection>("plan");
  const [showHeat, setShowHeat] = useState(true);
  const [showFlow, setShowFlow] = useState(false);
  const [showPeople, setShowPeople] = useState(true);
  const [imageAlpha, setImageAlpha] = useState(0.55);
  const [hasImage, setHasImage] = useState(false);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [tab, setTab] = useState<"place" | "draw" | "stats">("stats");
  const [mounted, setMounted] = useState(false);
  const [paintVersion, setPaintVersion] = useState(0);

  visRef.current.projection = projection;
  visRef.current.showHeat = showHeat;
  visRef.current.showFlow = showFlow;
  visRef.current.showPeople = showPeople;
  visRef.current.imageAlpha = imageAlpha;
  visRef.current.speed = speed;
  visRef.current.running = running;
  toolRef.current = TOOLS.find((t) => t.id === tool)?.kind ?? WALL;
  brushRef.current = brush;

  useEffect(() => {
    setMounted(true);
    const saved = readSave();
    const id = saved?.presetId && getPreset(saved.presetId).id === saved.presetId ? saved.presetId : "metro";
    const plan = getPreset(id);
    const override =
      saved && saved.cols === plan.cols && saved.rows === plan.rows
        ? decodeCells(saved.cells, plan.cols * plan.rows)
        : undefined;
    const world = createWorld(plan, override);
    world.scenario = saved?.scenario ?? "daily";
    world.ratePerMin = saved?.rate ?? plan.defaultRate;
    world.walkMul = saved?.walk ?? 1;
    rebuild(world);
    resetCrowd(world);
    worldRef.current = world;
    setPresetId(id);
    setScenario(world.scenario);
    setRate(world.ratePerMin);
    setWalk(world.walkMul);
    if (saved) {
      setShowHeat(saved.showHeat);
      setShowFlow(saved.showFlow);
      setShowPeople(saved.showPeople);
    }
    setHud(snapshot(world));

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;
    const tick = (now: number) => {
      const current = worldRef.current;
      const canvas = canvasRef.current;
      const frame = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (current && canvas) {
        const vis = visRef.current;
        if (vis.running) {
          acc += frame * vis.speed;
          let guard = 0;
          while (acc >= 1 / 30 && guard < 10) {
            step(current, 1 / 30);
            acc -= 1 / 30;
            guard++;
          }
          if (guard >= 10) acc = 0;
        }
        draw(canvas, current, vis);
        hudAcc += frame;
        if (hudAcc > 0.3) {
          hudAcc = 0;
          setHud(snapshot(current));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setRunning((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const handle = window.setTimeout(() => {
      const save: Save = {
        presetId,
        cols: world.cols,
        rows: world.rows,
        cells: encodeCells(world.cells),
        scenario,
        rate,
        walk,
        showHeat,
        showFlow,
        showPeople,
      };
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      } catch {
        /* ignore quota */
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [presetId, scenario, rate, walk, showHeat, showFlow, showPeople, paintVersion]);

  function applyScenario(id: ScenarioId) {
    setScenario(id);
    const world = worldRef.current;
    if (!world) return;
    world.scenario = id;
    rebuild(world);
    resetCrowd(world);
    setHud(snapshot(world));
  }

  function loadPreset(id: string) {
    const plan = getPreset(id);
    const world = createWorld(plan);
    world.scenario = scenario;
    world.ratePerMin = plan.defaultRate;
    world.walkMul = walk;
    rebuild(world);
    resetCrowd(world);
    worldRef.current = world;
    setPresetId(id);
    setRate(plan.defaultRate);
    setHud(snapshot(world));
    setPaintVersion((v) => v + 1);
  }

  function restorePreset() {
    loadPreset(presetId);
  }

  function resetPeople() {
    const world = worldRef.current;
    if (!world) return;
    resetCrowd(world);
    setHud(snapshot(world));
  }

  function loadImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const prev = visRef.current.imageUrl;
      if (prev) URL.revokeObjectURL(prev);
      visRef.current.image = img;
      visRef.current.imageUrl = url;
      setHasImage(true);
      setProjection("plan");
    };
    img.src = url;
  }

  function clearImage() {
    const prev = visRef.current.imageUrl;
    if (prev) URL.revokeObjectURL(prev);
    visRef.current.image = null;
    visRef.current.imageUrl = null;
    setHasImage(false);
  }

  function cellFromEvent(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    if (!canvas || !world) return null;
    const rect = canvas.getBoundingClientRect();
    const layout = layoutOf(rect.width, rect.height, world.cols, world.rows, visRef.current.projection);
    return pick(layout, e.clientX - rect.left, e.clientY - rect.top);
  }

  function paintAt(cell: { x: number; y: number } | null) {
    const world = worldRef.current;
    if (!world || !cell || visRef.current.projection !== "plan") return;
    const changed = paintDisk(world, cell.x, cell.y, toolRef.current, brushRef.current);
    if (!changed) return;
    paintDirty.current = true;
    const now = performance.now();
    if (now - lastRebuild.current > 160) {
      rebuild(world);
      lastRebuild.current = now;
      paintDirty.current = false;
      setPaintVersion((v) => v + 1);
    }
  }

  function updateReadout(cell: { x: number; y: number } | null) {
    const el = readoutRef.current;
    const world = worldRef.current;
    if (!el || !world) return;
    if (!cell) {
      el.textContent = visRef.current.projection === "iso" ? "轴测模型 · 每格 1 米" : "每格 1 米";
      return;
    }
    const i = cell.y * world.cols + cell.x;
    const name = KIND_NAME[world.cells[i]] ?? "地面";
    const n = world.cellCount[i] ?? 0;
    el.textContent = `${name} · ${n} 人/㎡ · ${cell.x},${cell.y}`;
  }

  const preset = getPreset(presetId);
  const spec = SCENARIOS[scenario];
  const effectiveRate = Math.round(rate * spec.spawnScale);
  const advice =
    !hud.hasExit
      ? "还没有可到达的出口，人群会停在原地。"
      : scenario === "evac" && hud.alive === 0
        ? "人已经走完。再点一次重置，看下一轮疏散。"
        : hud.hot >= 4
          ? `${hud.hot} 个格子挤到 3 人/㎡ 以上。加宽那一截，或把到达率降下来。`
          : scenario !== "evac" && hud.alive > 40 && hud.perMin + 8 < effectiveRate
            ? "进来的比出去的快，队伍还会变长。"
            : "目前走得动。热力越红，人在那里待得越久。";

  const placePanel = (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-serif text-lg leading-tight text-ink">场地模型</h2>
        <p className="mt-1 text-sm text-pretty text-muted">选一个现成平面，或在空白场地上自己画。</p>
      </div>
      <div className="flex flex-col gap-2">
        {listPresets().map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => loadPreset(p.id)}
            className={cx(
              "rounded-lg border px-3 py-2 text-left",
              p.id === presetId ? "border-teal bg-paper" : "border-line bg-surface",
            )}
          >
            <span className="block text-sm font-medium text-ink">{p.name}</span>
            {p.id === presetId ? (
              <span className="mt-0.5 block text-xs text-pretty text-muted">{p.blurb}</span>
            ) : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={restorePreset}
        className="min-h-11 rounded-lg border border-line px-3 text-sm text-ink"
      >
        还原当前场地
      </button>
      <div className="sm:hidden">
        <p className="mb-2 text-sm text-muted">情景</p>
        <ScenarioSwitch value={scenario} onChange={applyScenario} />
      </div>
    </div>
  );

  const drawPanel = (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-lg leading-tight text-ink">绘制</h2>
        <p className="mt-1 text-sm text-pretty text-muted">
          在平面上按住拖动。每格 1 米。模型视图只供观看。
        </p>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {TOOLS.map((item) => {
          const Icon = item.icon;
          const on = tool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTool(item.id)}
              className={cx(
                "flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg text-xs",
                on ? "bg-teal text-on-teal" : "bg-paper text-ink",
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {(
          [
            [0, "细"],
            [1, "中"],
            [2, "粗"],
          ] as const
        ).map(([r, label]) => (
          <button
            key={r}
            type="button"
            aria-pressed={brush === r}
            onClick={() => setBrush(r)}
            className={cx(
              "min-h-11 flex-1 rounded-lg text-sm",
              brush === r ? "bg-ink text-paper" : "bg-paper text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="flex items-baseline justify-between text-sm">
          <span>到达率</span>
          <span className="tabular-nums text-muted">
            {scenario === "evac" ? "疏散不再进人" : `${effectiveRate} 人/分`}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={240}
          step={2}
          value={rate}
          disabled={scenario === "evac"}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRate(v);
            if (worldRef.current) worldRef.current.ratePerMin = v;
          }}
        />
      </label>
      <label className="block">
        <span className="flex items-baseline justify-between text-sm">
          <span>步速</span>
          <span className="tabular-nums text-muted">{(spec.speed * walk).toFixed(2)} 米/秒</span>
        </span>
        <input
          type="range"
          min={0.7}
          max={1.6}
          step={0.05}
          value={walk}
          onChange={(e) => {
            const v = Number(e.target.value);
            setWalk(v);
            if (worldRef.current) worldRef.current.walkMul = v;
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Toggle label="热力" pressed={showHeat} onClick={() => setShowHeat((v) => !v)} />
        <Toggle label="流向" pressed={showFlow} onClick={() => setShowFlow((v) => !v)} />
        <Toggle label="人群" pressed={showPeople} onClick={() => setShowPeople((v) => !v)} />
      </div>
      <div className="rounded-lg border border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink">平面底图</p>
          {hasImage ? (
            <button type="button" onClick={clearImage} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted">
              <Trash2 className="size-4" />
              移除
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-pretty text-muted">上传平面图当底，再描墙和出入口。图片会拉伸铺满网格。</p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-paper px-3 text-sm text-ink"
        >
          <ImagePlus className="size-4" />
          上传图片
        </button>
        {hasImage ? (
          <label className="mt-1 block">
            <span className="flex items-baseline justify-between text-sm">
              <span>底图透明度</span>
              <span className="tabular-nums text-muted">{Math.round(imageAlpha * 100)}%</span>
            </span>
            <input
              type="range"
              min={0.15}
              max={0.9}
              step={0.05}
              value={imageAlpha}
              onChange={(e) => setImageAlpha(Number(e.target.value))}
            />
          </label>
        ) : null}
      </div>
    </div>
  );

  const statsPanel = (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        <h2 className="font-serif text-lg leading-tight text-ink">现场</h2>
        <p className="tabular-nums text-sm text-muted">{fmtTime(hud.seconds)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="在场" value={String(hud.alive)} unit="人" />
        <Stat label="已离开" value={String(hud.departed)} unit="人" />
        <Stat label="通过速率" value={hud.perMin.toFixed(0)} unit="人/分" />
        <Stat label="平均耗时" value={hud.departed ? hud.avgTravel.toFixed(0) : "—"} unit={hud.departed ? "秒" : ""} />
        <Stat label="当前最密" value={String(hud.maxNow)} unit="人/㎡" />
        <Stat label="峰值" value={String(hud.peak)} unit="人/㎡" />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-paper px-3 py-3">
        <div>
          <p className="text-xs text-muted">服务水平</p>
          <p className="mt-1 text-sm text-ink">{hud.losName}</p>
        </div>
        <p
          className={cx(
            "font-serif text-4xl leading-none",
            hud.maxNow >= 3 ? "text-clay" : "text-teal",
          )}
        >
          {hud.losCode}
        </p>
      </div>
      <p className="text-sm text-pretty text-ink">{advice}</p>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <p className="text-xs text-muted">在场人数 · 近 {Math.max(hud.series.length, 1)} 秒</p>
        </div>
        <div className="h-24 w-full text-teal">
          {mounted && hud.series.length > 1 ? (
            <AreaChart width={248} height={88} data={hud.series} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
              <Area
                type="monotone"
                dataKey="n"
                stroke="currentColor"
                fill="currentColor"
                fillOpacity={0.16}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <p className="pt-6 text-sm text-muted">采样中…</p>
          )}
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>少</span>
          <span>停留热力</span>
          <span>久</span>
        </div>
        <div className="heat-legend h-2 rounded-full" />
      </div>
      <p className="text-xs text-pretty text-muted">
        {preset.name} · {spec.hint}。深青是去出口的人，陶土色是去停留点或正在停留的人。
      </p>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <div className="mr-auto flex items-center gap-2">
          <Logo />
          <div>
            <h1 className="font-serif text-xl leading-none">步迹</h1>
            <p className="mt-1 text-xs text-muted">平面人流沙盘</p>
          </div>
        </div>
        <div className="hidden sm:block">
          <ScenarioSwitch value={scenario} onChange={applyScenario} />
        </div>
        <button
          type="button"
          onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
          className="min-h-11 min-w-11 rounded-lg border border-line px-3 text-sm tabular-nums"
          aria-label="切换模拟速度"
        >
          {speed}×
        </button>
        <button
          type="button"
          onClick={() => setRunning((v) => !v)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-teal px-3 text-sm text-on-teal"
          aria-pressed={running}
        >
          {running ? <Pause className="size-4" /> : <Play className="size-4" />}
          {running ? "暂停" : "开始"}
        </button>
        <button
          type="button"
          onClick={resetPeople}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm"
          aria-label="重置人群"
        >
          <RotateCcw className="size-4" />
          <span className="hidden sm:inline">重置</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hidden min-h-0 w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface p-4 lg:flex">
          {placePanel}
          {drawPanel}
        </aside>

        <main className="relative min-h-0 flex-1 bg-paper">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full touch-none select-none"
            role="application"
            aria-label="人流平面。在平面模式下拖动可绘制墙体、入口、出口和停留点。"
            onPointerDown={(e) => {
              if (projection !== "plan") return;
              e.currentTarget.setPointerCapture(e.pointerId);
              paintAt(cellFromEvent(e));
            }}
            onPointerMove={(e) => {
              const cell = cellFromEvent(e);
              updateReadout(cell);
              if (e.currentTarget.hasPointerCapture(e.pointerId)) paintAt(cell);
            }}
            onPointerUp={() => {
              const world = worldRef.current;
              if (paintDirty.current && world) {
                rebuild(world);
                paintDirty.current = false;
                setPaintVersion((v) => v + 1);
                setHud(snapshot(world));
              }
            }}
            onPointerLeave={() => updateReadout(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) loadImage(file);
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
            <div className="pointer-events-auto flex rounded-lg bg-surface p-1 ring-1 ring-line">
              <ProjButton on={projection === "plan"} onClick={() => setProjection("plan")}>
                平面
              </ProjButton>
              <ProjButton on={projection === "iso"} onClick={() => setProjection("iso")}>
                模型
              </ProjButton>
            </div>
            {!hud.hasExit ? (
              <p className="rounded-lg bg-clay px-3 py-2 text-sm text-on-clay">还没有出口</p>
            ) : null}
          </div>
          <p
            ref={readoutRef}
            className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-surface/90 px-3 py-2 text-sm tabular-nums"
          >
            每格 1 米
          </p>
          <p className="pointer-events-none absolute right-3 bottom-3 rounded-lg bg-surface/90 px-3 py-2 text-sm tabular-nums">
            {hud.alive} 人在场
          </p>
        </main>

        <aside className="hidden min-h-0 w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface p-4 lg:flex">
          {statsPanel}
        </aside>

        <section className="flex h-[42dvh] min-h-0 shrink-0 flex-col overflow-hidden border-t border-line bg-surface lg:hidden">
          <div className="grid grid-cols-3 border-b border-line">
            {(
              [
                ["place", "场地"],
                ["draw", "绘制"],
                ["stats", "数据"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cx(
                  "min-h-11 text-sm",
                  tab === id ? "text-teal" : "text-muted",
                )}
                aria-pressed={tab === id}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "place" ? placePanel : tab === "draw" ? drawPanel : statsPanel}
          </div>
        </section>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadImage(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-9 text-ink" aria-hidden>
      <rect x="3" y="5" width="26" height="22" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 27V15h6v12" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="20" cy="16" r="1.5" className="fill-teal" />
      <circle cx="24" cy="19" r="1.5" className="fill-clay" />
      <circle cx="22" cy="13" r="1.5" className="fill-teal" />
    </svg>
  );
}

function ScenarioSwitch({
  value,
  onChange,
}: {
  value: ScenarioId;
  onChange: (id: ScenarioId) => void;
}) {
  return (
    <div className="flex rounded-lg bg-paper p-1">
      {SCENARIO_LIST.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cx(
            "min-h-11 rounded-md px-3 text-sm",
            value === id ? "bg-surface text-ink" : "text-muted",
          )}
          aria-pressed={value === id}
        >
          {SCENARIOS[id].label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "min-h-11 rounded-lg px-3 text-sm",
        pressed ? "bg-teal text-on-teal" : "bg-paper text-muted",
      )}
    >
      {label}
    </button>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg bg-paper px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-serif text-2xl leading-none tabular-nums text-ink">
        {value}
        {unit ? <span className="ml-1 font-sans text-xs text-muted">{unit}</span> : null}
      </p>
    </div>
  );
}

function ProjButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "min-h-11 rounded-md px-3 text-sm",
        on ? "bg-ink text-paper" : "text-muted",
      )}
    >
      {children}
    </button>
  );
}
