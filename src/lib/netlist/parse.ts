import { footprintPinCount } from '../packages';
import { type Component, type Net, type Netlist, type Pin, naturalCompare } from './types';
import { type El, child, children, descendants, field, parseSexpr, parseXml } from './tree';

export class NetlistParseError extends Error {}

/**
 * Parse a netlist in one of the supported formats:
 *
 * - KiCad XML netlist (`<export>` root)
 * - KiCad S-expression netlist (`(export ...)`)
 * - Generic XML with component and net elements (Eagle-like files work too)
 * - JSON (see README)
 * - Simple text: `part U1 NE555 DIP-8` and `NETNAME: U1.1 R1.2 ...` lines
 */
export function parseNetlist(src: string, filename = ''): Netlist {
  const text = src.replace(/^﻿/, '').trim();
  if (!text) throw new NetlistParseError('The netlist is empty.');

  let result: Netlist;
  if (text.startsWith('{') || text.startsWith('[')) {
    result = parseJsonNetlist(text);
  } else if (text.startsWith('<')) {
    const root = parseXml(text);
    const exp = root.children.find((c) => c.name === 'export');
    result = exp ? readKicad(exp, 'KiCad XML') : readGenericXml(root);
  } else if (text.startsWith('(')) {
    const root = parseSexpr(text);
    const exp = root.children.find((c) => c.name === 'export');
    if (!exp) throw new NetlistParseError('S-expression file has no (export ...) section.');
    result = readKicad(exp, 'KiCad');
  } else {
    result = parseTextNetlist(text);
  }

  if (filename) result.source = `${result.source} (${filename})`;
  return normalize(result);
}

function cleanPinName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const n = name.trim();
  if (!n || n === '~') return undefined;
  return n;
}

function readKicad(exp: El, source: string): Netlist {
  const libpartPins = new Map<string, Pin[]>();
  const libparts = child(exp, 'libparts');
  if (libparts) {
    for (const lp of children(libparts, 'libpart')) {
      const lib = field(lp, 'lib') ?? '';
      const part = field(lp, 'part') ?? '';
      const pinsEl = child(lp, 'pins');
      const pins: Pin[] = pinsEl
        ? children(pinsEl, 'pin').map((p) => ({
            num: field(p, 'num') ?? '',
            name: cleanPinName(field(p, 'name')),
          }))
        : [];
      libpartPins.set(`${lib}:${part}`, pins);
      const aliases = child(lp, 'aliases');
      if (aliases) {
        for (const a of children(aliases, 'alias')) libpartPins.set(`${lib}:${a.text}`, pins);
      }
    }
  }

  const components: Component[] = [];
  const compsEl = child(exp, 'components');
  for (const c of compsEl ? children(compsEl, 'comp') : []) {
    const ref = field(c, 'ref') ?? '';
    if (!ref) continue;
    const libsource = child(c, 'libsource');
    const lib = libsource ? field(libsource, 'lib') ?? '' : '';
    const part = libsource ? field(libsource, 'part') ?? '' : '';
    const description =
      field(c, 'description') ?? (libsource ? field(libsource, 'description') : undefined);
    components.push({
      ref,
      value: field(c, 'value') ?? '',
      footprint: field(c, 'footprint') ?? '',
      description: description || undefined,
      pins: (libpartPins.get(`${lib}:${part}`) ?? []).map((p) => ({ ...p })),
    });
  }

  const nets: Net[] = [];
  const pinNames = new Map<string, string>();
  const netsEl = child(exp, 'nets');
  for (const n of netsEl ? children(netsEl, 'net') : []) {
    const name = field(n, 'name') ?? `Net-${field(n, 'code') ?? nets.length + 1}`;
    const nodes = children(n, 'node')
      .map((node) => {
        const ref = field(node, 'ref') ?? '';
        const pin = field(node, 'pin') ?? '';
        const fn = cleanPinName(field(node, 'pinfunction'));
        if (fn) pinNames.set(`${ref}.${pin}`, fn);
        return { ref, pin };
      })
      .filter((x) => x.ref && x.pin);
    nets.push({ name, nodes });
  }

  // Newer KiCad versions put the pin function on the net node.
  for (const comp of components) {
    for (const p of comp.pins) {
      if (!p.name) p.name = pinNames.get(`${comp.ref}.${p.num}`);
    }
  }
  const result: Netlist = { source, components, nets };
  addPinNames(result, pinNames);
  return result;
}

