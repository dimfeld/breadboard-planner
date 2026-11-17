import { type BoardInstance, BOARD_DEFS, pointOnBoard } from './boards';
import { type PackageSpec, type Point, type Rotation, inferPackage, localPinOffsets, rotatePoint } from './packages';
import type { Component, Netlist } from './netlist/types';

export interface Placement {
  ref: string;
  /** Anchor point for rigid packages. */
  x: number;
  y: number;
  rotation: Rotation;
  /** Explicit pin positions for packages with flexible leads, keyed by pin number. */
  leads?: Record<string, Point>;
}

export interface Wire {
  id: string;
  a: Point;
  b: Point;
  color: string;
}

export interface Layout {
  boards: BoardInstance[];
  placements: Record<string, Placement>;
  wires: Wire[];
}

export interface Progress {
  /** Component is on the board. Shared by the planner and the checklist. */
  components: Record<string, boolean>;
  /** Wire is on the board (planner). */
  wires: Record<string, boolean>;
  /** Pin is connected to its net (checklist), keyed by "REF.PIN". */
  pins: Record<string, boolean>;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  netlist: Netlist;
  packages: Record<string, PackageSpec>;
  layout: Layout;
  progress: Progress;
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function createProject(name: string, netlist: Netlist): Project {
  const packages: Record<string, PackageSpec> = {};
  for (const c of netlist.components) packages[c.ref] = inferPackage(c);
  const now = Date.now();
  return {
    version: 1,
    id: uid('p_'),
    name,
    createdAt: now,
    updatedAt: now,
    netlist,
    packages,
    layout: {
      boards: [{ id: uid('b_'), type: 'full', x: Math.ceil(BOARD_DEFS.full.bounds.y1), y: 0, name: 'Board 1', vertical: true }],
      placements: {},
      wires: [],
    },
    progress: { components: {}, wires: {}, pins: {} },
  };
}

/**
 * Replace the netlist of a project. Placements, packages, and progress stay for
 * components and pins that still exist.
 */
export function replaceNetlist(project: Project, netlist: Netlist): Project {
  const refs = new Set(netlist.components.map((c) => c.ref));
  const packages: Record<string, PackageSpec> = {};
  for (const c of netlist.components) {
    const old = project.packages[c.ref];
    const oldComp = project.netlist.components.find((o) => o.ref === c.ref);
    packages[c.ref] = old && oldComp && oldComp.pins.length === c.pins.length ? old : inferPackage(c);
  }

  const placements: Record<string, Placement> = {};
  for (const [ref, p] of Object.entries(project.layout.placements)) {
    if (!refs.has(ref)) continue;
    const comp = netlist.components.find((c) => c.ref === ref)!;
    const oldComp = project.netlist.components.find((c) => c.ref === ref);
    const pkg = packages[ref];
    if (pkg.kind === 'leads') {
      // Keep known lead positions, put new leads next to the anchor.
      const fresh = defaultPinPositions(comp, pkg, p.x, p.y, p.rotation);
      const leads: Record<string, Point> = {};
      for (const pin of comp.pins) leads[pin.num] = p.leads?.[pin.num] ?? fresh[pin.num];
      placements[ref] = { ...p, leads };
    } else if (oldComp && oldComp.pins.length === comp.pins.length) {
      placements[ref] = { ...p, leads: undefined };
    }
  }

  const pinKeys = new Set(netlist.components.flatMap((c) => c.pins.map((p) => `${c.ref}.${p.num}`)));
  const progress: Progress = {
    components: Object.fromEntries(Object.entries(project.progress.components).filter(([r]) => refs.has(r))),
    wires: project.progress.wires,
    pins: Object.fromEntries(Object.entries(project.progress.pins).filter(([k]) => pinKeys.has(k))),
  };

  return {
    ...project,
    updatedAt: Date.now(),
    netlist,
    packages,
    layout: { ...project.layout, placements },
    progress,
  };
}

export function defaultPinPositions(
  comp: Component,
  pkg: PackageSpec,
  x: number,
  y: number,
  rotation: Rotation,
): Record<string, Point> {
  const offsets = localPinOffsets(pkg, comp.pins.length);
  const out: Record<string, Point> = {};
  comp.pins.forEach((pin, i) => {
    const r = rotatePoint(offsets[i], rotation);
    out[pin.num] = { x: x + r.x, y: y + r.y };
  });
  return out;
}

/** Global grid position of every pin of a placed component, keyed by pin number. */
export function pinPositions(comp: Component, pkg: PackageSpec, placement: Placement): Record<string, Point> {
  if (pkg.kind === 'leads' && placement.leads) {
    const fresh = defaultPinPositions(comp, pkg, placement.x, placement.y, placement.rotation);
    const out: Record<string, Point> = {};
    for (const pin of comp.pins) out[pin.num] = placement.leads[pin.num] ?? fresh[pin.num];
    return out;
  }
  return defaultPinPositions(comp, pkg, placement.x, placement.y, placement.rotation);
}

export function newPlacement(comp: Component, pkg: PackageSpec, x: number, y: number, rotation: Rotation): Placement {
  const p: Placement = { ref: comp.ref, x, y, rotation };
  if (pkg.kind === 'leads') p.leads = defaultPinPositions(comp, pkg, x, y, rotation);
  return p;
}

/** Rotate a placement by one quarter turn clockwise around its anchor. */
export function rotatePlacement(comp: Component, pkg: PackageSpec, placement: Placement): Placement {
  const rotation = ((placement.rotation + 1) % 4) as Rotation;
  if (pkg.kind === 'leads' && placement.leads) {
    const leads: Record<string, Point> = {};
    for (const [num, pt] of Object.entries(pinPositions(comp, pkg, placement))) {
      const r = rotatePoint({ x: pt.x - placement.x, y: pt.y - placement.y }, 1);
      leads[num] = { x: placement.x + r.x, y: placement.y + r.y };
    }
    return { ...placement, rotation, leads };
  }
  return { ...placement, rotation };
}

export function movePlacement(placement: Placement, dx: number, dy: number): Placement {
  const leads = placement.leads
    ? Object.fromEntries(Object.entries(placement.leads).map(([k, p]) => [k, { x: p.x + dx, y: p.y + dy }]))
    : undefined;
  return { ...placement, x: placement.x + dx, y: placement.y + dy, leads };
}

export const WIRE_COLORS: { name: string; value: string }[] = [
  { name: 'Red', value: '#e5484d' },
  { name: 'Black', value: '#2b2b2b' },
  { name: 'Blue', value: '#3e7bfa' },
  { name: 'Green', value: '#30a46c' },
  { name: 'Yellow', value: '#f5c518' },
  { name: 'Orange', value: '#f76b15' },
  { name: 'White', value: '#e8e8e8' },
  { name: 'Purple', value: '#8e4ec6' },
];

/** Suggest a wire color from the net name. */
export function colorForNet(netName: string | undefined): string | undefined {
  if (!netName) return undefined;
  const n = netName.toUpperCase().replace(/^\//, '');
  if (/^(GND|VSS|0V|AGND|DGND|GNDA|GNDD)/.test(n)) return '#2b2b2b';
  if (/^(VCC|VDD|\+?\d+V\d*|\+?\d+V|V\+|VBAT|VIN|\+\d)/.test(n)) return '#e5484d';
  return undefined;
}

/**
 * Default rotation for a new part. On a vertical board the strips run left to right, so parts
 * must turn a quarter turn to straddle the channel and to span strips.
 */
export function defaultRotation(boards: BoardInstance[], at?: Point): Rotation {
  const board = (at && boards.find((b) => pointOnBoard(b, at))) ?? boards[0];
  return board?.vertical ? 1 : 0;
}

/** Parts and wires that are fully on a board. They move and turn with it. */
export function boardContents(project: Project, id: string): { refs: string[]; wires: string[] } {
  const board = project.layout.boards.find((b) => b.id === id);
  if (!board) return { refs: [], wires: [] };
  const refs: string[] = [];
  for (const comp of project.netlist.components) {
    const pl = project.layout.placements[comp.ref];
    const pkg = project.packages[comp.ref];
    if (!pl || !pkg) continue;
    const pins = Object.values(pinPositions(comp, pkg, pl));
    if (pins.length && pins.every((pt) => pointOnBoard(board, pt))) refs.push(comp.ref);
  }
  const wires = project.layout.wires
    .filter((w) => pointOnBoard(board, w.a) && pointOnBoard(board, w.b))
    .map((w) => w.id);
  return { refs, wires };
}

/**
 * Change the orientation of a board. The parts and wires on the board turn with it around the
 * board origin, so every pin stays in the same hole.
 */
export function setBoardOrientation(project: Project, id: string, vertical: boolean) {
  const board = project.layout.boards.find((b) => b.id === id);
  if (!board || !!board.vertical === vertical) return;
  const { refs, wires } = boardContents(project, id);
  // Clockwise (horizontal to vertical) or counter-clockwise (vertical to horizontal).
  const turn: Rotation = vertical ? 1 : 3;
  const o = { x: board.x, y: board.y };
  const turnPoint = (p: Point): Point => {
    const r = rotatePoint({ x: p.x - o.x, y: p.y - o.y }, turn);
    return { x: o.x + r.x, y: o.y + r.y };
  };

  for (const ref of refs) {
    const pl = project.layout.placements[ref];
    const anchor = turnPoint({ x: pl.x, y: pl.y });
    const next: Placement = { ...pl, x: anchor.x, y: anchor.y, rotation: ((pl.rotation + turn) % 4) as Rotation };
    if (pl.leads) next.leads = Object.fromEntries(Object.entries(pl.leads).map(([k, p]) => [k, turnPoint(p)]));
    project.layout.placements[ref] = next;
  }
  for (const w of project.layout.wires) {
    if (!wires.includes(w.id)) continue;
    w.a = turnPoint(w.a);
    w.b = turnPoint(w.b);
  }
  board.vertical = vertical;
}
