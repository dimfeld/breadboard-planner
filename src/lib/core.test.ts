import { describe, expect, test } from 'vitest';
import { parseNetlist } from './netlist/parse';
import { SAMPLE_555_KICAD_XML, TEXT_FORMAT_EXAMPLE } from './samples';
import { inferPackage, localPinOffsets } from './packages';
import { createProject, newPlacement, pinPositions, replaceNetlist, rotatePlacement } from './project';
import { analyze } from './connectivity';
import { boardHoles } from './boards';

describe('parseNetlist', () => {
  test('KiCad XML', () => {
    const nl = parseNetlist(SAMPLE_555_KICAD_XML);
    expect(nl.components.map((c) => c.ref)).toEqual(['C1', 'C2', 'D1', 'J1', 'R1', 'R2', 'R3', 'U1']);
    const u1 = nl.components.find((c) => c.ref === 'U1')!;
    expect(u1.pins).toHaveLength(8);
    expect(u1.pins[0]).toEqual({ num: '1', name: 'GND' });
    const r1 = nl.components.find((c) => c.ref === 'R1')!;
    expect(r1.pins.map((p) => p.name)).toEqual([undefined, undefined]);
    expect(nl.nets).toHaveLength(7);
    expect(nl.nets[0]).toEqual({
      name: '+5V',
      nodes: [
        { ref: 'J1', pin: '1' },
        { ref: 'U1', pin: '8' },
        { ref: 'U1', pin: '4' },
        { ref: 'R1', pin: '1' },
      ],
    });
  });

  test('KiCad S-expression', () => {
    const src = `(export (version "E")
      (components
        (comp (ref "U1") (value "LM358") (footprint "Package_DIP:DIP-8_W7.62mm")
          (libsource (lib "Amplifier_Operational") (part "LM358") (description "Dual op amp")))
        (comp (ref "R1") (value "10k") (footprint "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal")))
      (libparts
        (libpart (lib "Amplifier_Operational") (part "LM358")
          (pins (pin (num "1") (name "OUTA") (type "output")) (pin (num "8") (name "V+") (type "power_in")))))
      (nets
        (net (code "1") (name "VCC") (node (ref "U1") (pin "8") (pinfunction "V+")) (node (ref "R1") (pin "1")))
        (net (code "2") (name "/OUT") (node (ref "U1") (pin "1")) (node (ref "R1") (pin "2")))))`;
    const nl = parseNetlist(src);
    const u1 = nl.components.find((c) => c.ref === 'U1')!;
    expect(u1.value).toBe('LM358');
    expect(u1.description).toBe('Dual op amp');
    // Pins 2-7 come from the footprint pin count.
    expect(u1.pins.map((p) => p.num)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(u1.pins[7].name).toBe('V+');
    expect(nl.nets.map((n) => n.name)).toEqual(['VCC', '/OUT']);
  });

  test('JSON', () => {
    const nl = parseNetlist(
      JSON.stringify({
        components: [{ ref: 'U1', value: 'ATtiny85', footprint: 'DIP-8', pins: [{ num: 1, name: 'RESET' }] }],
        nets: [
          { name: 'VCC', nodes: ['U1.8', { ref: 'C1', pin: 1 }] },
          { name: 'GND', pins: ['U1-4', 'C1.2'] },
        ],
      }),
    );
    expect(nl.components.map((c) => c.ref)).toEqual(['C1', 'U1']);
    expect(nl.components[1].pins).toHaveLength(8);
    expect(nl.components[1].pins[0].name).toBe('RESET');
    expect(nl.nets[1].nodes).toEqual([
      { ref: 'U1', pin: '4' },
      { ref: 'C1', pin: '2' },
    ]);
  });

  test('text format', () => {
    const nl = parseNetlist(TEXT_FORMAT_EXAMPLE);
    expect(nl.components.find((c) => c.ref === 'U1')!.pins).toHaveLength(8);
    expect(nl.components.find((c) => c.ref === 'R1')!.value).toBe('10k');
    expect(nl.nets.map((n) => n.name)).toEqual(['VCC', 'GND', 'OUT']);
  });

  test('generic Eagle-like XML', () => {
    const src = `<?xml version="1.0"?>
      <eagle><drawing><schematic>
        <parts><part name="R1" value="1k" package="0207/10"/><part name="LED1" value="red"/></parts>
        <sheets><sheet><nets>
          <net name="N$1"><segment><pinref part="R1" gate="G$1" pin="2"/><pinref part="LED1" gate="G$1" pin="A"/></segment></net>
        </nets></sheet></sheets>
      </schematic></drawing></eagle>`;
    const nl = parseNetlist(src);
    expect(nl.components.map((c) => c.ref)).toEqual(['LED1', 'R1']);
    expect(nl.nets[0].nodes).toEqual([
      { ref: 'R1', pin: '2' },
      { ref: 'LED1', pin: 'A' },
    ]);
  });

  test('bad text gives a useful error', () => {
    expect(() => parseNetlist('hello world')).toThrow(/Line 1/);
  });
});

describe('packages', () => {
  test('infers packages from KiCad footprints', () => {
    const nl = parseNetlist(SAMPLE_555_KICAD_XML);
    const get = (ref: string) => inferPackage(nl.components.find((c) => c.ref === ref)!);
    expect(get('U1')).toEqual({ kind: 'dip', rowSpacing: 3 });
    expect(get('R1')).toEqual({ kind: 'leads', spacing: 4 });
    expect(get('C1')).toEqual({ kind: 'leads', spacing: 1 });
    expect(get('J1')).toEqual({ kind: 'sip' });
    expect(inferPackage({ ref: 'A1', footprint: 'Module:Arduino_Nano', pins: [] })).toEqual({
      kind: 'dip',
      rowSpacing: 6,
    });
  });

  test('DIP pin numbering goes counter-clockwise from bottom left', () => {
    expect(localPinOffsets({ kind: 'dip', rowSpacing: 3 }, 8)).toEqual([
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});

describe('connectivity', () => {
  function setup() {
    const nl = parseNetlist(TEXT_FORMAT_EXAMPLE);
    const project = createProject('t', nl);
    const board = project.layout.boards[0];
    board.vertical = false;
    board.x = 0;
    board.y = 0;
    return { nl, project, board };
  }

  test('breadboard strips connect five holes', () => {
    const { board } = setup();
    const holes = boardHoles(board);
    expect(holes).toHaveLength(830);
    const col0 = holes.filter((h) => h.group === `${board.id}:col0:top`);
    expect(col0.map((h) => h.label)).toEqual(['a1', 'b1', 'c1', 'd1', 'e1']);
  });

  test('net status, wires, and shorts', () => {
    const { nl, project } = setup();
    const u1 = nl.components.find((c) => c.ref === 'U1')!;
    const r1 = nl.components.find((c) => c.ref === 'R1')!;
    // U1 straddles the channel: top row on e (y=7), bottom row on f (y=10), columns 10-13.
    project.layout.placements.U1 = newPlacement(u1, project.packages.U1, 10, 7, 0);
    const pos = pinPositions(u1, project.packages.U1, project.layout.placements.U1);
    expect(pos['1']).toEqual({ x: 10, y: 10 });
    expect(pos['8']).toEqual({ x: 10, y: 7 });

    let a = analyze(project);
    expect(a.nets.get('VCC')!.state).toBe('partial');
    expect(a.nets.get('VCC')!.groups).toBe(2); // U1.8 and U1.4 are in different strips.
    expect(a.nets.get('GND')!.state).toBe('partial');
    expect(a.ratsnest.filter((l) => l.net === 'VCC')).toHaveLength(1);

    // R1 from U1.8's strip (column 10 top) to U1.3's strip... that would short VCC and OUT.
    project.layout.placements.R1 = newPlacement(r1, project.packages.R1, 10, 5, 0);
    project.layout.placements.R1.leads = { '1': { x: 10, y: 5 }, '2': { x: 12, y: 12 } };
    a = analyze(project);
    expect(a.shorts).toHaveLength(0);

    // Wire from U1.8 strip to U1.4 strip completes VCC (except R1.1 which is in U1.8 strip already).
    project.layout.wires.push({ id: 'w1', a: { x: 10, y: 4 }, b: { x: 13, y: 13 }, color: 'red' });
    a = analyze(project);
    expect(a.nets.get('VCC')!.state).toBe('complete');
    expect(a.netsAt({ x: 10, y: 3 })).toEqual(['VCC']);

    // A wire from VCC to GND makes a short.
    project.layout.wires.push({ id: 'w2', a: { x: 10, y: 3 }, b: { x: 10, y: 11 }, color: 'red' });
    a = analyze(project);
    expect(a.nets.get('VCC')!.state).toBe('short');
    expect(a.nets.get('GND')!.shortedWith).toEqual(['VCC']);
    expect(a.warnings.some((w) => w.kind === 'short')).toBe(true);
  });

  test('rotating flexible leads keeps their shape', () => {
    const { nl, project } = setup();
    const r1 = nl.components.find((c) => c.ref === 'R1')!;
    const p = newPlacement(r1, project.packages.R1, 5, 5, 0);
    expect(pinPositions(r1, project.packages.R1, p)).toEqual({ '1': { x: 5, y: 5 }, '2': { x: 9, y: 5 } });
    const rotated = rotatePlacement(r1, project.packages.R1, p);
    expect(pinPositions(r1, project.packages.R1, rotated)).toEqual({ '1': { x: 5, y: 5 }, '2': { x: 5, y: 9 } });
  });

  test('replacing the netlist keeps placements', () => {
    const { nl, project } = setup();
    const u1 = nl.components.find((c) => c.ref === 'U1')!;
    project.layout.placements.U1 = newPlacement(u1, project.packages.U1, 10, 7, 0);
    project.layout.placements.D1 = newPlacement(
      nl.components.find((c) => c.ref === 'D1')!,
      project.packages.D1,
      20,
      3,
      0,
    );
    project.progress.components.U1 = true;
    const next = replaceNetlist(project, parseNetlist('part U1 NE555 DIP-8\nVCC: U1.8 U1.4\n'));
    expect(Object.keys(next.layout.placements)).toEqual(['U1']);
    expect(next.progress.components).toEqual({ U1: true });
  });
});

import { resistorBands, parseResistance } from './visual';
describe('resistor color code', () => {
  test('parses values', () => {
    expect(parseResistance('4k7')).toBeCloseTo(4700);
    expect(parseResistance('2.2M')).toBeCloseTo(2.2e6);
    expect(parseResistance('330R')).toBe(330);
    expect(parseResistance('LED')).toBeUndefined();
  });
  test('bands', () => {
    // 10k: brown black orange gold
    expect(resistorBands('10k')).toEqual(['#7a4a21', '#1b1b1b', '#f08a24', '#c9a43a']);
    // 330: orange orange brown gold
    expect(resistorBands('330')).toEqual(['#f08a24', '#f08a24', '#7a4a21', '#c9a43a']);
  });
});

import { boardBounds, toGlobal, type BoardInstance } from './boards';
import { setBoardOrientation, defaultRotation } from './project';
describe('vertical boards', () => {
  test('holes turn clockwise: column 1 at the top, strips run left to right', () => {
    const board: BoardInstance = { id: 'b', type: 'full', x: 20, y: 0, name: 'B', vertical: true };
    const holes = boardHoles(board);
    const a1 = holes.find((h) => h.label === 'a1')!;
    const a2 = holes.find((h) => h.label === 'a2')!;
    const e1 = holes.find((h) => h.label === 'e1')!;
    expect(a1).toMatchObject({ x: 17, y: 0 });
    expect(a2).toMatchObject({ x: 17, y: 1 });
    // a1..e1 are one strip, on one row of the vertical board.
    expect(e1).toMatchObject({ x: 13, y: 0, group: a1.group });
    expect(toGlobal(board, 0, 0)).toEqual({ x: 20, y: 0 });
    const bb = boardBounds(board);
    expect(bb.y1 - bb.y0).toBeGreaterThan(bb.x1 - bb.x0);
    expect(defaultRotation([board])).toBe(1);
  });

  test('changing orientation keeps every connection', () => {
    const nl = parseNetlist(SAMPLE_555_KICAD_XML);
    const project = createProject('t', nl);
    const board = project.layout.boards[0];
    board.vertical = false;
    board.x = 0;
    board.y = 0;
    const get = (ref: string) => nl.components.find((c) => c.ref === ref)!;
    project.layout.placements.U1 = newPlacement(get('U1'), project.packages.U1, 10, 7, 0);
    project.layout.placements.R1 = newPlacement(get('R1'), project.packages.R1, 6, 1, 0);
    project.layout.placements.R1.leads = { '1': { x: 6, y: 1 }, '2': { x: 11, y: 4 } };
    project.layout.wires.push({ id: 'w', a: { x: 10, y: 6 }, b: { x: 10, y: 1 }, color: 'red' });
    const before = [...analyze(project).nets.values()].map((n) => [n.name, n.state, n.groups]);

    setBoardOrientation(project, board.id, true);
    expect(board.vertical).toBe(true);
    expect(project.layout.placements.U1.rotation).toBe(1);
    const after = analyze(project);
    expect([...after.nets.values()].map((n) => [n.name, n.state, n.groups])).toEqual(before);
    expect(after.warnings).toEqual([]);

    setBoardOrientation(project, board.id, false);
    expect(project.layout.placements.U1).toMatchObject({ x: 10, y: 7, rotation: 0 });
    expect(project.layout.wires[0].a).toEqual({ x: 10, y: 6 });
  });
});
