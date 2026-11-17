<script lang="ts">
  import type { Component } from '../netlist/types';
  import type { PackageSpec } from '../packages';

  let {
    comp,
    pkg,
    done,
    netOf,
    hoverNet = null,
    ontoggle,
    onhover,
  }: {
    comp: Component;
    pkg: PackageSpec;
    done: (pin: string) => boolean;
    netOf: (pin: string) => string | undefined;
    hoverNet?: string | null;
    ontoggle: (pin: string) => void;
    onhover: (net: string | null) => void;
  } = $props();

  const P = 20; // pin pitch in px
  const n = $derived(comp.pins.length);
  const dip = $derived(pkg.kind === 'dip' && n >= 4);
  const half = $derived(Math.ceil(n / 2));

  interface PinBox {
    num: string;
    name?: string;
    x: number;
    y: number;
    side: 'left' | 'right' | 'bottom';
  }

  const layout = $derived.by(() => {
    const boxes: PinBox[] = [];
    if (dip) {
      const bodyW = 132;
      comp.pins.forEach((p, i) => {
        if (i < half) boxes.push({ num: p.num, name: p.name, x: 0, y: 14 + i * P, side: 'left' });
        else boxes.push({ num: p.num, name: p.name, x: bodyW + 28, y: 14 + (n - 1 - i) * P, side: 'right' });
      });
      return { boxes, w: bodyW + 56, h: half * P + 18, bodyW };
    }
    comp.pins.forEach((p, i) => boxes.push({ num: p.num, name: p.name, x: 14 + i * 34, y: 52, side: 'bottom' }));
    return { boxes, w: Math.max(80, n * 34 + 10), h: 70, bodyW: 0 };
  });
</script>

<svg width={layout.w} height={layout.h} viewBox="0 0 {layout.w} {layout.h}" class="chip" role="group" aria-label="{comp.ref} pins">
  {#if dip}
    <rect class="body" x="26" y="2" width={layout.bodyW} height={layout.h - 4} rx="4" />
    <path class="notch" d="M {26 + layout.bodyW / 2 - 9} 2 A 9 9 0 0 0 {26 + layout.bodyW / 2 + 9} 2 Z" />
    <text class="body-label" x={26 + layout.bodyW / 2} y={layout.h / 2}>{comp.value || comp.ref}</text>
  {:else}
    <rect class="body" x="4" y="6" width={layout.w - 8} height="30" rx="4" />
    <text class="body-label" x={layout.w / 2} y="21">{comp.value || comp.ref}</text>
  {/if}

  {#each layout.boxes as b (b.num)}
    {@const net = netOf(b.num)}
    {@const isDone = done(b.num)}
    <g
      class="pin"
      class:done={isDone}
      class:nc={!net}
      class:hl={!!net && hoverNet === net}
      transform="translate({b.x} {b.y})"
      role="checkbox"
      aria-checked={isDone}
      aria-label="Pin {b.num}{b.name ? ` ${b.name}` : ''}{net ? `, net ${net}` : ', no net'}"
      tabindex={net ? 0 : -1}
      onclick={() => net && ontoggle(b.num)}
      onkeydown={(e) => {
        if (net && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault();
          ontoggle(b.num);
        }
      }}
      onmouseenter={() => onhover(net ?? null)}
      onmouseleave={() => onhover(null)}
    >
      <title>{b.num}{b.name ? ` ${b.name}` : ''} · {net ?? 'no net'}</title>
      {#if b.side === 'bottom'}
        <rect x="0" y="-16" width="26" height="12" class="lead" />
        <rect x="0" y="0" width="26" height="16" rx="3" class="box" />
        <text x="13" y="8.5" class="num">{b.num}</text>
        {#if b.name}<text x="13" y="-24" class="name">{b.name.slice(0, 5)}</text>{/if}
      {:else}
        <rect x="0" y="0" width="26" height="16" rx="3" class="box" />
        <text x="13" y="8.5" class="num">{b.num}</text>
        {#if b.name}
          <text
            x={b.side === 'left' ? 32 : -6}
            y="8.5"
            class="name"
            style="text-anchor: {b.side === 'left' ? 'start' : 'end'}">{b.name.slice(0, 8)}</text
          >
        {/if}
      {/if}
    </g>
  {/each}
</svg>

<style>
  .chip {
    display: block;
    overflow: visible;
  }
  .body {
    fill: #262931;
    stroke: #3b4150;
  }
  .notch {
    fill: #15171c;
  }
  .body-label {
    fill: #6b7283;
    font-size: 11px;
    text-anchor: middle;
    dominant-baseline: central;
    font-family: var(--mono);
  }
  .pin {
    cursor: pointer;
    outline: none;
  }
  .pin.nc {
    cursor: default;
  }
  .box {
    fill: #323744;
    stroke: #4a5060;
  }
  .lead {
    fill: #4a5060;
  }
  .pin:hover .box,
  .pin:focus-visible .box {
    stroke: var(--accent);
  }
  .pin.hl .box {
    stroke: var(--warn);
    stroke-width: 2;
  }
  .pin.done .box {
    fill: var(--ok);
    stroke: #26a56e;
  }
  .pin.done .num {
    fill: #062015;
  }
  .pin.nc .box {
    fill: transparent;
    stroke-dasharray: 3 2;
  }
  .num {
    font-size: 10.5px;
    font-family: var(--mono);
    text-anchor: middle;
    dominant-baseline: central;
    fill: var(--text);
    pointer-events: none;
  }
  .name {
    font-size: 10px;
    fill: var(--muted);
    dominant-baseline: central;
    text-anchor: middle;
    font-family: var(--mono);
    pointer-events: none;
  }
</style>
