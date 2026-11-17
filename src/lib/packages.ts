import type { Component } from './netlist/types';

export interface Point {
  x: number;
  y: number;
}

/**
 * How a component sits on the breadboard. All distances are in grid units
 * (one unit = 0.1 inch = 2.54 mm).
 *
 * - dip: two rigid rows of pins, pin 1 at the bottom left (rotation 0), counted counter-clockwise.
 * - sip: one rigid row of pins (headers, modules, SIP resistor networks).
 * - leads: flexible leads. You can move each pin on its own (resistors, capacitors, LEDs, transistors).
 */
export type PackageSpec =
  | { kind: 'dip'; rowSpacing: number }
  | { kind: 'sip' }
  | { kind: 'leads'; spacing: number };

export type Rotation = 0 | 1 | 2 | 3;

export function footprintPinCount(footprint: string): number | undefined {
  const fp = footprint.toUpperCase();
  let m = /(?:DIP|SOIC|SOP|SSOP|TSSOP|PDIP|CDIP)-?(\d+)/.exec(fp);
  if (m) return parseInt(m[1], 10);
  m = /_(\d+)X(\d+)(?:_|$)/.exec(fp);
  if (m) return parseInt(m[1], 10) * parseInt(m[2], 10);
  m = /\b1X(\d+)\b/.exec(fp);
  if (m) return parseInt(m[1], 10);
  if (/TO-92|SOT-23(?!-)/.test(fp)) return 3;
  if (/TO-220-(\d+)/.test(fp)) return parseInt(/TO-220-(\d+)/.exec(fp)![1], 10);
  if (/TO-220/.test(fp)) return 3;
  return undefined;
}

function mmToUnits(mm: number): number {
  return Math.max(1, Math.round(mm / 2.54));
}

/** Guess a breadboard package from the footprint name, reference, and pin count. */
export function inferPackage(comp: Pick<Component, 'ref' | 'footprint' | 'pins'>): PackageSpec {
  const fp = comp.footprint;
  const n = comp.pins.length;
  const refPrefix = /^[A-Za-z]+/.exec(comp.ref)?.[0].toUpperCase() ?? '';

  if (/arduino_nano|arduino.*nano|pico|esp32.*devkit|wemos|d1_mini/i.test(fp)) {
    return { kind: 'dip', rowSpacing: 6 };
  }
  if (/DIP|PDIP|CDIP/i.test(fp)) {
    const w = /W(\d+(?:\.\d+)?)mm/i.exec(fp);
    return { kind: 'dip', rowSpacing: w ? mmToUnits(parseFloat(w[1])) : 3 };
  }
  if (/PinHeader_1x|PinSocket_1x|SIP|_1x\d+/i.test(fp)) return { kind: 'sip' };
  if (/TO-92|TO-220/i.test(fp)) return { kind: 'leads', spacing: 1 };

  const pitch = /P(\d+(?:\.\d+)?)mm/i.exec(fp);
  if (pitch && n <= 4) return { kind: 'leads', spacing: mmToUnits(parseFloat(pitch[1])) };

  if (n <= 4) {
    if (refPrefix === 'R') return { kind: 'leads', spacing: 4 };
    if (refPrefix === 'L') return { kind: 'leads', spacing: 4 };
    if (refPrefix === 'D' && !/LED/i.test(fp)) return { kind: 'leads', spacing: 4 };
    if (n === 2) return { kind: 'leads', spacing: 2 };
    return { kind: 'leads', spacing: 1 };
  }
  if (n % 2 === 0 && /^(U|IC|Q)$/.test(refPrefix)) return { kind: 'dip', rowSpacing: n >= 24 ? 6 : 3 };
  return { kind: 'sip' };
}

/** Pin offsets for a package in rotation 0, in the same order as the component pins. */
export function localPinOffsets(spec: PackageSpec, pinCount: number): Point[] {
  const out: Point[] = [];
  if (spec.kind === 'dip') {
    const half = Math.ceil(pinCount / 2);
    for (let i = 0; i < pinCount; i++) {
      if (i < half) out.push({ x: i, y: spec.rowSpacing });
      else out.push({ x: 2 * half - 1 - i, y: 0 });
    }
    return out;
  }
  const step = spec.kind === 'leads' && pinCount === 2 ? spec.spacing : 1;
  for (let i = 0; i < pinCount; i++) out.push({ x: i * step, y: 0 });
  return out;
}

export function rotatePoint(p: Point, rot: Rotation): Point {
  switch (rot) {
    case 0:
      return { x: p.x, y: p.y };
    case 1:
      return { x: -p.y, y: p.x };
    case 2:
      return { x: -p.x, y: -p.y };
    case 3:
      return { x: p.y, y: -p.x };
  }
}

export function packageLabel(spec: PackageSpec): string {
  switch (spec.kind) {
    case 'dip':
      return `DIP, ${(spec.rowSpacing / 10).toFixed(1)}" rows`;
    case 'sip':
      return 'Single row';
    case 'leads':
      return 'Flexible leads';
  }
}

export function samePackage(a: PackageSpec, b: PackageSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
