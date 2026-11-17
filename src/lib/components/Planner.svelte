<script lang="ts">
  import { store } from '../store.svelte';
  import Canvas from './Canvas.svelte';
  import Sidebar from './Sidebar.svelte';
  import Inspector from './Inspector.svelte';
  import { BOARD_DEFS, type BoardType } from '../boards';
  import { WIRE_COLORS } from '../project';
  import type { Rotation } from '../packages';

  let canvas: Canvas;

  const project = $derived(store.project!);
  const analysis = $derived(store.analysis!);

  const onPlan = $derived(project.netlist.components.filter((c) => project.layout.placements[c.ref]));
  const partsDone = $derived(onPlan.filter((c) => project.progress.components[c.ref]).length);
  const wiresDone = $derived(project.layout.wires.filter((w) => project.progress.wires[w.id]).length);
  const netsOk = $derived([...analysis.nets.values()].filter((n) => n.state === 'complete').length);
  const buildTotal = $derived(onPlan.length + project.layout.wires.length);
  const buildDone = $derived(partsDone + wiresDone);

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (document.querySelector('[role="dialog"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      store.redo();
      return;
    }
    if (mod || e.altKey) return;
    // Held keys must not flip toggles back and forth. Zoom keys can repeat.
    if (e.repeat && !['=', '+', '-'].includes(key)) return;

    const sel = store.selection;
    switch (key) {
      case 'escape':
        if (store.placing) store.placing = null;
        else if (store.tool === 'wire') {
          canvas.cancel();
          store.tool = 'select';
        } else {
          store.selection = null;
          store.highlightNet = null;
        }
        break;
      case 'v':
      case 's':
        store.tool = 'select';
        break;
      case 'w':
        if (!store.buildMode) store.tool = store.tool === 'wire' ? 'select' : 'wire';
        store.placing = null;
        break;
      case 'b':
        store.buildMode = !store.buildMode;
        break;
      case 'r':
        if (store.placing) store.placing.rotation = ((store.placing.rotation + 1) % 4) as Rotation;
        else if (sel?.kind === 'component' && !store.buildMode) store.rotate(sel.ref);
        break;
      case 'delete':
      case 'backspace':
        if (store.buildMode) break;
        if (sel?.kind === 'wire') store.deleteWire(sel.id);
        else if (sel?.kind === 'component') store.unplace(sel.ref);
        else if (sel?.kind === 'board' && confirm('Delete this board? Parts and wires stay where they are.'))
          store.deleteBoard(sel.id);
        e.preventDefault();
        break;
      case 'enter':
      case 'x':
        if (sel?.kind === 'component') store.toggleComponentDone(sel.ref);
        else if (sel?.kind === 'wire') store.toggleWireDone(sel.id);
        break;
      case 'f':
        canvas.fit();
        break;
      case '=':
      case '+':
        canvas.zoomBy(1.25);
        break;
      case '-':
        canvas.zoomBy(0.8);
        break;
      default:
        return;
    }
  }

  function addBoard(e: Event) {
    const sel = e.target as HTMLSelectElement;
    if (sel.value) store.addBoard(sel.value as BoardType);
    sel.value = '';
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="planner" class:with-inspector={!!store.selection}>
  <div class="toolbar">
    <div class="group seg">
      <button
        class:active={!store.buildMode}
        onclick={() => (store.buildMode = false)}
        title="Plan the layout (B toggles)"
      >
        Plan
      </button>
      <button
        class:active={store.buildMode}
        onclick={() => {
          store.buildMode = true;
          store.placing = null;
          store.tool = 'select';
        }}
        title="Check off parts and wires as you build (B toggles)"
      >
        Build
      </button>
    </div>

    {#if !store.buildMode}
      <div class="group seg">
        <button class:active={store.tool === 'select'} onclick={() => (store.tool = 'select')} title="Select (V)">
          Select <kbd>V</kbd>
        </button>
        <button
          class:active={store.tool === 'wire'}
          onclick={() => {
            store.tool = 'wire';
            store.placing = null;
          }}
          title="Draw wires (W)"
        >
          Wire <kbd>W</kbd>
        </button>
      </div>

      <div class="group colors" title="Color for new wires">
        <button
          class="auto"
          class:active={store.wireColor === 'auto'}
          onclick={() => (store.wireColor = 'auto')}
          title="Choose the color from the net: red for power, black for ground"
        >
          Auto
        </button>
        {#each WIRE_COLORS as c (c.value)}
          <button
            class="swatch"
            class:active={store.wireColor === c.value}
            style="background: {c.value}"
            title={c.name}
            aria-label={`${c.name} wire`}
            onclick={() => (store.wireColor = c.value)}
          ></button>
        {/each}
      </div>

      <select class="group" onchange={addBoard} title="Add a breadboard">
        <option value="">+ Add breadboard</option>
        {#each Object.values(BOARD_DEFS) as d (d.type)}
          <option value={d.type}>{d.label}</option>
        {/each}
      </select>

      <label class="group toggle" title="Show dashed lines for connections that are still missing">
        <input type="checkbox" bind:checked={store.showRatsnest} /> Missing connections
      </label>

      <div class="group seg">
        <button onclick={() => store.undo()} disabled={!store.undoCount} title="Undo (Ctrl/Cmd+Z)">Undo</button>
        <button onclick={() => store.redo()} disabled={!store.redoCount} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
      </div>
    {:else}
      <div class="group build-progress">
        <div class="progress"><div style="width: {buildTotal ? (buildDone / buildTotal) * 100 : 0}%"></div></div>
        <span>{buildDone} of {buildTotal} done</span>
      </div>
      <button
        class="group ghost"
        onclick={() => confirm('Clear all check marks for parts and wires?') && store.resetPlannerProgress()}
      >
        Clear checks
      </button>
    {/if}

    <div class="spacer"></div>

    <div class="group stats">
      <span title="Parts built / parts on the plan">Parts <b>{partsDone}/{onPlan.length}</b></span>
      <span title="Wires built / wires on the plan">Wires <b>{wiresDone}/{project.layout.wires.length}</b></span>
      <span title="Nets with every pin connected">
        Nets <b class:ok={netsOk === analysis.nets.size}>{netsOk}/{analysis.nets.size}</b>
      </span>
      {#if analysis.shorts.length}
        <span class="bad">{analysis.shorts.length} short{analysis.shorts.length > 1 ? 's' : ''}</span>
      {/if}
    </div>

    <div class="group seg">
      <button onclick={() => canvas.zoomBy(0.8)} title="Zoom out (-)">−</button>
      <button onclick={() => canvas.fit()} title="Fit to view (F)">Fit</button>
      <button onclick={() => canvas.zoomBy(1.25)} title="Zoom in (+)">+</button>
    </div>
  </div>

  <div class="sidebar"><Sidebar onfocus={(p) => canvas.centerOn(p)} /></div>
  <div class="canvas"><Canvas bind:this={canvas} /></div>
  {#if store.selection}
    <div class="inspector"><Inspector /></div>
  {/if}
</div>

<style>
  .planner {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 300px 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas: 'tool tool' 'side canvas';
  }
  .planner.with-inspector {
    grid-template-columns: 300px 1fr 290px;
    grid-template-areas: 'tool tool tool' 'side canvas insp';
  }
  .toolbar {
    grid-area: tool;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-wrap: wrap;
  }
  .sidebar {
    grid-area: side;
    min-height: 0;
  }
  .canvas {
    grid-area: canvas;
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .inspector {
    grid-area: insp;
    min-height: 0;
    overflow: auto;
    background: var(--panel);
    border-left: 1px solid var(--border);
  }
  .seg {
    display: flex;
  }
  .seg button {
    border-radius: 0;
    margin-left: -1px;
  }
  .seg button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
    margin-left: 0;
  }
  .seg button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .seg button.active {
    position: relative;
    z-index: 1;
  }
  .colors {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .colors .auto {
    padding: 3px 8px;
    font-size: 12px;
  }
  .swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.12);
  }
  .swatch.active {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--accent);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
  }
  .spacer {
    flex: 1;
  }
  .stats {
    display: flex;
    gap: 12px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .stats b {
    color: var(--text);
  }
  .stats b.ok {
    color: var(--ok);
  }
  .bad {
    color: var(--bad);
    font-weight: 600;
  }
  .build-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .build-progress .progress {
    width: 180px;
  }
</style>
