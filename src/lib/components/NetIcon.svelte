<script lang="ts">
  import type { NetState } from '../connectivity';
  let { state }: { state: NetState } = $props();
  const titles: Record<NetState, string> = {
    complete: 'All pins connected',
    partial: 'Some pins are not connected yet',
    unplaced: 'No pins placed',
    short: 'Short circuit with another net',
  };
</script>

<svg viewBox="0 0 16 16" width="14" height="14" class={state} role="img" aria-label={titles[state]}>
  <title>{titles[state]}</title>
  {#if state === 'complete'}
    <circle cx="8" cy="8" r="7" />
    <path d="M4.5 8.2 L7 10.5 L11.5 5.5" />
  {:else if state === 'partial'}
    <circle cx="8" cy="8" r="6.2" class="ring" />
    <path d="M8 1.8 A6.2 6.2 0 0 1 8 14.2 Z" class="half" />
  {:else if state === 'short'}
    <path d="M8 1.5 L15 14 L1 14 Z" />
    <path d="M8 6 L8 9.5 M8 11.6 L8 11.8" class="mark" />
  {:else}
    <circle cx="8" cy="8" r="6.2" class="ring" />
  {/if}
</svg>

<style>
  svg {
    flex: none;
  }
  .complete circle {
    fill: var(--ok);
  }
  .complete path {
    fill: none;
    stroke: #0b1f14;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ring {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
  }
  .partial {
    color: var(--warn);
  }
  .half {
    fill: var(--warn);
  }
  .unplaced {
    color: var(--faint);
  }
  .short path:first-child {
    fill: var(--bad);
  }
  .short .mark {
    stroke: #1a0505;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
</style>