function addPinNames(nl: Netlist, names: Map<string, string>) {
  const byRef = new Map(nl.components.map((c) => [c.ref, c]));
  for (const [key, name] of names) {
    const dot = key.lastIndexOf('.');
    const comp = byRef.get(key.slice(0, dot));
    const num = key.slice(dot + 1);
    if (!comp) continue;
    const pin = comp.pins.find((p) => p.num === num);
    if (pin) pin.name ??= name;
    else comp.pins.push({ num, name });
  }
}

const COMP_TAGS = new Set(['comp', 'component', 'part', 'instance', 'device']);
const NET_TAGS = new Set(['net', 'signal']);
const NODE_TAGS = new Set(['node', 'pinref', 'connector', 'pin', 'conn', 'contactref', 'connection']);

function firstField(el: El, names: string[]): string | undefined {
  for (const n of names) {
    const v = field(el, n);
    if (v) return v;
  }
  return undefined;
}

function readGenericXml(root: El): Netlist {
  const components: Component[] = [];
  const seen = new Set<string>();
  const nets: Net[] = [];

  walk(root, false);

  function walk(el: El, insideNet: boolean) {
    for (const c of el.children) {
      const tag = c.name.toLowerCase();
      if (!insideNet && COMP_TAGS.has(tag)) {
        const ref = firstField(c, ['ref', 'refdes', 'designator', 'name', 'id']);
        if (ref && !seen.has(ref)) {
          seen.add(ref);
          components.push({
            ref,
            value: firstField(c, ['value', 'val', 'partnumber', 'deviceset']) ?? '',
            footprint: firstField(c, ['footprint', 'package', 'pcbfootprint']) ?? '',
            pins: [],
          });
        }
        continue;
      }
      if (NET_TAGS.has(tag)) {
        const name = firstField(c, ['name', 'id', 'code']) ?? `Net-${nets.length + 1}`;
        const nodes: { ref: string; pin: string }[] = [];
        for (const tagName of NODE_TAGS) {
          for (const node of descendants(c, tagName)) {
            const ref = firstField(node, ['ref', 'part', 'component', 'refdes', 'element', 'device']);
            const pin = firstField(node, ['pin', 'pinnumber', 'number', 'num', 'pad']);
            if (ref && pin) nodes.push({ ref, pin });
            else if (node.text && /^[^.\s]+\.[^.\s]+$/.test(node.text)) {
              const [r, p] = splitRefPin(node.text);
              nodes.push({ ref: r, pin: p });
            }
          }
        }
        nets.push({ name, nodes });
        continue;
      }
      walk(c, insideNet);
    }
  }

  if (!nets.length) {
    throw new NetlistParseError('No nets found in the XML file. Expected <net> or <signal> elements.');
  }
  return { source: 'XML', components, nets };
}

function splitRefPin(s: string): [string, string] {
  // Accept "R1.2", "R1-2", "R1:2" and "R1/2".
  const m = /^(.+?)[.:/-]([^.:/-]+)$/.exec(s.trim());
  if (!m) throw new NetlistParseError(`Cannot read pin reference "${s}". Use the form REF.PIN, for example R1.2.`);
  return [m[1], m[2]];
}

interface JsonNetlist {
  components?: Array<{
    ref: string;
    value?: string;
    footprint?: string;
    description?: string;
    pins?: Array<string | number | { num: string | number; name?: string }>;
  }>;
  nets: Array<{
    name: string;
    nodes?: Array<string | { ref: string; pin: string | number }>;
    pins?: Array<string | { ref: string; pin: string | number }>;
  }>;
}

