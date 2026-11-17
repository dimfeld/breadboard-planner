# Breadboard Planner

A browser tool to plan and track breadboard builds from a netlist.

## Run

```sh
pnpm install
pnpm dev      # development server
pnpm test     # unit tests
pnpm check    # type check
pnpm build    # static build in dist/
```

## Modes

**Visual planner.** Put one or more breadboards (full, half, or mini) on a canvas. New boards are vertical (column 1
at the top, power rails on the sides). Select a board to change it to horizontal; the parts and wires on it turn with
it. Place parts from the parts list,
draw wires, and move each lead of resistors, capacitors, LEDs, and similar parts. The planner calculates the
connectivity of the breadboard strips, power rails, wires, and pins. It shows:

- net status (complete, partial, not placed, short circuit)
- dashed "missing connection" lines between the parts of a net that are not connected yet
- issues: shorts, pins that are not in a hole, two things in one hole, pins with no net that touch a net

Switch to **Build** (or press `B`) and click parts and wires to check them off as you put them on the real board.

**Checklist.** No layout. Check off each part when it is on the board and each pin when you connect it. View by part
(with a pin diagram for ICs) or by net. The "placed" check for a part is shared with the planner.

## Netlist formats

- KiCad netlist: the default S-expression `.net` file, or the KiCad XML export.
- Generic XML: `<net name>` elements with `<node ref pin>` children. Eagle `.sch` files (`<part>` and `<pinref>`) also work.
- JSON: `{ "components": [{ "ref", "value", "footprint", "pins" }], "nets": [{ "name", "nodes": ["U1.8", ...] }] }`
- Text: `part U1 NE555 DIP-8` lines and `NET: U1.8 R1.1` lines.

Use **Update netlist** to load a changed netlist. The layout stays for parts that are still in the netlist.

## Storage

Projects save automatically to the browser's localStorage. You can have many projects and switch between them in the
header. Use **Save file** and **Open file** to back up a project or move it to a different browser.

## Planner shortcuts

| Key | Action |
| --- | --- |
| `V` / `W` | Select tool / wire tool (shift-click to chain wires) |
| `R` | Rotate the selected part, or the part you are placing |
| `Delete` | Delete the selected wire, or remove the selected part from the plan |
| `Enter` / `X` | Toggle "done" for the selection |
| `B` | Toggle build mode |
| `F`, `+`, `-` | Fit, zoom in, zoom out |
| `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z` | Undo, redo |
| Space+drag, middle drag, scroll | Pan. Ctrl+scroll or pinch zooms. |
