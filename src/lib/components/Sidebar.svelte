<script lang="ts">
  import { store } from '../store.svelte';
  import { packageLabel, type Point } from '../packages';
  import { pointKey } from '../boards';
  import type { NetState } from '../connectivity';
  import NetIcon from './NetIcon.svelte';

  let { onfocus }: { onfocus: (p: Point) => void } = $props();

  type Tab = 'parts' | 'nets' | 'wires' | 'issues';
  let tab = $state<Tab>('parts');

  const project = $derived(store.project!);
  const analysis = $derived(store.analysis!);

  const unplaced = $derived(project.netlist.components.filter((c) => !project.layout.placements[c.ref]));
  const onPlan = $derived(project.netlist.components.filter((c) => project.layout.placements[c.ref]));
  const partsDone = $derived(onPlan.filter((c) => project.progress.components[c.ref]).length);
  const wiresDone = $derived(project.layout.wires.filter((w) => project.progress.wires[w.id]).length);

  const ORDER: Record<NetState, number> = { short: 0, partial: 1, unplaced: 2, complete: 3 };
  const nets = $derived([...analysis.nets.values()].sort((a, b) => ORDER[a.state] - ORDER[b.state]));
  const netsOk = $derived(nets.filter((n) => n.state === 'complete').length);

  function holeLabel(p: Point) {
    const h = analysis.holes.get(pointKey(p));
    if (!h) return 'off board';
    const board = project.layout.boards.find((b) => b.id === h.boardId);
    return project.layout.boards.length > 1 ? `${board?.name}:${h.label}` : h.label;
  }

  function selectPart(ref: string) {
    store.selection = { kind: 'component', ref };
    const pl = project.layout.placements[ref];
    if (pl) onfocus({ x: pl.x, y: pl.y });
  }

  function partNetSummary(ref: string) {
    const comp = store.component(ref)!;
    let ok = 0;
    let total = 0;
    for (const pin of comp.pins) {
      const net = analysis.netOfPin.get(`${ref}.${pin.num}`);
      if (!net) continue;
      total++;
      if (analysis.nets.get(net)?.state === 'complete') ok++;
    }
    return { ok, total };
  }
</script>

