import { type HoleInfo, buildHoleMap, pointKey } from './boards';
import type { Point } from './packages';
import { type Project, pinPositions } from './project';
import { pinKey } from './netlist/types';

class UnionFind {
  parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a);
    if (p === undefined) {
      this.parent.set(a, a);
      return a;
    }
    if (p === a) return a;
    const root = this.find(p);
    this.parent.set(a, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export type NetState = 'complete' | 'partial' | 'unplaced' | 'short';

export interface NetStatus {
  name: string;
  pins: string[];
  /** Pins that are placed in a breadboard hole. */
  placedPins: number;
  /** Number of separate connected groups among the placed pins. */
  groups: number;
  state: NetState;
  shortedWith: string[];
}

export interface Short {
  nets: string[];
  root: string;
}

export interface Warning {
  kind: 'short' | 'nc-short' | 'off-board' | 'shared-hole' | 'wire-off-board' | 'self-short';
  message: string;
  pins?: string[];
  points?: Point[];
}

export interface RatsLine {
  net: string;
  a: Point;
  b: Point;
}

export interface Analysis {
  holes: Map<string, HoleInfo>;
  pinPos: Map<string, Point>;
  netOfPin: Map<string, string>;
  nets: Map<string, NetStatus>;
  shorts: Short[];
  warnings: Warning[];
  ratsnest: RatsLine[];
  /** Nets that reach a point (through the breadboard strips, wires, and pins). */
  netsAt(p: Point): string[];
  /** Root id of the connected group at a point, or undefined when the point is not a hole. */
  rootAt(p: Point): string | undefined;
  /** All hole keys that are connected to a net. */
  holesOfNet(net: string): Set<string>;
}

export function analyze(project: Project): Analysis {
  const { netlist, layout, packages } = project;
  const holes = buildHoleMap(layout.boards);
  const uf = new UnionFind();
  const warnings: Warning[] = [];

  for (const h of holes.values()) uf.union(h.key, `g:${h.group}`);

  const pinsInHole = new Map<string, string[]>();
  const occupy = (holeKey: string, what: string) => {
    const list = pinsInHole.get(holeKey) ?? [];
    list.push(what);
    pinsInHole.set(holeKey, list);
  };

  for (const w of layout.wires) {
    const ha = holes.get(pointKey(w.a));
    const hb = holes.get(pointKey(w.b));
    if (ha) occupy(ha.key, 'a wire');
    if (hb) occupy(hb.key, 'a wire');
    if (ha && hb) uf.union(ha.key, hb.key);
    else warnings.push({ kind: 'wire-off-board', message: 'A wire end is not in a breadboard hole.', points: [w.a, w.b] });
  }

  const netOfPin = new Map<string, string>();
  for (const net of netlist.nets) for (const n of net.nodes) netOfPin.set(pinKey(n.ref, n.pin), net.name);

  const pinPos = new Map<string, Point>();
  for (const comp of netlist.components) {
    const placement = layout.placements[comp.ref];
    const pkg = packages[comp.ref];
    if (!placement || !pkg) continue;
    const pos = pinPositions(comp, pkg, placement);
    const offBoard: string[] = [];
    for (const pin of comp.pins) {
      const key = pinKey(comp.ref, pin.num);
      const pt = pos[pin.num];
      pinPos.set(key, pt);
      const hole = holes.get(pointKey(pt));
      if (hole) {
        uf.union(`pin:${key}`, hole.key);
        occupy(hole.key, key);
      } else if (netOfPin.has(key)) {
        offBoard.push(key);
      }
    }
    if (offBoard.length) {
      warnings.push({
        kind: 'off-board',
        message: `${comp.ref}: ${offBoard.length === 1 ? 'pin' : 'pins'} ${offBoard
          .map((k) => k.slice(comp.ref.length + 1))
          .join(', ')} not in a hole.`,
        pins: offBoard,
      });
    }
  }
  for (const [hk, list] of pinsInHole) {
    if (list.length > 1) {
      const h = holes.get(hk)!;
      warnings.push({
        kind: 'shared-hole',
        message: `${list.join(' and ')} use the same hole (${h.label}).`,
        pins: list.filter((x) => x !== 'a wire'),
        points: [{ x: h.x, y: h.y }],
      });
    }
  }

  const rootOfPin = (key: string): string | undefined => {
    const pt = pinPos.get(key);
    if (!pt || !holes.has(pointKey(pt))) return undefined;
    return uf.find(`pin:${key}`);
  };

  // Which nets reach each root.
  const rootNets = new Map<string, Set<string>>();
  for (const [key, net] of netOfPin) {
    const r = rootOfPin(key);
    if (!r) continue;
    let s = rootNets.get(r);
    if (!s) rootNets.set(r, (s = new Set()));
    s.add(net);
  }

  const shorts: Short[] = [];
  const shortWith = new Map<string, Set<string>>();
  for (const [root, nets] of rootNets) {
    if (nets.size > 1) {
      const list = [...nets].sort();
      shorts.push({ root, nets: list });
      for (const n of list) {
        let s = shortWith.get(n);
        if (!s) shortWith.set(n, (s = new Set()));
        for (const o of list) if (o !== n) s.add(o);
      }
      warnings.push({ kind: 'short', message: `Short circuit: ${list.join(', ')} are connected.` });
    }
  }

  // Pins with no net that touch a net.
  for (const comp of netlist.components) {
    for (const pin of comp.pins) {
      const key = pinKey(comp.ref, pin.num);
      if (netOfPin.has(key)) continue;
      const r = rootOfPin(key);
      const nets = r ? rootNets.get(r) : undefined;
      if (nets?.size) {
        warnings.push({
          kind: 'nc-short',
          message: `${key} has no net in the netlist but connects to ${[...nets].join(', ')}.`,
          pins: [key],
        });
      }
    }
  }

  const nets = new Map<string, NetStatus>();
  const ratsnest: RatsLine[] = [];
  for (const net of netlist.nets) {
    const pins = net.nodes.map((n) => pinKey(n.ref, n.pin));
    const byRoot = new Map<string, Point[]>();
    let placedPins = 0;
    for (const k of pins) {
      const r = rootOfPin(k);
      if (!r) continue;
      placedPins++;
      const list = byRoot.get(r) ?? [];
      list.push(pinPos.get(k)!);
      byRoot.set(r, list);
    }
    const groups = byRoot.size;
    const shortedWith = [...(shortWith.get(net.name) ?? [])].sort();
    let state: NetState;
    if (shortedWith.length) state = 'short';
    else if (placedPins === 0) state = 'unplaced';
    else if (placedPins === pins.length && groups === 1) state = 'complete';
    else state = 'partial';
    // A net with one pin is complete when that pin is placed.
    nets.set(net.name, { name: net.name, pins, placedPins, groups, state, shortedWith });
    ratsnest.push(...ratsLines(net.name, [...byRoot.values()]));
  }

  const holesOfNetCache = new Map<string, Set<string>>();

  return {
    holes,
    pinPos,
    netOfPin,
    nets,
    shorts,
    warnings,
    ratsnest,
    netsAt(p) {
      const k = pointKey(p);
      if (!holes.has(k)) return [];
      return [...(rootNets.get(uf.find(k)) ?? [])];
    },
    rootAt(p) {
      const k = pointKey(p);
      return holes.has(k) ? uf.find(k) : undefined;
    },
    holesOfNet(net) {
      let s = holesOfNetCache.get(net);
      if (s) return s;
      s = new Set();
      const roots = new Set<string>();
      for (const [r, ns] of rootNets) if (ns.has(net)) roots.add(r);
      for (const k of holes.keys()) if (roots.has(uf.find(k))) s.add(k);
      holesOfNetCache.set(net, s);
      return s;
    },
  };
}

function dist2(a: Point, b: Point) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** Minimum spanning tree between the separate groups of a net (Prim). */
function ratsLines(net: string, groups: Point[][]): RatsLine[] {
  if (groups.length < 2) return [];
  const out: RatsLine[] = [];
  const done: Point[] = [...groups[0]];
  const rest = groups.slice(1);
  while (rest.length) {
    let best = { d: Infinity, gi: 0, a: done[0], b: rest[0][0] };
    rest.forEach((g, gi) => {
      for (const a of done)
        for (const b of g) {
          const d = dist2(a, b);
          if (d < best.d) best = { d, gi, a, b };
        }
    });
    out.push({ net, a: best.a, b: best.b });
    done.push(...rest[best.gi]);
    rest.splice(best.gi, 1);
  }
  return out;
}
