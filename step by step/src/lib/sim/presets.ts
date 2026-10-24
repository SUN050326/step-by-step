export const FLOOR = 0;
export const WALL = 1;
export const ENTRY = 2;
export const EXIT = 3;
export const ATTRACT = 4;

export type CellKind = 0 | 1 | 2 | 3 | 4;

export type Plan = {
  id: string;
  name: string;
  blurb: string;
  cols: number;
  rows: number;
  cells: Uint8Array;
  defaultRate: number;
};

type Draft = {
  cells: Uint8Array;
  cols: number;
  rows: number;
  rect: (x: number, y: number, w: number, h: number, k: CellKind) => void;
  border: () => void;
};

function make(cols: number, rows: number): Draft {
  const cells = new Uint8Array(cols * rows);
  const rect = (x: number, y: number, w: number, h: number, k: CellKind) => {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(cols, x + w);
    const y1 = Math.min(rows, y + h);
    for (let yy = y0; yy < y1; yy++) {
      cells.fill(k, yy * cols + x0, yy * cols + x1);
    }
  };
  const border = () => {
    rect(0, 0, cols, 1, WALL);
    rect(0, rows - 1, cols, 1, WALL);
    rect(0, 0, 1, rows, WALL);
    rect(cols - 1, 0, 1, rows, WALL);
  };
  return { cells, cols, rows, rect, border };
}

function finish(
  d: Draft,
  meta: Omit<Plan, "cols" | "rows" | "cells">,
): Plan {
  return { ...meta, cols: d.cols, rows: d.rows, cells: d.cells };
}

function shop(
  d: Draft,
  x: number,
  y: number,
  w: number,
  h: number,
  door: "n" | "s" | "e" | "w",
) {
  d.rect(x, y, w, h, WALL);
  if (w > 2 && h > 2) d.rect(x + 1, y + 1, w - 2, h - 2, FLOOR);
  const ax = x + Math.max(1, Math.floor(w / 2) - 1);
  const ay = y + Math.max(1, Math.floor(h / 2) - 0);
  d.rect(ax, ay, Math.min(2, w - 2), 1, ATTRACT);
  if (door === "s") d.rect(x + Math.floor((w - 2) / 2), y + h - 1, 2, 1, FLOOR);
  if (door === "n") d.rect(x + Math.floor((w - 2) / 2), y, 2, 1, FLOOR);
  if (door === "w") d.rect(x, y + Math.floor((h - 2) / 2), 1, 2, FLOOR);
  if (door === "e") d.rect(x + w - 1, y + Math.floor((h - 2) / 2), 1, 2, FLOOR);
}

function metro(): Plan {
  const d = make(40, 26);
  d.border();
  d.rect(4, 1, 7, 2, EXIT);
  d.rect(28, 1, 7, 2, EXIT);
  d.rect(8, 5, 2, 2, WALL);
  d.rect(20, 5, 2, 2, WALL);
  d.rect(30, 6, 2, 2, WALL);
  d.rect(1, 11, 38, 1, WALL);
  d.rect(14, 11, 1, 1, FLOOR);
  d.rect(25, 11, 1, 1, FLOOR);
  d.rect(3, 16, 6, 3, WALL);
  d.rect(5, 19, 2, 1, ATTRACT);
  d.rect(17, 16, 6, 3, WALL);
  d.rect(19, 19, 2, 1, ATTRACT);
  d.rect(30, 16, 6, 3, WALL);
  d.rect(32, 19, 2, 1, ATTRACT);
  d.rect(4, 25, 6, 1, ENTRY);
  d.rect(16, 25, 8, 1, ENTRY);
  d.rect(30, 25, 6, 1, ENTRY);
  return finish(d, {
    id: "metro",
    name: "地铁站厅",
    blurb: "两个闸机口。进站的人要去站台，高峰时队伍会顶在闸机前。",
    defaultRate: 150,
  });
}

function mall(): Plan {
  const d = make(38, 28);
  d.border();
  shop(d, 1, 1, 8, 6, "s");
  shop(d, 10, 1, 8, 6, "s");
  shop(d, 20, 1, 8, 6, "s");
  shop(d, 29, 1, 8, 6, "s");
  shop(d, 1, 8, 7, 8, "e");
  shop(d, 1, 17, 7, 6, "e");
  shop(d, 30, 8, 7, 8, "w");
  shop(d, 30, 17, 7, 6, "w");
  d.rect(14, 12, 2, 2, WALL);
  d.rect(22, 12, 2, 2, WALL);
  d.rect(14, 18, 2, 2, WALL);
  d.rect(22, 18, 2, 2, WALL);
  d.rect(15, 8, 3, 2, EXIT);
  d.rect(21, 8, 3, 2, EXIT);
  d.rect(17, 21, 4, 2, ATTRACT);
  d.rect(2, 27, 5, 1, ENTRY);
  d.rect(10, 27, 7, 1, ENTRY);
  d.rect(20, 27, 7, 1, ENTRY);
  d.rect(31, 27, 5, 1, ENTRY);
  return finish(d, {
    id: "mall",
    name: "商场中庭",
    blurb: "店铺会把人留住，扶梯是出口。看中庭何时被逛店的人填满。",
    defaultRate: 110,
  });
}

