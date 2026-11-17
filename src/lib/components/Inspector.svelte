<script lang="ts">
  import { store } from '../store.svelte';
  import { BOARD_DEFS, type BoardType, pointKey } from '../boards';
  import type { PackageSpec, Point } from '../packages';
  import { WIRE_COLORS, pinPositions } from '../project';
  import NetIcon from './NetIcon.svelte';

  const project = $derived(store.project!);
  const analysis = $derived(store.analysis!);
  const sel = $derived(store.selection);

  function holeLabel(p: Point | undefined) {
    if (!p) return '—';
    const h = analysis.holes.get(pointKey(p));
    if (!h) return 'off board';
    const board = project.layout.boards.find((b) => b.id === h.boardId);
    return project.layout.boards.length > 1 ? `${board?.name}:${h.label}` : h.label;
  }

  const comp = $derived(sel?.kind === 'component' ? store.component(sel.ref) : undefined);
  const pkg = $derived(comp ? project.packages[comp.ref] : undefined);
  const placement = $derived(comp ? project.layout.placements[comp.ref] : undefined);
  const pins = $derived(comp && pkg && placement ? pinPositions(comp, pkg, placement) : undefined);

  const wire = $derived(sel?.kind === 'wire' ? project.layout.wires.find((w) => w.id === sel.id) : undefined);
  const board = $derived(sel?.kind === 'board' ? project.layout.boards.find((b) => b.id === sel.id) : undefined);

  function setKind(kind: PackageSpec['kind']) {
    if (!comp) return;
    if (kind === 'dip') store.setPackage(comp.ref, { kind, rowSpacing: comp.pins.length >= 24 ? 6 : 3 });
    else if (kind === 'sip') store.setPackage(comp.ref, { kind });
    else store.setPackage(comp.ref, { kind, spacing: comp.pins.length === 2 ? 3 : 1 });
  }
</script>