<aside>
  <div class="tabs" role="tablist">
    <button role="tab" class:active={tab === 'parts'} onclick={() => (tab = 'parts')}>
      Parts <span class="count">{partsDone}/{project.netlist.components.length}</span>
    </button>
    <button role="tab" class:active={tab === 'nets'} onclick={() => (tab = 'nets')}>
      Nets <span class="count">{netsOk}/{nets.length}</span>
    </button>
    <button role="tab" class:active={tab === 'wires'} onclick={() => (tab = 'wires')}>
      Wires <span class="count">{wiresDone}/{project.layout.wires.length}</span>
    </button>
    <button role="tab" class:active={tab === 'issues'} onclick={() => (tab = 'issues')}>
      Issues
      {#if analysis.warnings.length}<span class="count bad">{analysis.warnings.length}</span>{/if}
    </button>
  </div>

  <div class="body">
    {#if tab === 'parts'}
      {#if unplaced.length}
        <h3>Not on the plan yet</h3>
        <p class="hint">Click a part, then click the board. You can also drag it onto the board.</p>
        <ul>
          {#each unplaced as c (c.ref)}
            <li>
              <button
                class="row"
                class:active={store.placing?.ref === c.ref}
                draggable="true"
                ondragstart={(e) => {
                  e.dataTransfer?.setData('text/x-part-ref', c.ref);
                  store.placing = null;
                }}
                onclick={() => (store.placing?.ref === c.ref ? (store.placing = null) : store.startPlacing(c.ref))}
              >
                <span class="ref mono">{c.ref}</span>
                <span class="value">{c.value}</span>
                <span class="pkg faint">{c.pins.length}p · {packageLabel(project.packages[c.ref])}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <h3>On the plan</h3>
      {#if onPlan.length}
        <div class="progress-line">
          <div class="progress"><div style="width: {(partsDone / onPlan.length) * 100}%"></div></div>
          <span class="faint">{partsDone} of {onPlan.length} built</span>
        </div>
        <ul>
          {#each onPlan as c (c.ref)}
            {@const s = partNetSummary(c.ref)}
            <li class="check-row" class:selected={store.selection?.kind === 'component' && store.selection.ref === c.ref}>
              <input
                type="checkbox"
                checked={!!project.progress.components[c.ref]}
                onchange={(e) => store.toggleComponentDone(c.ref, (e.target as HTMLInputElement).checked)}
                title="Mark as placed on the real board"
              />
              <button class="row" onclick={() => selectPart(c.ref)}>
                <span class="ref mono">{c.ref}</span>
                <span class="value">{c.value}</span>
                <span class="pkg" class:ok={s.ok === s.total} title="Pins whose net is complete">
                  {s.ok}/{s.total} nets
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">No parts on the plan.</p>
      {/if}
    {:else if tab === 'nets'}
      <p class="hint">Click a net to show it on the board.</p>
      <ul>
        {#each nets as n (n.name)}
          {@const open = store.highlightNet === n.name}
          <li>
            <button
              class="row net"
              class:active={open}
              onclick={() => (store.highlightNet = open ? null : n.name)}
            >
              <NetIcon state={n.state} />
              <span class="netname mono">{n.name}</span>
              <span class="pkg faint">
                {#if n.state === 'short'}short{:else if n.state === 'partial'}{n.groups > 1
                    ? `${n.groups} groups`
                    : `${n.placedPins}/${n.pins.length} pins`}{:else}{n.placedPins}/{n.pins.length}{/if}
              </span>
            </button>
            {#if open}
              <div class="net-detail">
                {#if n.shortedWith.length}
                  <div class="bad">Shorted to {n.shortedWith.join(', ')}</div>
                {/if}
                {#each n.pins as k (k)}
                  {@const pt = analysis.pinPos.get(k)}
                  {@const ref = k.slice(0, k.lastIndexOf('.'))}
                  {@const pin = k.slice(k.lastIndexOf('.') + 1)}
                  {@const name = store.component(ref)?.pins.find((p) => p.num === pin)?.name}
                  <button class="pin-row" onclick={() => selectPart(ref)}>
                    <span class="mono">{k}</span>
                    <span class="faint">{name ?? ''}</span>
                    <span class="hole mono" class:faint={!pt}>{pt ? holeLabel(pt) : 'not placed'}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if tab === 'wires'}
      {#if project.layout.wires.length}
        <div class="progress-line">
          <div class="progress"><div style="width: {(wiresDone / project.layout.wires.length) * 100}%"></div></div>
          <span class="faint">{wiresDone} of {project.layout.wires.length} built</span>
        </div>
        <ul>
          {#each project.layout.wires as w, i (w.id)}
            {@const net = analysis.netsAt(w.a)[0] ?? analysis.netsAt(w.b)[0]}
            <li class="check-row" class:selected={store.selection?.kind === 'wire' && store.selection.id === w.id}>
              <input
                type="checkbox"
                checked={!!project.progress.wires[w.id]}
                onchange={(e) => store.toggleWireDone(w.id, (e.target as HTMLInputElement).checked)}
                title="Mark as placed on the real board"
              />
              <button
                class="row"
                onclick={() => {
                  store.selection = { kind: 'wire', id: w.id };
                  onfocus({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
                }}
              >
                <span class="swatch" style="background: {w.color}"></span>
                <span class="mono">{holeLabel(w.a)} → {holeLabel(w.b)}</span>
                <span class="pkg faint">{net ?? `#${i + 1}`}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">No wires yet. Press <kbd>W</kbd> or choose the wire tool, then click two holes.</p>
      {/if}
    {:else}
      {#if analysis.warnings.length}
        <ul class="issues">
          {#each analysis.warnings as w, i (i)}
            <li>
              <button
                class="row issue"
                class:bad={w.kind === 'short'}
                onclick={() => {
                  const k = w.pins?.[0];
                  if (k) selectPart(k.slice(0, k.lastIndexOf('.')));
                  else if (w.points?.[0]) onfocus(w.points[0]);
                }}
              >
                {w.message}
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">No problems found.</p>
      {/if}
    {/if}
  </div>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--panel);
    border-right: 1px solid var(--border);
  }
  .tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 9px 2px;
    font-size: 12.5px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
  }
  .tabs button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .count {
    font-size: 11px;
    color: var(--faint);
    margin-left: 2px;
  }
  .count.bad {
    color: #fff;
    background: var(--bad);
    border-radius: 8px;
    padding: 0 5px;
  }
  .body {
    overflow: auto;
    flex: 1;
    padding: 6px 8px 20px;
  }
  h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--faint);
    margin: 14px 4px 6px;
  }
  .hint {
    font-size: 12px;
    color: var(--faint);
    margin: 4px 4px 8px;
    line-height: 1.45;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    padding: 5px 6px;
    min-width: 0;
  }
  .row:hover {
    background: var(--panel-2) !important;
  }
  .row.active {
    background: var(--accent-soft) !important;
    border-color: var(--accent);
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: 6px;
    border-radius: var(--radius);
  }
  .check-row.selected {
    background: var(--accent-soft);
  }
  .ref {
    font-weight: 600;
    min-width: 34px;
  }
  .value {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
  }
  .pkg {
    font-size: 11.5px;
    color: var(--faint);
    white-space: nowrap;
  }
  .pkg.ok {
    color: var(--ok);
  }
  .netname {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .net-detail {
    margin: 2px 0 8px 26px;
    font-size: 12.5px;
  }
  .pin-row {
    display: grid;
    grid-template-columns: 60px 1fr auto;
    gap: 6px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 3px 4px;
  }
  .hole {
    color: var(--muted);
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    flex: none;
  }
  .progress-line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    margin: 4px 4px 8px;
  }
  .progress-line .progress {
    flex: 1;
  }
  .issue {
    white-space: normal;
    line-height: 1.4;
    font-size: 12.5px;
    color: #ffd59a;
  }
  .issue.bad,
  .bad {
    color: #ff9c9c;
  }
  .issues li {
    border-bottom: 1px solid var(--border);
  }
</style>
