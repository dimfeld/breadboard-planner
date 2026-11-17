<script lang="ts">
  import { store } from '../store.svelte';
  import ChipDiagram from './ChipDiagram.svelte';
  import { pinKey } from '../netlist/types';

  let view = $state<'parts' | 'nets'>('parts');
  let query = $state('');
  let hideDone = $state(false);
  let hoverNet = $state<string | null>(null);

  const project = $derived(store.project!);
  const nl = $derived(project.netlist);
  const progress = $derived(project.progress);

  const netOfPin = $derived.by(() => {
    const m = new Map<string, string>();
    for (const net of nl.nets) for (const n of net.nodes) m.set(pinKey(n.ref, n.pin), net.name);
    return m;
  });
  const netByName = $derived(new Map(nl.nets.map((n) => [n.name, n])));

  const pinTotal = $derived(netOfPin.size);
  const pinDone = $derived([...netOfPin.keys()].filter((k) => progress.pins[k]).length);
  const partsDone = $derived(nl.components.filter((c) => progress.components[c.ref]).length);
  const netDone = (name: string) => netByName.get(name)!.nodes.every((n) => progress.pins[pinKey(n.ref, n.pin)]);
  const netsDone = $derived(nl.nets.filter((n) => netDone(n.name)).length);

  function compDone(ref: string) {
    const c = nl.components.find((x) => x.ref === ref)!;
    const pins = c.pins.filter((p) => netOfPin.has(pinKey(ref, p.num)));
    return !!progress.components[ref] && pins.every((p) => progress.pins[pinKey(ref, p.num)]);
  }

  const q = $derived(query.trim().toLowerCase());

  const parts = $derived(
    nl.components.filter((c) => {
      if (hideDone && compDone(c.ref)) return false;
      if (!q) return true;
      return (
        c.ref.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q) ||
        c.pins.some((p) => netOfPin.get(pinKey(c.ref, p.num))?.toLowerCase().includes(q))
      );
    }),
  );

  const nets = $derived(
    nl.nets.filter((n) => {
      if (hideDone && netDone(n.name)) return false;
      if (!q) return true;
      return n.name.toLowerCase().includes(q) || n.nodes.some((x) => x.ref.toLowerCase().includes(q));
    }),
  );

  function others(ref: string, pin: string) {
    const net = netOfPin.get(pinKey(ref, pin));
    if (!net) return [];
    return netByName
      .get(net)!
      .nodes.filter((n) => !(n.ref === ref && n.pin === pin))
      .map((n) => ({ key: pinKey(n.ref, n.pin), done: !!progress.pins[pinKey(n.ref, n.pin)] }));
  }

  function pinName(ref: string, pin: string) {
    return nl.components.find((c) => c.ref === ref)?.pins.find((p) => p.num === pin)?.name;
  }

  function setAllPins(ref: string, value: boolean) {
    const c = nl.components.find((x) => x.ref === ref)!;
    for (const p of c.pins) {
      const k = pinKey(ref, p.num);
      if (netOfPin.has(k)) progress.pins[k] = value;
    }
    store.touch();
  }

  function setNetPins(name: string, value: boolean) {
    for (const n of netByName.get(name)!.nodes) progress.pins[pinKey(n.ref, n.pin)] = value;
    store.touch();
  }

  const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
</script>

