import { analyze, type Analysis } from './connectivity';
import { type BoardInstance, type BoardType, nextBoardPosition, pointOnBoard, boardBounds } from './boards';
import type { Netlist } from './netlist/types';
import type { PackageSpec, Point, Rotation } from './packages';
import {
  type Layout,
  type Placement,
  type Project,
  type Wire,
  colorForNet,
  createProject,
  movePlacement,
  newPlacement,
  pinPositions,
  replaceNetlist,
  rotatePlacement,
  uid,
  WIRE_COLORS,
} from './project';

const INDEX_KEY = 'bbp:index';
const CURRENT_KEY = 'bbp:current';
const projectKey = (id: string) => `bbp:project:${id}`;

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export type Selection =
  | { kind: 'component'; ref: string }
  | { kind: 'wire'; id: string }
  | { kind: 'board'; id: string }
  | null;

export type Mode = 'planner' | 'checklist';
export type Tool = 'select' | 'wire';

function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Could not save to localStorage', e);
  }
}

interface Snapshot {
  layout: Layout;
  packages: Record<string, PackageSpec>;
}

class AppStore {
  projects = $state<ProjectSummary[]>([]);
  project = $state<Project | null>(null);
  mode = $state<Mode>('planner');

  // Planner UI state
  selection = $state<Selection>(null);
  tool = $state<Tool>('select');
  wireColor = $state<string>('auto');
  buildMode = $state(false);
  highlightNet = $state<string | null>(null);
  placing = $state<{ ref: string; rotation: Rotation } | null>(null);
  showRatsnest = $state(true);

  #undo: string[] = [];
  #redo: string[] = [];
  undoCount = $state(0);
  redoCount = $state(0);

  analysis: Analysis | null = $derived(this.project ? analyze(this.project) : null);

  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  init() {
    this.projects = readJson<ProjectSummary[]>(INDEX_KEY) ?? [];
    const current = readJson<string>(CURRENT_KEY);
    const id = current && this.projects.some((p) => p.id === current) ? current : this.projects[0]?.id;
    if (id) this.open(id);

    $effect.root(() => {
      $effect(() => {
        const p = this.project;
        if (!p) return;
        // Read deeply so that any change schedules a save.
        const json = JSON.stringify(p);
        clearTimeout(this.#saveTimer);
        this.#saveTimer = setTimeout(() => this.#persist(p.id, json), 250);
      });
    });

    window.addEventListener('beforeunload', () => {
      if (this.project) this.#persist(this.project.id, JSON.stringify(this.project));
    });
  }

  #persist(id: string, json: string) {
    try {
      localStorage.setItem(projectKey(id), json);
    } catch (e) {
      console.error('Could not save project', e);
    }
    const p = JSON.parse(json) as Project;
    const summary = { id, name: p.name, updatedAt: p.updatedAt };
    const idx = this.projects.findIndex((x) => x.id === id);
    if (idx >= 0) this.projects[idx] = summary;
    else this.projects.push(summary);
    writeJson(INDEX_KEY, $state.snapshot(this.projects));
    writeJson(CURRENT_KEY, id);
  }

