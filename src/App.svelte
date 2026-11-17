<script lang="ts">
  import { store } from './lib/store.svelte';
  import ImportDialog from './lib/components/ImportDialog.svelte';
  import Planner from './lib/components/Planner.svelte';
  import Checklist from './lib/components/Checklist.svelte';
  import { type Project, uid } from './lib/project';

  let importMode = $state<'new' | 'replace' | null>(null);
  let fileInput: HTMLInputElement;
  let openError = $state('');

  const project = $derived(store.project);

  function exportProject() {
    if (!project) return;
    const blob = new Blob([JSON.stringify($state.snapshot(project), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^\w.-]+/g, '_') || 'project'}.breadboard.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function openProjectFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    openError = '';
    try {
      const data = JSON.parse(await file.text()) as Project;
      if (!data.netlist || !data.layout || !data.progress) throw new Error('This is not a project file.');
      if (store.projects.some((p) => p.id === data.id) || !data.id) data.id = uid('p_');
      data.updatedAt = Date.now();
      store.addProject(data);
    } catch (err) {
      openError = `Cannot open ${file.name}: ${(err as Error).message} To start from a netlist, use "New project".`;
    }
  }

  function deleteProject() {
    if (!project) return;
    if (confirm(`Delete the project "${project.name}"? You cannot undo this.`)) store.deleteProject(project.id);
  }
</script>

<div class="app">
  <header>
    <div class="brand">
      <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
        <rect x="2" y="6" width="28" height="20" rx="3" fill="#f1ede4" />
        <g fill="#555">
          <circle cx="8" cy="12" r="1.5" /><circle cx="13" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /><circle
            cx="23"
            cy="12"
            r="1.5"
          />
          <circle cx="8" cy="20" r="1.5" /><circle cx="13" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><circle
            cx="23"
            cy="20"
            r="1.5"
          />
        </g>
        <path d="M8 12 C10 5 21 5 23 20" stroke="#e5484d" stroke-width="2" fill="none" />
      </svg>
      <span>Breadboard Planner</span>
    </div>

    {#if project}
      <div class="project">
        {#if store.projects.length > 1}
          <select
            value={project.id}
            onchange={(e) => store.open((e.target as HTMLSelectElement).value)}
            title="Switch project"
          >
            {#each store.projects as p (p.id)}
              <option value={p.id}>{p.id === project.id ? project.name : p.name}</option>
            {/each}
          </select>
        {/if}
        <input
          class="name"
          value={project.name}
          onchange={(e) => {
            project.name = (e.target as HTMLInputElement).value || 'Untitled';
            store.touch();
          }}
          title="Project name"
        />
      </div>

      <nav class="modes">
        <button class:active={store.mode === 'planner'} onclick={() => (store.mode = 'planner')}>Visual planner</button>
        <button class:active={store.mode === 'checklist'} onclick={() => (store.mode = 'checklist')}>Checklist</button>
      </nav>
    {/if}

    <div class="spacer"></div>

    <div class="actions">
      <button onclick={() => (importMode = 'new')}>New project</button>
      {#if project}
        <button onclick={() => (importMode = 'replace')} title="Load a changed netlist and keep the layout">
          Update netlist
        </button>
        <button onclick={exportProject} title="Download the project as a JSON file">Save file</button>
      {/if}
      <button onclick={() => fileInput.click()} title="Open a project file">Open file</button>
      {#if project}
        <button class="ghost danger" onclick={deleteProject} title="Delete this project">Delete</button>
      {/if}
      <input type="file" accept=".json" bind:this={fileInput} onchange={openProjectFile} hidden />
    </div>
  </header>

  {#if openError}
    <div class="banner">
      {openError}
      <button class="ghost" onclick={() => (openError = '')}>Close</button>
    </div>
  {/if}

  <main>
    {#if !project}
      <div class="empty">
        <h1>Plan and track your breadboard builds</h1>
        <p class="muted">
          Load a netlist from KiCad (XML or S-expression), a JSON file, or a simple text list. Then lay out the parts and
          wires on virtual breadboards, or use the checklist to track each pin as you connect it.
        </p>
        <button class="primary" onclick={() => (importMode = 'new')}>Load a netlist</button>
      </div>
    {:else if store.mode === 'planner'}
      <Planner />
    {:else}
      <Checklist />
    {/if}
  </main>
</div>

{#if importMode}
  <ImportDialog mode={importMode} onclose={() => (importMode = null)} />
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .project {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .project select {
    max-width: 180px;
  }
  .name {
    width: 200px;
    background: transparent;
    border-color: transparent;
    font-weight: 600;
  }
  .name:hover {
    border-color: var(--border);
  }
  .modes {
    display: flex;
    gap: 2px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px;
  }
  .modes button {
    border: 1px solid transparent;
    background: transparent;
  }
  .modes button.active {
    background: var(--panel-2);
    border-color: var(--border-strong);
    color: var(--text);
  }
  .spacer {
    flex: 1;
  }
  .actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  main {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .empty {
    max-width: 560px;
    margin: 12vh auto 0;
    text-align: center;
    padding: 0 16px;
  }
  .empty h1 {
    font-size: 26px;
    letter-spacing: -0.02em;
  }
  .empty p {
    line-height: 1.6;
    margin-bottom: 24px;
  }
  .banner {
    background: var(--bad-soft);
    color: #ffd0d0;
    padding: 8px 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
</style>