<div class="checklist">
  <div class="toolbar">
    <div class="seg">
      <button class:active={view === 'parts'} onclick={() => (view = 'parts')}>By part</button>
      <button class:active={view === 'nets'} onclick={() => (view = 'nets')}>By net</button>
    </div>
    <input class="search" type="search" placeholder="Filter by part, value, or net" bind:value={query} />
    <label class="toggle"><input type="checkbox" bind:checked={hideDone} /> Hide finished</label>
    <div class="spacer"></div>
    <div class="stat">
      <span>Parts placed <b>{partsDone}/{nl.components.length}</b></span>
      <div class="progress"><div style="width: {pct(partsDone, nl.components.length)}%"></div></div>
    </div>
    <div class="stat">
      <span>Pins connected <b>{pinDone}/{pinTotal}</b></span>
      <div class="progress"><div style="width: {pct(pinDone, pinTotal)}%"></div></div>
    </div>
    <div class="stat">
      <span>Nets finished <b>{netsDone}/{nl.nets.length}</b></span>
      <div class="progress"><div style="width: {pct(netsDone, nl.nets.length)}%"></div></div>
    </div>
    <button
      class="ghost"
      onclick={() => confirm('Clear all part and pin check marks?') && store.resetChecklistProgress()}
    >
      Clear checks
    </button>
  </div>

  <div class="content">
    {#if view === 'parts'}
      <div class="grid">
        {#each parts as c (c.ref)}
          {@const placed = !!progress.components[c.ref]}
          {@const netPins = c.pins.filter((p) => netOfPin.has(pinKey(c.ref, p.num)))}
          {@const connected = netPins.filter((p) => progress.pins[pinKey(c.ref, p.num)]).length}
          <article class="card" class:finished={compDone(c.ref)}>
            <header>
              <label class="placed" title="I have put this part on the board">
                <input
                  type="checkbox"
                  checked={placed}
                  onchange={(e) => store.toggleComponentDone(c.ref, (e.target as HTMLInputElement).checked)}
                />
                <span class="ref mono">{c.ref}</span>
                <span class="value">{c.value}</span>
              </label>
              <span class="count" class:ok={connected === netPins.length && netPins.length > 0}>
                {connected}/{netPins.length} pins
              </span>
            </header>
            {#if c.footprint || c.description}
              <div class="fp faint">{c.description ?? ''} {c.footprint ? `· ${c.footprint}` : ''}</div>
            {/if}

            {#if c.pins.length > 2}
              <div class="diagram">
                <ChipDiagram
                  comp={c}
                  pkg={project.packages[c.ref]}
                  {hoverNet}
                  done={(pin) => !!progress.pins[pinKey(c.ref, pin)]}
                  netOf={(pin) => netOfPin.get(pinKey(c.ref, pin))}
                  ontoggle={(pin) => store.togglePinDone(pinKey(c.ref, pin))}
                  onhover={(n) => (hoverNet = n)}
                />
              </div>
            {/if}

            <ul class="pins">
              {#each c.pins as p (p.num)}
                {@const k = pinKey(c.ref, p.num)}
                {@const net = netOfPin.get(k)}
                <li class:nc={!net} class:hl={!!net && hoverNet === net}>
                  <label>
                    {#if net}
                      <input
                        type="checkbox"
                        checked={!!progress.pins[k]}
                        onchange={(e) => store.togglePinDone(k, (e.target as HTMLInputElement).checked)}
                      />
                    {:else}
                      <span class="nc-box" title="Not connected in the netlist"></span>
                    {/if}
                    <span class="pin mono">{p.num}</span>
                    <span class="pname mono">{p.name ?? ''}</span>
                  </label>
                  <span
                    class="net mono"
                    role="presentation"
                    onmouseenter={() => (hoverNet = net ?? null)}
                    onmouseleave={() => (hoverNet = null)}>{net ?? 'no connection'}</span
                  >
                  {#if net}
                    <span class="others">
                      {#each others(c.ref, p.num) as o (o.key)}
                        <span class="other mono" class:done={o.done}>{o.key}</span>
                      {:else}
                        <span class="faint">only pin in net</span>
                      {/each}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if netPins.length > 1}
              <div class="card-actions">
                <button class="ghost small" onclick={() => setAllPins(c.ref, connected !== netPins.length)}>
                  {connected === netPins.length ? 'Clear all pins' : 'Check all pins'}
                </button>
              </div>
            {/if}
          </article>
        {:else}
          <p class="empty">No parts match.</p>
        {/each}
      </div>
    {:else}
      <div class="grid nets">
        {#each nets as n (n.name)}
          {@const doneCount = n.nodes.filter((x) => progress.pins[pinKey(x.ref, x.pin)]).length}
          <article class="card" class:finished={doneCount === n.nodes.length}>
            <header>
              <span class="ref mono">{n.name}</span>
              <span class="count" class:ok={doneCount === n.nodes.length}>{doneCount}/{n.nodes.length}</span>
            </header>
            <ul class="pins">
              {#each n.nodes as node (pinKey(node.ref, node.pin))}
                {@const k = pinKey(node.ref, node.pin)}
                {@const comp = nl.components.find((c) => c.ref === node.ref)}
                <li>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!progress.pins[k]}
                      onchange={(e) => store.togglePinDone(k, (e.target as HTMLInputElement).checked)}
                    />
                    <span class="pin mono wide">{k}</span>
                    <span class="pname mono">{pinName(node.ref, node.pin) ?? ''}</span>
                  </label>
                  <span class="others faint">
                    {comp?.value ?? ''}
                    {#if !progress.components[node.ref]}<span class="warn">· part not placed</span>{/if}
                  </span>
                </li>
              {/each}
            </ul>
            <div class="card-actions">
              <button class="ghost small" onclick={() => setNetPins(n.name, doneCount !== n.nodes.length)}>
                {doneCount === n.nodes.length ? 'Clear net' : 'Check whole net'}
              </button>
            </div>
          </article>
        {:else}
          <p class="empty">No nets match.</p>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .checklist {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-wrap: wrap;
  }
  .seg {
    display: flex;
  }
  .seg button {
    border-radius: 0;
  }
  .seg button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
  }
  .seg button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
    margin-left: -1px;
  }
  .search {
    width: 240px;
  }
  .toggle {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
  }
  .spacer {
    flex: 1;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    color: var(--muted);
    min-width: 130px;
  }
  .stat b {
    color: var(--text);
  }
  .content {
    flex: 1;
    overflow: auto;
    padding: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .grid.nets {
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .card.finished {
    border-color: rgba(60, 207, 142, 0.45);
    background: linear-gradient(0deg, var(--panel), var(--panel)) padding-box;
    box-shadow: inset 3px 0 0 var(--ok);
  }
  .card header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .placed {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    min-width: 0;
  }
  .ref {
    font-weight: 700;
    font-size: 15px;
  }
  .value {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 12px;
    color: var(--faint);
    white-space: nowrap;
  }
  .count.ok {
    color: var(--ok);
  }
  .fp {
    font-size: 11.5px;
    margin-top: 4px;
    overflow-wrap: anywhere;
  }
  .diagram {
    display: flex;
    justify-content: center;
    padding: 14px 0 6px;
    overflow-x: auto;
  }
  .pins {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    font-size: 13px;
  }
  .pins li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    padding: 5px 4px;
    border-top: 1px solid var(--border);
    border-radius: 4px;
  }
  .pins li.hl {
    background: var(--warn-soft);
  }
  .pins li.nc {
    opacity: 0.55;
  }
  .pins label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    grid-row: span 2;
    align-self: start;
    min-width: 92px;
  }
  .nc-box {
    width: 15px;
    height: 15px;
    border: 1px dashed var(--faint);
    border-radius: 3px;
  }
  .pin {
    min-width: 18px;
    font-weight: 600;
  }
  .pin.wide {
    min-width: 52px;
  }
  .pname {
    color: var(--muted);
    font-size: 12px;
  }
  .net {
    font-weight: 600;
    color: #cfe1ff;
    cursor: default;
    word-break: break-all;
  }
  .others {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    font-size: 11.5px;
  }
  .other {
    background: var(--panel-2);
    border-radius: 4px;
    padding: 0 5px;
    color: var(--muted);
  }
  .other.done {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .warn {
    color: var(--warn);
  }
  .card-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 6px;
  }
  .small {
    font-size: 12px;
    padding: 3px 8px;
    color: var(--muted);
  }
  .empty {
    color: var(--faint);
  }
</style>
