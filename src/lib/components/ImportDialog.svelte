<script lang="ts">
  import { store } from '../store.svelte';
  import { parseNetlist } from '../netlist/parse';
  import type { Netlist } from '../netlist/types';
  import { SAMPLE_555_KICAD_XML, TEXT_FORMAT_EXAMPLE } from '../samples';

  let { mode, onclose }: { mode: 'new' | 'replace'; onclose: () => void } = $props();

  let text = $state('');
  let filename = $state('');
  let name = $state('');
  let dragging = $state(false);
  let showHelp = $state(false);

  const parsed = $derived.by((): { netlist?: Netlist; error?: string } => {
    if (!text.trim()) return {};
    try {
      return { netlist: parseNetlist(text, filename) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  async function loadFile(file: File) {
    filename = file.name;
    text = await file.text();
    if (!name) name = file.name.replace(/\.[^.]+$/, '');
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (file) loadFile(file);
  }

  function useSample() {
    text = SAMPLE_555_KICAD_XML;
    filename = 'blinker.xml';
    if (!name) name = '555 LED blinker';
  }

  function submit() {
    const nl = parsed.netlist;
    if (!nl) return;
    if (mode === 'new') store.newProject(name.trim() || 'Untitled', nl);
    else store.replaceNetlist(nl);
    onclose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
    <h2 id="import-title">{mode === 'new' ? 'New project from a netlist' : 'Update the netlist'}</h2>
    {#if mode === 'replace'}
      <p class="muted small">
        The layout stays for parts that are still in the netlist. Parts that are not in the new netlist go away.
      </p>
    {/if}

    {#if mode === 'new'}
      <label class="field">
        <span>Project name</span>
        <input bind:value={name} placeholder="My circuit" />
      </label>
    {/if}

    <div
      class="drop"
      class:dragging
      role="region"
      aria-label="Netlist file drop area"
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
    >
      <label class="file">
        <input
          type="file"
          accept=".xml,.net,.json,.txt,.sch,.csv"
          onchange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) loadFile(f);
          }}
        />
        <span>Choose a file</span>
      </label>
      <span class="muted">or drop it here, or paste the netlist below.</span>
      {#if mode === 'new'}
        <button class="ghost link" onclick={useSample}>Use the 555 sample</button>
      {/if}
    </div>

    <textarea
      bind:value={text}
      oninput={() => (filename = '')}
      spellcheck="false"
      placeholder={TEXT_FORMAT_EXAMPLE}
      rows="12"
    ></textarea>

    <div class="status">
      {#if parsed.error}
        <span class="bad">{parsed.error}</span>
      {:else if parsed.netlist}
        <span class="ok">
          {parsed.netlist.source}: {parsed.netlist.components.length} components, {parsed.netlist.nets.length} nets
        </span>
      {:else}
        <span class="faint">No netlist yet.</span>
      {/if}
      <button class="ghost link" onclick={() => (showHelp = !showHelp)}>
        {showHelp ? 'Hide formats' : 'Supported formats'}
      </button>
    </div>

    {#if showHelp}
      <div class="help">
        <p><strong>KiCad:</strong> In the schematic editor, use File → Export → Netlist. Both the default S-expression <code>.net</code> file and the KiCad XML file work.</p>
        <p><strong>Generic XML:</strong> <code>&lt;net name="..."&gt;</code> elements with <code>&lt;node ref="R1" pin="2"/&gt;</code> (or <code>pinref part= pin=</code>, as in Eagle schematics) children, plus optional component elements.</p>
        <p><strong>JSON:</strong></p>
        <pre>{`{
  "components": [{ "ref": "U1", "value": "NE555", "footprint": "DIP-8",
                   "pins": [{ "num": "1", "name": "GND" }] }],
  "nets": [{ "name": "VCC", "nodes": ["U1.8", "R1.1"] }]
}`}</pre>
        <p><strong>Text:</strong></p>
        <pre>{TEXT_FORMAT_EXAMPLE}</pre>
      </div>
    {/if}

    {#if parsed.netlist}
      <details class="preview">
        <summary>Preview components</summary>
        <table>
          <tbody>
            {#each parsed.netlist.components as c (c.ref)}
              <tr>
                <td class="mono">{c.ref}</td>
                <td>{c.value}</td>
                <td class="faint">{c.footprint}</td>
                <td class="faint">{c.pins.length} pins</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </details>
    {/if}

    <div class="buttons">
      <button onclick={onclose}>Cancel</button>
      <button class="primary" disabled={!parsed.netlist} onclick={submit}>
        {mode === 'new' ? 'Create project' : 'Update netlist'}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 7, 10, 0.65);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6vh 16px;
    z-index: 50;
    overflow: auto;
  }
  .dialog {
    width: min(720px, 100%);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .small {
    margin: 0;
    font-size: 13px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  .drop {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    padding: 14px;
    border: 1px dashed var(--border-strong);
    border-radius: 8px;
  }
  .drop.dragging {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .file input {
    display: none;
  }
  .file span {
    display: inline-block;
    padding: 5px 10px;
    border-radius: var(--radius);
    background: var(--panel-2);
    border: 1px solid var(--border-strong);
    cursor: pointer;
  }
  .link {
    color: var(--accent);
    padding: 2px 4px;
  }
  textarea {
    font-family: var(--mono);
    font-size: 12px;
    resize: vertical;
    line-height: 1.45;
  }
  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
  }
  .ok {
    color: var(--ok);
  }
  .bad {
    color: var(--bad);
  }
  .help {
    font-size: 13px;
    background: var(--bg);
    border-radius: 8px;
    padding: 4px 14px;
    color: var(--muted);
  }
  .help pre {
    background: var(--panel-2);
    padding: 8px 10px;
    border-radius: 6px;
    overflow: auto;
    color: var(--text);
  }
  .preview {
    font-size: 13px;
  }
  .preview table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6px;
  }
  .preview td {
    padding: 3px 6px;
    border-bottom: 1px solid var(--border);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