function office(): Plan {
  const d = make(38, 24);
  d.border();
  d.rect(2, 8, 5, 6, WALL);
  d.rect(7, 9, 2, 2, ENTRY);
  d.rect(7, 12, 2, 2, ENTRY);
  d.rect(2, 1, 4, 3, EXIT);
  d.rect(2, 19, 4, 3, EXIT);
  d.rect(14, 1, 8, 6, WALL);
  d.rect(15, 2, 6, 4, FLOOR);
  d.rect(16, 3, 2, 1, ATTRACT);
  d.rect(16, 6, 2, 1, FLOOR);
  d.rect(23, 1, 14, 6, WALL);
  d.rect(24, 2, 12, 4, FLOOR);
  d.rect(28, 3, 2, 1, ATTRACT);
  d.rect(28, 6, 2, 1, FLOOR);
  for (const y of [11, 15, 19]) {
    for (const x of [14, 19, 24, 29]) d.rect(x, y, 3, 1, WALL);
  }
  d.rect(33, 20, 3, 2, ATTRACT);
  return finish(d, {
    id: "office",
    name: "办公楼层",
    blurb: "人从电梯厅进来。走道还宽，会议室门和工位之间会变窄。",
    defaultRate: 48,
  });
}

function gallery(): Plan {
  const d = make(34, 24);
  d.border();
  d.rect(12, 1, 1, 18, WALL);
  d.rect(12, 19, 1, 2, FLOOR);
  d.rect(23, 5, 1, 18, WALL);
  d.rect(23, 2, 1, 2, FLOOR);
  d.rect(5, 8, 2, 8, WALL);
  d.rect(16, 10, 2, 7, WALL);
  d.rect(27, 9, 2, 8, WALL);
  d.rect(7, 11, 2, 1, ATTRACT);
  d.rect(18, 13, 2, 1, ATTRACT);
  d.rect(28, 6, 2, 1, ATTRACT);
  d.rect(0, 16, 1, 4, ENTRY);
  d.rect(33, 16, 1, 4, EXIT);
  return finish(d, {
    id: "gallery",
    name: "串联展厅",
    blurb: "三间房只靠一扇门串起来。人会在门口叠成一堵。",
    defaultRate: 64,
  });
}

function school(): Plan {
  const d = make(44, 20);
  d.border();
  d.rect(1, 8, 42, 1, WALL);
  d.rect(1, 13, 42, 1, WALL);
  for (const x of [8, 16, 24, 32]) {
    d.rect(x, 1, 1, 8, WALL);
    d.rect(x, 13, 1, 6, WALL);
  }
  d.rect(36, 13, 1, 6, WALL);
  for (const x of [4, 12, 20, 28, 38]) d.rect(x, 8, 1, 1, FLOOR);
  for (const x of [4, 12, 28, 38]) d.rect(x, 13, 1, 1, FLOOR);
  d.rect(18, 13, 8, 1, FLOOR);
  d.rect(20, 19, 6, 1, ENTRY);
  for (const x of [3, 11, 19, 27, 37]) d.rect(x, 4, 2, 1, ATTRACT);
  for (const x of [3, 11, 29, 37]) d.rect(x, 16, 2, 1, ATTRACT);
  d.rect(0, 9, 1, 4, EXIT);
  d.rect(43, 9, 1, 4, EXIT);
  return finish(d, {
    id: "school",
    name: "教学楼",
    blurb: "教室门开向走廊，楼梯在两端。下课铃就是一场小型疏散。",
    defaultRate: 90,
  });
}

function blank(): Plan {
  const d = make(28, 18);
  d.border();
  d.rect(0, 7, 1, 4, ENTRY);
  d.rect(27, 7, 1, 4, EXIT);
  d.rect(12, 4, 2, 10, WALL);
  d.rect(12, 8, 2, 2, FLOOR);
  d.rect(18, 8, 2, 1, ATTRACT);
  return finish(d, {
    id: "blank",
    name: "空白场地",
    blurb: "自己画墙、入口和出口。也可以先上传一张平面图当底图。",
    defaultRate: 40,
  });
}

const PRESETS: Plan[] = [metro(), mall(), office(), gallery(), school(), blank()];

export function listPresets(): Plan[] {
  return PRESETS;
}

export function getPreset(id: string): Plan {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function ascii(cells: Uint8Array, cols: number, rows: number): string {
  const ch = [".", "#", "E", "X", "A"];
  let s = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) s += ch[cells[y * cols + x]] ?? "?";
    s += "\n";
  }
  return s;
}