{#if comp && pkg}
  <section>
    <header>
      <div>
        <div class="title mono">{comp.ref}</div>
        <div class="sub">{comp.value}</div>
      </div>
      <button class="ghost close" onclick={() => (store.selection = null)} aria-label="Close">✕</button>
    </header>
    {#if comp.footprint || comp.description}
      <div class="meta">
        {#if comp.description}<div>{comp.description}</div>{/if}
        {#if comp.footprint}<div class="faint mono small">{comp.footprint}</div>{/if}
      </div>
    {/if}

    <label class="done">
      <input
        type="checkbox"
        checked={!!project.progress.components[comp.ref]}
        onchange={(e) => store.toggleComponentDone(comp.ref, (e.target as HTMLInputElement).checked)}
      />
      Placed on the real board
    </label>

    <div class="field">
      <span>Package</span>
      <select value={pkg.kind} onchange={(e) => setKind((e.target as HTMLSelectElement).value as PackageSpec['kind'])}>
        <option value="dip">DIP (two rows)</option>
        <option value="sip">Single row / header</option>
        <option value="leads">Flexible leads</option>
      </select>
    </div>
    {#if pkg.kind === 'dip'}
      <div class="field">
        <span>Row spacing</span>
        <select
          value={pkg.rowSpacing}
          onchange={(e) =>
            store.setPackage(comp.ref, { kind: 'dip', rowSpacing: +(e.target as HTMLSelectElement).value })}
        >
          {#each [3, 4, 6, 7, 8, 9] as s (s)}
            <option value={s}>{(s / 10).toFixed(1)}" ({(s * 2.54).toFixed(2)} mm)</option>
          {/each}
        </select>
      </div>
    {:else if pkg.kind === 'leads' && comp.pins.length === 2}
      <div class="field">
        <span>Default lead span</span>
        <select
          value={pkg.spacing}
          onchange={(e) => store.setPackage(comp.ref, { kind: 'leads', spacing: +(e.target as HTMLSelectElement).value })}
        >
          {#each [1, 2, 3, 4, 5, 6, 8] as s (s)}
            <option value={s}>{s} {s === 1 ? 'hole' : 'holes'}</option>
          {/each}
        </select>
      </div>
      <p class="hint">Select the part and drag the blue lead handles to move each lead.</p>
    {:else if pkg.kind === 'leads'}
      <p class="hint">Select the part and drag the blue lead handles to move each lead.</p>
    {/if}

    <div class="buttons">
      {#if placement}
        <button onclick={() => store.rotate(comp.ref)} title="Rotate (R)">Rotate</button>
        <button class="danger" onclick={() => store.unplace(comp.ref)} title="Remove from the plan (Delete)">
          Remove from plan
        </button>
      {:else}
        <button class="primary" onclick={() => store.startPlacing(comp.ref)}>Place on board</button>
      {/if}
    </div>

    <table class="pins">
      <thead>
        <tr><th>Pin</th><th>Net</th><th>Hole</th></tr>
      </thead>
      <tbody>
        {#each comp.pins as pin (pin.num)}
          {@const key = `${comp.ref}.${pin.num}`}
          {@const net = analysis.netOfPin.get(key)}
          {@const status = net ? analysis.nets.get(net) : undefined}
          <tr
            class:hl={net && store.highlightNet === net}
            onclick={() => net && (store.highlightNet = store.highlightNet === net ? null : net)}
          >
            <td class="mono">
              {pin.num}{#if pin.name}<span class="faint"> {pin.name}</span>{/if}
            </td>
            <td class="net">
              {#if status}<NetIcon state={status.state} />{/if}
              <span class="mono">{net ?? 'no net'}</span>
            </td>
            <td class="mono muted">{holeLabel(pins?.[pin.num])}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{:else if wire}
  {@const nets = [...new Set([...analysis.netsAt(wire.a), ...analysis.netsAt(wire.b)])]}
  <section>
    <header>
      <div>
        <div class="title">Wire</div>
        <div class="sub mono">{holeLabel(wire.a)} → {holeLabel(wire.b)}</div>
      </div>
      <button class="ghost close" onclick={() => (store.selection = null)} aria-label="Close">✕</button>
    </header>
    <label class="done">
      <input
        type="checkbox"
        checked={!!project.progress.wires[wire.id]}
        onchange={(e) => store.toggleWireDone(wire.id, (e.target as HTMLInputElement).checked)}
      />
      Placed on the real board
    </label>
    <div class="field">
      <span>Color</span>
      <div class="swatches">
        {#each WIRE_COLORS as c (c.value)}
          <button
            class="swatch"
            class:active={wire.color === c.value}
            style="background: {c.value}"
            title={c.name}
            aria-label={c.name}
            onclick={() => store.setWireColor(wire.id, c.value)}
          ></button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span>Length</span>
      <div class="mono">
        {Math.hypot(wire.a.x - wire.b.x, wire.a.y - wire.b.y).toFixed(1)} holes · {(
          Math.hypot(wire.a.x - wire.b.x, wire.a.y - wire.b.y) * 0.254
        ).toFixed(1)} cm
      </div>
    </div>
    <div class="field">
      <span>Net</span>
      <div class="mono">{nets.length ? nets.join(', ') : 'none'}</div>
    </div>
    <div class="buttons">
      <button class="danger" onclick={() => store.deleteWire(wire.id)}>Delete wire</button>
    </div>
  </section>
{:else if board}
  {@const contents = store.boardContents(board.id)}
  <section>
    <header>
      <div>
        <div class="title">{board.name}</div>
        <div class="sub">{BOARD_DEFS[board.type].label}</div>
      </div>
      <button class="ghost close" onclick={() => (store.selection = null)} aria-label="Close">✕</button>
    </header>
    <div class="field">
      <span>Name</span>
      <input
        value={board.name}
        onchange={(e) => {
          store.checkpoint();
          board.name = (e.target as HTMLInputElement).value || 'Board';
        }}
      />
    </div>
    <div class="field">
      <span>Size</span>
      <select
        value={board.type}
        onchange={(e) => {
          store.checkpoint();
          board.type = (e.target as HTMLSelectElement).value as BoardType;
        }}
      >
        {#each Object.values(BOARD_DEFS) as d (d.type)}
          <option value={d.type}>{d.label}</option>
        {/each}
      </select>
    </div>
    <p class="hint">
      {contents.refs.length} parts and {contents.wires.length} wires move with this board. Drag the tab above the board
      to move it.
    </p>
    <div class="buttons">
      <button class="danger" onclick={() => store.deleteBoard(board.id)}>Delete board</button>
    </div>
  </section>
{/if}

<style>
  section {
    padding: 12px 14px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .title {
    font-size: 17px;
    font-weight: 700;
  }
  .sub {
    color: var(--muted);
    margin-top: 2px;
  }
  .close {
    padding: 2px 8px;
    color: var(--faint);
  }
  .meta {
    font-size: 13px;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .small {
    font-size: 11px;
    word-break: break-all;
  }
  .done {
    display: flex;
    gap: 8px;
    align-items: center;
    background: var(--ok-soft);
    border: 1px solid rgba(60, 207, 142, 0.3);
    padding: 8px 10px;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .field > span {
    font-size: 11.5px;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--faint);
    line-height: 1.45;
  }
  .buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .pins {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .pins th {
    text-align: left;
    font-weight: 500;
    color: var(--faint);
    font-size: 11px;
    padding: 4px;
    border-bottom: 1px solid var(--border);
  }
  .pins td {
    padding: 4px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .pins tr {
    cursor: pointer;
  }
  .pins tr:hover td {
    background: var(--panel-2);
  }
  .pins tr.hl td {
    background: var(--ok-soft);
  }
  .pins .net {
    display: flex;
    align-items: center;
    gap: 5px;
    word-break: break-all;
  }
  .swatches {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .swatch {
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.15);
  }
  .swatch.active {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--accent);
  }
</style>