  #resetUi() {
    this.selection = null;
    this.placing = null;
    this.highlightNet = null;
    this.tool = 'select';
    this.#undo = [];
    this.#redo = [];
    this.undoCount = 0;
    this.redoCount = 0;
  }

  open(id: string) {
    const p = readJson<Project>(projectKey(id));
    if (!p) {
      this.projects = this.projects.filter((x) => x.id !== id);
      writeJson(INDEX_KEY, this.projects);
      return;
    }
    this.#resetUi();
    this.project = p;
    writeJson(CURRENT_KEY, id);
  }

  addProject(p: Project) {
    this.#resetUi();
    this.project = p;
    this.#persist(p.id, JSON.stringify(p));
  }

  newProject(name: string, netlist: Netlist) {
    this.addProject(createProject(name, netlist));
  }

  replaceNetlist(netlist: Netlist) {
    if (!this.project) return;
    this.checkpoint();
    const next = replaceNetlist($state.snapshot(this.project) as Project, netlist);
    this.project = next;
    this.selection = null;
    this.placing = null;
  }

  deleteProject(id: string) {
    localStorage.removeItem(projectKey(id));
    this.projects = this.projects.filter((x) => x.id !== id);
    writeJson(INDEX_KEY, $state.snapshot(this.projects));
    if (this.project?.id === id) {
      this.project = null;
      const next = this.projects[0];
      if (next) this.open(next.id);
      else localStorage.removeItem(CURRENT_KEY);
    }
  }

  touch() {
    if (this.project) this.project.updatedAt = Date.now();
  }

  // ---- Undo ---------------------------------------------------------------

  #snapshot(): string {
    const p = this.project!;
    return JSON.stringify({ layout: p.layout, packages: p.packages } satisfies Snapshot);
  }

  /** Call before a change to the layout or packages so that it can be undone. */
  checkpoint() {
    if (!this.project) return;
    this.#undo.push(this.#snapshot());
    if (this.#undo.length > 200) this.#undo.shift();
    this.#redo = [];
    this.undoCount = this.#undo.length;
    this.redoCount = 0;
    this.touch();
  }

  #restore(s: string) {
    const snap = JSON.parse(s) as Snapshot;
    this.project!.layout = snap.layout;
    this.project!.packages = snap.packages;
    this.#validateSelection();
  }

  undo() {
    if (!this.project || !this.#undo.length) return;
    this.#redo.push(this.#snapshot());
    this.#restore(this.#undo.pop()!);
    this.undoCount = this.#undo.length;
    this.redoCount = this.#redo.length;
  }

  redo() {
    if (!this.project || !this.#redo.length) return;
    this.#undo.push(this.#snapshot());
    this.#restore(this.#redo.pop()!);
    this.undoCount = this.#undo.length;
    this.redoCount = this.#redo.length;
  }

  #validateSelection() {
    const s = this.selection;
    const l = this.project?.layout;
    if (!s || !l) return;
    if (s.kind === 'wire' && !l.wires.some((w) => w.id === s.id)) this.selection = null;
    if (s.kind === 'board' && !l.boards.some((b) => b.id === s.id)) this.selection = null;
  }

  // ---- Lookups ------------------------------------------------------------

  component(ref: string) {
    return this.project?.netlist.components.find((c) => c.ref === ref);
  }

  // ---- Boards -------------------------------------------------------------

  addBoard(type: BoardType) {
    const p = this.project;
    if (!p) return;
    this.checkpoint();
    const pos = nextBoardPosition(p.layout.boards);
    const board: BoardInstance = { id: uid('b_'), type, x: pos.x, y: pos.y, name: `Board ${p.layout.boards.length + 1}` };
    p.layout.boards.push(board);
    this.selection = { kind: 'board', id: board.id };
  }

  deleteBoard(id: string) {
    const p = this.project;
    if (!p) return;
    this.checkpoint();
    p.layout.boards = p.layout.boards.filter((b) => b.id !== id);
    this.#validateSelection();
  }

  /** Things on a board that move with it. */
  boardContents(id: string): { refs: string[]; wires: string[] } {
    const p = this.project!;
    const board = p.layout.boards.find((b) => b.id === id);
    if (!board) return { refs: [], wires: [] };
    const refs: string[] = [];
    for (const comp of p.netlist.components) {
      const pl = p.layout.placements[comp.ref];
      if (!pl) continue;
      const pins = Object.values(pinPositions(comp, p.packages[comp.ref], pl));
      if (pins.length && pins.every((pt) => pointOnBoard(board, pt))) refs.push(comp.ref);
    }
    const wires = p.layout.wires.filter((w) => pointOnBoard(board, w.a) && pointOnBoard(board, w.b)).map((w) => w.id);
    return { refs, wires };
  }

  // ---- Components ---------------------------------------------------------

  startPlacing(ref: string) {
    this.placing = { ref, rotation: 0 };
    this.tool = 'select';
    this.selection = { kind: 'component', ref };
  }

  place(ref: string, at: Point, rotation: Rotation = 0) {
    const p = this.project;
    const comp = this.component(ref);
    if (!p || !comp) return;
    this.checkpoint();
    p.layout.placements[ref] = newPlacement(comp, p.packages[ref], at.x, at.y, rotation);
    this.selection = { kind: 'component', ref };
  }

  unplace(ref: string) {
    const p = this.project;
    if (!p?.layout.placements[ref]) return;
    this.checkpoint();
    delete p.layout.placements[ref];
  }

  rotate(ref: string) {
    const p = this.project;
    const comp = this.component(ref);
    const pl = p?.layout.placements[ref];
    if (!p || !comp || !pl) return;
    this.checkpoint();
    p.layout.placements[ref] = rotatePlacement(comp, p.packages[ref], $state.snapshot(pl) as Placement);
  }

  setPackage(ref: string, pkg: PackageSpec) {
    const p = this.project;
    const comp = this.component(ref);
    if (!p || !comp) return;
    this.checkpoint();
    p.packages[ref] = pkg;
    const pl = p.layout.placements[ref];
    if (pl) p.layout.placements[ref] = newPlacement(comp, pkg, pl.x, pl.y, pl.rotation);
  }

  /** Move without a checkpoint. Use during a drag after one checkpoint. */
  setPlacement(ref: string, placement: Placement) {
    if (this.project) this.project.layout.placements[ref] = placement;
  }

  moveBy(ref: string, dx: number, dy: number) {
    const pl = this.project?.layout.placements[ref];
    if (pl) this.project!.layout.placements[ref] = movePlacement($state.snapshot(pl) as Placement, dx, dy);
  }

  // ---- Wires --------------------------------------------------------------

  #autoColorIndex = 2;

  wireColorFor(a: Point): string {
    if (this.wireColor !== 'auto') return this.wireColor;
    const nets = this.analysis?.netsAt(a) ?? [];
    const c = colorForNet(nets[0]);
    if (c) return c;
    const palette = WIRE_COLORS.filter((w) => w.name !== 'Red' && w.name !== 'Black');
    return palette[this.#autoColorIndex++ % palette.length].value;
  }

  addWire(a: Point, b: Point) {
    const p = this.project;
    if (!p || (a.x === b.x && a.y === b.y)) return;
    this.checkpoint();
    const wire: Wire = { id: uid('w_'), a, b, color: this.wireColorFor(a) };
    p.layout.wires.push(wire);
    return wire;
  }

  deleteWire(id: string) {
    const p = this.project;
    if (!p) return;
    this.checkpoint();
    p.layout.wires = p.layout.wires.filter((w) => w.id !== id);
    delete p.progress.wires[id];
    if (this.selection?.kind === 'wire' && this.selection.id === id) this.selection = null;
  }

  setWireColor(id: string, color: string) {
    const w = this.project?.layout.wires.find((x) => x.id === id);
    if (!w) return;
    this.checkpoint();
    w.color = color;
  }

  // ---- Progress -----------------------------------------------------------

  toggleComponentDone(ref: string, value?: boolean) {
    const p = this.project;
    if (!p) return;
    p.progress.components[ref] = value ?? !p.progress.components[ref];
    this.touch();
  }

  toggleWireDone(id: string, value?: boolean) {
    const p = this.project;
    if (!p) return;
    p.progress.wires[id] = value ?? !p.progress.wires[id];
    this.touch();
  }

  togglePinDone(key: string, value?: boolean) {
    const p = this.project;
    if (!p) return;
    p.progress.pins[key] = value ?? !p.progress.pins[key];
    this.touch();
  }

  resetPlannerProgress() {
    const p = this.project;
    if (!p) return;
    p.progress.components = {};
    p.progress.wires = {};
    this.touch();
  }

  resetChecklistProgress() {
    const p = this.project;
    if (!p) return;
    p.progress.components = {};
    p.progress.pins = {};
    this.touch();
  }

  /** Bounds of everything on the canvas, in grid units. */
  contentBounds() {
    const p = this.project;
    if (!p) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const add = (x: number, y: number) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    };
    for (const b of p.layout.boards) {
      const bb = boardBounds(b);
      add(bb.x0, bb.y0 - 1.5);
      add(bb.x1, bb.y1);
    }
    if (this.analysis) for (const pt of this.analysis.pinPos.values()) add(pt.x, pt.y);
    for (const w of p.layout.wires) {
      add(w.a.x, w.a.y);
      add(w.b.x, w.b.y);
    }
    if (!Number.isFinite(x0)) return { x0: -5, y0: -5, x1: 60, y1: 20 };
    return { x0, y0, x1, y1 };
  }
}

export const store = new AppStore();
