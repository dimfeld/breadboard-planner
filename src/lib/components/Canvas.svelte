<script lang="ts">
  import { store } from '../store.svelte';
  import BoardView from './BoardView.svelte';
  import PartShape from './PartShape.svelte';
  import { type BoardInstance, pointKey } from '../boards';
  import type { Point } from '../packages';
  import { type Placement, type Wire, movePlacement, newPlacement } from '../project';

  let svg: SVGSVGElement;
  let width = $state(800);
  let height = $state(600);
  let view = $state({ tx: 60, ty: 60, z: 16 });
  let hover = $state<Point | null>(null);
  let cursor = $state<{ x: number; y: number } | null>(null);
  let wireStart = $state<Point | null>(null);
  let panning = $state(false);
  let spaceDown = $state(false);

  type Drag =
    | { type: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean; deselect: boolean }
    | { type: 'component'; ref: string; start: Point; orig: Placement; moved: boolean }
    | { type: 'lead'; ref: string; pin: string; moved: boolean }
    | { type: 'wire'; id: string; start: Point; orig: Wire; moved: boolean }
    | { type: 'wire-end'; id: string; end: 'a' | 'b'; moved: boolean }
    | {
        type: 'board';
        id: string;
        start: Point;
        orig: BoardInstance;
        placements: Record<string, Placement>;
        wires: Record<string, Wire>;
        moved: boolean;
      };
  let drag: Drag | null = $state(null);

  const project = $derived(store.project!);
  const analysis = $derived(store.analysis!);
  const layout = $derived(project.layout);

  const placed = $derived(
    project.netlist.components
      .filter((c) => layout.placements[c.ref] && project.packages[c.ref])
      .map((c) => ({ comp: c, pkg: project.packages[c.ref], placement: layout.placements[c.ref] })),
  );

  const ghost = $derived.by(() => {
    const pl = store.placing;
    if (!pl || !hover) return null;
    const comp = store.component(pl.ref);
    if (!comp) return null;
    const pkg = project.packages[pl.ref];
    return { comp, pkg, placement: newPlacement(comp, pkg, hover.x, hover.y, pl.rotation) };
  });

  // Pins at each point, for hover info.
  const pinsAt = $derived.by(() => {
    const m = new Map<string, string[]>();
    for (const [k, pt] of analysis.pinPos) {
      const key = pointKey(pt);
      const list = m.get(key) ?? [];
      list.push(k);
      m.set(key, list);
    }
    return m;
  });

  const hoverHole = $derived(hover ? analysis.holes.get(pointKey(hover)) : undefined);
  const hoverGroup = $derived.by(() => {
    if (!hover || !hoverHole) return [];
    const root = analysis.rootAt(hover);
    const out: Point[] = [];
    for (const h of analysis.holes.values()) if (analysis.rootAt(h) === root) out.push(h);
    return out;
  });
  const hoverNets = $derived(hover ? analysis.netsAt(hover) : []);
  const hoverPins = $derived(hover ? (pinsAt.get(pointKey(hover)) ?? []) : []);

  const netHoles = $derived.by(() => {
    if (!store.highlightNet) return [];
    const keys = analysis.holesOfNet(store.highlightNet);
    return [...keys].map((k) => analysis.holes.get(k)!);
  });
  const netPins = $derived.by(() => {
    const net = store.highlightNet;
    if (!net) return [];
    const out: Point[] = [];
    for (const [k, n] of analysis.netOfPin) if (n === net && analysis.pinPos.has(k)) out.push(analysis.pinPos.get(k)!);
    return out;
  });

  const problemPoints = $derived.by(() => {
    const out: Point[] = [];
    for (const w of analysis.warnings) {
      if (w.kind === 'short') continue;
      for (const k of w.pins ?? []) {
        const p = analysis.pinPos.get(k);
        if (p) out.push(p);
      }
      if (w.kind !== 'wire-off-board') for (const p of w.points ?? []) out.push(p);
    }
    for (const s of analysis.shorts) {
      for (const [k, net] of analysis.netOfPin) {
        if (!s.nets.includes(net)) continue;
        const p = analysis.pinPos.get(k);
        if (p && analysis.rootAt(p) === s.root) out.push(p);
      }
    }
    return out;
  });

  const ratsnest = $derived(
    store.showRatsnest && !store.buildMode
      ? analysis.ratsnest
      : store.highlightNet
        ? analysis.ratsnest.filter((l) => l.net === store.highlightNet)
        : [],
  );

  const selectedRef = $derived(store.selection?.kind === 'component' ? store.selection.ref : null);
  const selectedWire = $derived(store.selection?.kind === 'wire' ? store.selection.id : null);
  const selectedBoard = $derived(store.selection?.kind === 'board' ? store.selection.id : null);

  function toWorld(e: { clientX: number; clientY: number }): Point {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.z, y: (e.clientY - r.top - view.ty) / view.z };
  }
  function snap(p: Point): Point {
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  export function fit() {
    const b = store.contentBounds();
    if (!b || !width || !height) return;
    const pad = 3;
    const w = b.x1 - b.x0 + pad * 2;
    const h = b.y1 - b.y0 + pad * 2;
    const z = Math.max(4, Math.min(60, Math.min(width / w, height / h)));
    view = {
      z,
      tx: width / 2 - ((b.x0 + b.x1) / 2) * z,
      ty: height / 2 - ((b.y0 + b.y1) / 2) * z,
    };
  }

  export function zoomBy(f: number, cx = width / 2, cy = height / 2) {
    const z = Math.max(3, Math.min(80, view.z * f));
    const k = z / view.z;
    view = { z, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k };
  }

  export function cancel() {
    wireStart = null;
  }

  export function centerOn(p: Point) {
    view = { ...view, tx: width / 2 - p.x * view.z, ty: height / 2 - p.y * view.z };
  }

  let fittedFor = '';
  $effect(() => {
    if (project.id !== fittedFor && width > 0) {
      fittedFor = project.id;
      queueMicrotask(fit);
    }
  });

  $effect(() => {
    if (store.tool !== 'wire') wireStart = null;
  });

  $effect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else if (e.deltaMode === 1) {
        // Line-based scrolling is usually a mouse wheel: zoom.
        zoomBy(Math.exp(-e.deltaY * 0.15), e.clientX - r.left, e.clientY - r.top);
      } else {
        view = { ...view, tx: view.tx - e.deltaX, ty: view.ty - e.deltaY };
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  interface Target {
    kind: string;
    ref?: string;
    id?: string;
    pin?: string;
    end?: string;
  }
  function targetOf(e: Event): Target | null {
    const el = (e.target as Element).closest('[data-kind]') as SVGElement | null;
    if (!el) return null;
    const d = el.dataset;
    return { kind: d.kind!, ref: d.ref, id: d.id, pin: d.pin, end: d.end };
  }

  function onPointerDown(e: PointerEvent) {
    const world = toWorld(e);
    const pt = snap(world);
    svg.setPointerCapture(e.pointerId);

    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false, deselect: false };
      panning = true;
      return;
    }
    if (e.button === 2) {
      wireStart = null;
      store.placing = null;
      return;
    }
    if (e.button !== 0) return;

    if (store.placing) {
      store.place(store.placing.ref, pt, store.placing.rotation);
      store.placing = null;
      return;
    }

    const t = targetOf(e);

    if (store.buildMode) {
      if (t?.kind === 'component' && t.ref) {
        store.toggleComponentDone(t.ref);
        store.selection = { kind: 'component', ref: t.ref };
        return;
      }
      if ((t?.kind === 'wire' || t?.kind === 'wire-end') && t.id) {
        store.toggleWireDone(t.id);
        store.selection = { kind: 'wire', id: t.id };
        return;
      }
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false, deselect: true };
      return;
    }

    if (store.tool === 'wire') {
      if (!wireStart) {
        wireStart = pt;
      } else {
        store.addWire(wireStart, pt);
        wireStart = e.shiftKey ? pt : null;
      }
      return;
    }

    if (t?.kind === 'lead' && t.ref && t.pin) {
      drag = { type: 'lead', ref: t.ref, pin: t.pin, moved: false };
      return;
    }
    if (t?.kind === 'component' && t.ref) {
      store.selection = { kind: 'component', ref: t.ref };
      const orig = $state.snapshot(layout.placements[t.ref]) as Placement;
      drag = { type: 'component', ref: t.ref, start: pt, orig, moved: false };
      return;
    }
    if (t?.kind === 'wire-end' && t.id && (t.end === 'a' || t.end === 'b')) {
      drag = { type: 'wire-end', id: t.id, end: t.end, moved: false };
      return;
    }
    if (t?.kind === 'wire' && t.id) {
      store.selection = { kind: 'wire', id: t.id };
      const w = layout.wires.find((x) => x.id === t.id)!;
      drag = { type: 'wire', id: t.id, start: pt, orig: $state.snapshot(w) as Wire, moved: false };
      return;
    }
    if (t?.kind === 'board-handle' && t.id) {
      store.selection = { kind: 'board', id: t.id };
      const board = layout.boards.find((b) => b.id === t.id)!;
      const contents = store.boardContents(t.id);
      drag = {
        type: 'board',
        id: t.id,
        start: pt,
        orig: { ...board },
        placements: Object.fromEntries(
          contents.refs.map((r) => [r, $state.snapshot(layout.placements[r]) as Placement]),
        ),
        wires: Object.fromEntries(
          contents.wires.map((id) => [id, $state.snapshot(layout.wires.find((w) => w.id === id)!) as Wire]),
        ),
        moved: false,
      };
      return;
    }

    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty, moved: false, deselect: true };
  }

  function startMove(d: Exclude<Drag, { type: 'pan' }>) {
    if (!d.moved) {
      store.checkpoint();
      d.moved = true;
    }
  }

  function onPointerMove(e: PointerEvent) {
    const world = toWorld(e);
    const pt = snap(world);
    const r = svg.getBoundingClientRect();
    cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (!hover || hover.x !== pt.x || hover.y !== pt.y) hover = pt;

    const d = drag;
    if (!d) return;
    switch (d.type) {
      case 'pan': {
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          d.moved = true;
          panning = true;
        }
        if (d.moved) view = { ...view, tx: d.tx + dx, ty: d.ty + dy };
        break;
      }
      case 'component': {
        const dx = pt.x - d.start.x;
        const dy = pt.y - d.start.y;
        if (!dx && !dy && !d.moved) return;
        startMove(d);
        store.setPlacement(d.ref, movePlacement(d.orig, dx, dy));
        break;
      }
      case 'lead': {
        const pl = layout.placements[d.ref];
        if (!pl?.leads) return;
        const cur = pl.leads[d.pin];
        if (cur && cur.x === pt.x && cur.y === pt.y) return;
        startMove(d);
        pl.leads[d.pin] = pt;
        break;
      }
      case 'wire-end': {
        const w = layout.wires.find((x) => x.id === d.id);
        if (!w || (w[d.end].x === pt.x && w[d.end].y === pt.y)) return;
        startMove(d);
        w[d.end] = pt;
        break;
      }
      case 'wire': {
        const dx = pt.x - d.start.x;
        const dy = pt.y - d.start.y;
        if (!dx && !dy && !d.moved) return;
        const w = layout.wires.find((x) => x.id === d.id);
        if (!w) return;
        startMove(d);
        w.a = { x: d.orig.a.x + dx, y: d.orig.a.y + dy };
        w.b = { x: d.orig.b.x + dx, y: d.orig.b.y + dy };
        break;
      }
      case 'board': {
        const dx = pt.x - d.start.x;
        const dy = pt.y - d.start.y;
        if (!dx && !dy && !d.moved) return;
        startMove(d);
        const board = layout.boards.find((b) => b.id === d.id);
        if (!board) return;
        board.x = d.orig.x + dx;
        board.y = d.orig.y + dy;
        for (const [ref, pl] of Object.entries(d.placements)) store.setPlacement(ref, movePlacement(pl, dx, dy));
        for (const [id, w] of Object.entries(d.wires)) {
          const cur = layout.wires.find((x) => x.id === id);
          if (!cur) continue;
          cur.a = { x: w.a.x + dx, y: w.a.y + dy };
          cur.b = { x: w.b.x + dx, y: w.b.y + dy };
        }
        break;
      }
    }
  }

  function onPointerUp() {
    const d = drag;
    drag = null;
    panning = false;
    if (d?.type === 'pan' && d.deselect && !d.moved) {
      store.selection = null;
    }
  }

  function onDrop(e: DragEvent) {
    const ref = e.dataTransfer?.getData('text/x-part-ref');
    if (!ref) return;
    e.preventDefault();
    const at = snap(toWorld(e));
    store.place(ref, at, store.defaultRotation(at));
    store.placing = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      spaceDown = e.type === 'keydown';
      if (e.type === 'keydown') e.preventDefault();
    }
  }

  function wireNet(w: Wire) {
    return analysis.netsAt(w.a)[0] ?? analysis.netsAt(w.b)[0];
  }

  const tipLines = $derived.by(() => {
    if (!hover || drag) return [];
    const lines: string[] = [];
    if (hoverHole) {
      const board = layout.boards.find((b) => b.id === hoverHole.boardId);
      lines.push(`${board?.name ?? ''} · ${hoverHole.label}`);
    }
    for (const k of hoverPins) {
      const [ref, pin] = [k.slice(0, k.lastIndexOf('.')), k.slice(k.lastIndexOf('.') + 1)];
      const name = store.component(ref)?.pins.find((p) => p.num === pin)?.name;
      lines.push(`${ref} pin ${pin}${name ? ` (${name})` : ''}${analysis.netOfPin.has(k) ? '' : ' · no net'}`);
    }
    if (hoverNets.length) lines.push(`Net: ${hoverNets.join(', ')}`);
    return hoverHole || hoverPins.length ? lines : [];
  });
