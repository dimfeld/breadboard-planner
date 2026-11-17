import type { Point } from './packages';

export type BoardType = 'full' | 'half' | 'mini';

export interface BoardInstance {
  id: string;
  type: BoardType;
  /** Global grid position of the hole in the top-left terminal column of the board. */
  x: number;
  y: number;
  name: string;
}

export interface RailDef {
  ly: number;
  polarity: '+' | '-';
  side: 'top' | 'bottom';
}

export interface BoardDef {
  type: BoardType;
  label: string;
  columns: number;
  /** Local y of terminal rows a..j. */
  rowY: number[];
  rails: RailDef[];
  /** Local x of rail holes. */
  railX: number[];
  /** Board outline in local grid units. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Local y of the center channel. */
  channelY: number;
}

export const ROW_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

function railX(groups: number, start: number): number[] {
  const out: number[] = [];
  for (let g = 0; g < groups; g++) for (let k = 0; k < 5; k++) out.push(start + g * 6 + k);
  return out;
}

function withRails(type: BoardType, label: string, columns: number, groups: number, start: number): BoardDef {
  return {
    type,
    label,
    columns,
    rowY: [3, 4, 5, 6, 7, 10, 11, 12, 13, 14],
    rails: [
      { ly: 0, polarity: '-', side: 'top' },
      { ly: 1, polarity: '+', side: 'top' },
      { ly: 16, polarity: '+', side: 'bottom' },
      { ly: 17, polarity: '-', side: 'bottom' },
    ],
    railX: railX(groups, start),
    bounds: { x0: -1.6, y0: -1.4, x1: columns - 1 + 1.6, y1: 18.4 },
    channelY: 8.5,
  };
}

export const BOARD_DEFS: Record<BoardType, BoardDef> = {
  full: withRails('full', 'Full size (830 points)', 63, 10, 2),
  half: withRails('half', 'Half size (400 points)', 30, 5, 1),
  mini: {
    type: 'mini',
    label: 'Mini (170 points)',
    columns: 17,
    rowY: [0, 1, 2, 3, 4, 7, 8, 9, 10, 11],
    rails: [],
    railX: [],
    bounds: { x0: -1.6, y0: -1.4, x1: 17.6, y1: 12.4 },
    channelY: 5.5,
  },
};

export interface HoleInfo {
  key: string;
  x: number;
  y: number;
  boardId: string;
  /** Human readable hole name, for example "e12" or "top + rail". */
  label: string;
  /** Holes with the same group are connected inside the breadboard. */
  group: string;
}

export function pointKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function boardHoles(board: BoardInstance): HoleInfo[] {
  const def = BOARD_DEFS[board.type];
  const out: HoleInfo[] = [];
  for (let c = 0; c < def.columns; c++) {
    def.rowY.forEach((ly, r) => {
      const half = r < 5 ? 'top' : 'bottom';
      const x = board.x + c;
      const y = board.y + ly;
      out.push({
        key: `${x},${y}`,
        x,
        y,
        boardId: board.id,
        label: `${ROW_NAMES[r]}${c + 1}`,
        group: `${board.id}:col${c}:${half}`,
      });
    });
  }
  for (const rail of def.rails) {
    def.railX.forEach((lx, i) => {
      const x = board.x + lx;
      const y = board.y + rail.ly;
      out.push({
        key: `${x},${y}`,
        x,
        y,
        boardId: board.id,
        label: `${rail.side} ${rail.polarity} rail #${i + 1}`,
        group: `${board.id}:rail:${rail.side}:${rail.polarity}`,
      });
    });
  }
  return out;
}

/** Map from point key to hole. When boards overlap, the first board wins. */
export function buildHoleMap(boards: BoardInstance[]): Map<string, HoleInfo> {
  const map = new Map<string, HoleInfo>();
  for (const b of boards) {
    for (const h of boardHoles(b)) if (!map.has(h.key)) map.set(h.key, h);
  }
  return map;
}

export function boardBounds(board: BoardInstance) {
  const d = BOARD_DEFS[board.type].bounds;
  return { x0: board.x + d.x0, y0: board.y + d.y0, x1: board.x + d.x1, y1: board.y + d.y1 };
}

export function pointOnBoard(board: BoardInstance, p: Point): boolean {
  const b = boardBounds(board);
  return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
}

/** A position below the existing boards for a new board. */
export function nextBoardPosition(boards: BoardInstance[]): Point {
  if (!boards.length) return { x: 0, y: 0 };
  let maxY = -Infinity;
  let minX = Infinity;
  for (const b of boards) {
    const bb = boardBounds(b);
    maxY = Math.max(maxY, bb.y1);
    minX = Math.min(minX, b.x);
  }
  return { x: minX, y: Math.ceil(maxY + 3 + 1.4) };
}