function parseJsonNetlist(text: string): Netlist {
  let data: JsonNetlist;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new NetlistParseError(`The JSON is not valid: ${(e as Error).message}`);
  }
  // A saved project file also contains a netlist.
  if (data && typeof data === 'object' && 'netlist' in data) {
    data = (data as unknown as { netlist: JsonNetlist }).netlist;
  }
  if (!data || !Array.isArray(data.nets)) throw new NetlistParseError('The JSON netlist must have a "nets" array.');

  const components: Component[] = (data.components ?? []).map((c) => ({
    ref: String(c.ref),
    value: c.value ?? '',
    footprint: c.footprint ?? '',
    description: c.description,
    pins: (c.pins ?? []).map((p) =>
      typeof p === 'object' ? { num: String(p.num), name: cleanPinName(p.name) } : { num: String(p) },
    ),
  }));
  const nets: Net[] = data.nets.map((n) => ({
    name: String(n.name),
    nodes: (n.nodes ?? n.pins ?? []).map((node) => {
      if (typeof node === 'string') {
        const [ref, pin] = splitRefPin(node);
        return { ref, pin };
      }
      return { ref: String(node.ref), pin: String(node.pin) };
    }),
  }));
  return { source: 'JSON', components, nets };
}

function parseTextNetlist(text: string): Netlist {
  const components: Component[] = [];
  const nets: Net[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.replace(/(^|\s)(#|\/\/).*$/, '').trim();
    if (!line) return;
    const partMatch = /^(?:part|comp|component)\s+(\S+)(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(.+))?$/i.exec(line);
    if (partMatch) {
      components.push({
        ref: partMatch[1],
        value: partMatch[2] ?? '',
        footprint: partMatch[3] ?? '',
        description: partMatch[4],
        pins: [],
      });
      return;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) {
      throw new NetlistParseError(
        `Line ${idx + 1}: cannot read "${raw.trim()}". Use "NET: R1.1 U1.2" or "part R1 10k footprint".`,
      );
    }
    const name = line.slice(0, colon).trim();
    const nodes = line
      .slice(colon + 1)
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((tok) => {
        const [ref, pin] = splitRefPin(tok);
        return { ref, pin };
      });
    nets.push({ name, nodes });
  });
  if (!nets.length) throw new NetlistParseError('No nets found. Use lines like "VCC: U1.8 R1.1".');
  return { source: 'Text', components, nets };
}

/**
 * Make the netlist consistent: every node has a component, every component has
 * every pin that nets refer to, duplicate nodes are removed, and pins are sorted.
 */
export function normalize(nl: Netlist): Netlist {
  const byRef = new Map<string, Component>();
  for (const c of nl.components) {
    if (byRef.has(c.ref)) continue;
    byRef.set(c.ref, { ...c, pins: dedupePins(c.pins) });
  }

  const nets: Net[] = [];
  const usedNames = new Set<string>();
  for (const net of nl.nets) {
    const seen = new Set<string>();
    const nodes = net.nodes.filter((n) => {
      const k = `${n.ref}.${n.pin}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!nodes.length) continue;
    let name = net.name || `Net-${nets.length + 1}`;
    if (usedNames.has(name)) {
      let i = 2;
      while (usedNames.has(`${name}_${i}`)) i++;
      name = `${name}_${i}`;
    }
    usedNames.add(name);
    nets.push({ name, nodes });

    for (const node of nodes) {
      let comp = byRef.get(node.ref);
      if (!comp) {
        comp = { ref: node.ref, value: '', footprint: '', pins: [] };
        byRef.set(node.ref, comp);
      }
      if (!comp.pins.some((p) => p.num === node.pin)) comp.pins.push({ num: node.pin });
    }
  }

  // Fill in pins that the footprint has but that no net uses (for example NC pins on a DIP).
  for (const comp of byRef.values()) {
    const count = footprintPinCount(comp.footprint);
    if (count && comp.pins.every((p) => /^\d+$/.test(p.num))) {
      for (let i = 1; i <= count; i++) {
        if (!comp.pins.some((p) => p.num === String(i))) comp.pins.push({ num: String(i) });
      }
    }
    comp.pins.sort((a, b) => naturalCompare(a.num, b.num));
  }

  const components = [...byRef.values()].sort((a, b) => naturalCompare(a.ref, b.ref));
  return { source: nl.source, components, nets };
}

function dedupePins(pins: Pin[]): Pin[] {
  const out = new Map<string, Pin>();
  for (const p of pins) {
    if (!p.num) continue;
    const prev = out.get(p.num);
    if (!prev) out.set(p.num, { ...p });
    else if (!prev.name && p.name) prev.name = p.name;
  }
  return [...out.values()];
}