</script>

<svelte:window onkeydown={onKey} onkeyup={onKey} />

<div class="wrap" bind:clientWidth={width} bind:clientHeight={height}>
  <svg
    bind:this={svg}
    class:panning
    class:space={spaceDown}
    class:wire-tool={store.tool === 'wire' && !store.buildMode}
    class:placing={!!store.placing}
    role="application"
    aria-label="Breadboard canvas"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={() => {
      hover = null;
      cursor = null;
    }}
    oncontextmenu={(e) => e.preventDefault()}
    ondragover={(e) => {
      if (e.dataTransfer?.types.includes('text/x-part-ref')) {
        e.preventDefault();
        hover = snap(toWorld(e));
      }
    }}
    ondrop={onDrop}
  >
    <defs>
      <pattern
        id="dots"
        width={view.z}
        height={view.z}
        patternUnits="userSpaceOnUse"
        x={view.tx % view.z}
        y={view.ty % view.z}
      >
        <circle cx={view.z / 2} cy={view.z / 2} r={Math.max(0.6, view.z * 0.04)} fill="#252932" />
      </pattern>
    </defs>
    <rect
      x="0"
      y="0"
      {width}
      {height}
      fill="url(#dots)"
      transform="translate({-view.z / 2} {-view.z / 2})"
    />

    <g transform="translate({view.tx} {view.ty}) scale({view.z})">
      {#each layout.boards as board (board.id)}
        <BoardView {board} selected={selectedBoard === board.id} />
      {/each}

      {#if hoverGroup.length > 1 && !drag}
        <g class="strip">
          {#each hoverGroup as h (h.x + ',' + h.y)}
            <rect x={h.x - 0.3} y={h.y - 0.3} width="0.6" height="0.6" rx="0.12" />
          {/each}
        </g>
      {/if}

      {#if netHoles.length}
        <g class="net-holes">
          {#each netHoles as h (h.key)}
            <rect x={h.x - 0.3} y={h.y - 0.3} width="0.6" height="0.6" rx="0.12" />
          {/each}
        </g>
      {/if}

      <g class="wires">
        {#each layout.wires as w (w.id)}
          {@const done = !!project.progress.wires[w.id]}
          {@const net = wireNet(w)}
          <g
            class="wire"
            class:selected={selectedWire === w.id}
            class:done
            class:build={store.buildMode}
            class:net-hl={!!store.highlightNet && net === store.highlightNet}
            data-kind="wire"
            data-id={w.id}
          >
            <line class="hit" x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
            <line class="casing" x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />
            <line class="core" x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={w.color} />
            <circle class="end" cx={w.a.x} cy={w.a.y} r="0.2" />
            <circle class="end" cx={w.b.x} cy={w.b.y} r="0.2" />
            {#if done}
              <g class="check" transform="translate({(w.a.x + w.b.x) / 2} {(w.a.y + w.b.y) / 2})">
                <circle r="0.36" />
                <path d="M -0.17 0 L -0.03 0.14 L 0.19 -0.12" />
              </g>
            {/if}
          </g>
        {/each}
      </g>

      {#each placed as p (p.comp.ref)}
        <PartShape
          comp={p.comp}
          pkg={p.pkg}
          placement={p.placement}
          selected={selectedRef === p.comp.ref}
          done={!!project.progress.components[p.comp.ref]}
          buildMode={store.buildMode}
          showHandles={selectedRef === p.comp.ref && p.pkg.kind === 'leads' && !store.buildMode}
        />
      {/each}

      {#if selectedWire && !store.buildMode}
        {@const w = layout.wires.find((x) => x.id === selectedWire)}
        {#if w}
          <circle class="wire-handle" data-kind="wire-end" data-id={w.id} data-end="a" cx={w.a.x} cy={w.a.y} r="0.38" />
          <circle class="wire-handle" data-kind="wire-end" data-id={w.id} data-end="b" cx={w.b.x} cy={w.b.y} r="0.38" />
        {/if}
      {/if}

      {#each netPins as p, i (i)}
        <circle class="net-pin" cx={p.x} cy={p.y} r="0.42" />
      {/each}

      <g class="rats">
        {#each ratsnest as l, i (i)}
          <line
            x1={l.a.x}
            y1={l.a.y}
            x2={l.b.x}
            y2={l.b.y}
            class:hl={store.highlightNet === l.net}
          />
        {/each}
      </g>

      {#each problemPoints as p, i (i)}
        <circle class="problem" cx={p.x} cy={p.y} r="0.5" />
      {/each}

      {#if ghost}
        <PartShape comp={ghost.comp} pkg={ghost.pkg} placement={ghost.placement} ghost />
      {/if}

      {#if wireStart && hover}
        <line class="wire-ghost" x1={wireStart.x} y1={wireStart.y} x2={hover.x} y2={hover.y} />
        <circle class="wire-ghost-end" cx={wireStart.x} cy={wireStart.y} r="0.25" />
      {/if}

      {#if hover && (store.tool === 'wire' || store.placing) && !store.buildMode}
        <circle class="cursor" cx={hover.x} cy={hover.y} r="0.32" />
      {/if}
    </g>
  </svg>

  {#if tipLines.length && cursor}
    <div class="tip" style="left: {cursor.x + 16}px; top: {cursor.y + 16}px">
      {#each tipLines as line, i (i)}
        <div class:first={i === 0}>{line}</div>
      {/each}
    </div>
  {/if}

  <div class="hint">
    {#if store.placing}
      Click to place <b>{store.placing.ref}</b>. <kbd>R</kbd> rotates. <kbd>Esc</kbd> cancels.
    {:else if store.buildMode}
      Build mode: click a part or wire to mark it as done.
    {:else if store.tool === 'wire'}
      {wireStart ? 'Click the end hole. Shift-click to continue from there.' : 'Click the start hole for the wire.'}
      <kbd>Esc</kbd> stops.
    {:else}
      Drag parts to move them. Drag empty space or use the scroll wheel to pan. <kbd>Ctrl</kbd>+scroll or pinch to zoom.
    {/if}
  </div>
</div>

<style>
  .wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--canvas);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
  }
  svg.panning,
  svg.space {
    cursor: grabbing !important;
  }
  svg.wire-tool,
  svg.placing {
    cursor: crosshair;
  }
  svg.wire-tool :global(.part),
  svg.wire-tool :global(.handle) {
    pointer-events: none;
  }
  .strip rect {
    fill: rgba(91, 156, 255, 0.28);
    pointer-events: none;
  }
  .net-holes rect {
    fill: rgba(60, 207, 142, 0.45);
    pointer-events: none;
  }
  .net-pin {
    fill: none;
    stroke: var(--ok);
    stroke-width: 0.12;
    pointer-events: none;
  }
  .wire {
    cursor: pointer;
  }
  .wire .hit {
    stroke: transparent;
    stroke-width: 0.8;
    stroke-linecap: round;
  }
  .wire .casing {
    stroke: rgba(0, 0, 0, 0.55);
    stroke-width: 0.4;
    stroke-linecap: round;
  }
  .wire .core {
    stroke-width: 0.28;
    stroke-linecap: round;
  }
  .wire .end {
    fill: #c9cdd4;
    stroke: rgba(0, 0, 0, 0.5);
    stroke-width: 0.04;
  }
  .wire.selected .casing {
    stroke: var(--accent);
    stroke-width: 0.55;
  }
  .wire.net-hl .casing {
    stroke: var(--ok);
    stroke-width: 0.55;
  }
  .wire.build:not(.done) .casing {
    stroke: #f5b74e;
    stroke-width: 0.5;
  }
  .wire.build.done {
    opacity: 0.4;
  }
  .check circle {
    fill: var(--ok);
    stroke: #0b3d26;
    stroke-width: 0.05;
  }
  .check path {
    fill: none;
    stroke: #0b1f14;
    stroke-width: 0.1;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .wire-handle {
    fill: rgba(91, 156, 255, 0.3);
    stroke: var(--accent);
    stroke-width: 0.08;
    cursor: crosshair;
  }
  .rats line {
    stroke: #f5b74e;
    stroke-width: 0.08;
    stroke-dasharray: 0.25 0.2;
    pointer-events: none;
    opacity: 0.8;
  }
  .rats line.hl {
    stroke: var(--ok);
    stroke-width: 0.13;
    opacity: 1;
  }
  .problem {
    fill: none;
    stroke: var(--bad);
    stroke-width: 0.14;
    pointer-events: none;
  }
  .wire-ghost {
    stroke: var(--accent);
    stroke-width: 0.25;
    stroke-linecap: round;
    opacity: 0.7;
    pointer-events: none;
  }
  .wire-ghost-end {
    fill: var(--accent);
    pointer-events: none;
  }
  .cursor {
    fill: none;
    stroke: var(--accent);
    stroke-width: 0.08;
    pointer-events: none;
  }
  .tip {
    position: absolute;
    pointer-events: none;
    background: rgba(20, 22, 28, 0.95);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
    white-space: nowrap;
    z-index: 5;
  }
  .tip .first {
    color: var(--text);
    font-weight: 600;
  }
  .hint {
    position: absolute;
    left: 12px;
    bottom: 10px;
    font-size: 12px;
    color: var(--muted);
    background: rgba(16, 18, 22, 0.85);
    padding: 4px 10px;
    border-radius: 6px;
    pointer-events: none;
  }
</style>
