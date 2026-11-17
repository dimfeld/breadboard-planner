<script lang="ts">
  import type { Component } from '../netlist/types';
  import type { PackageSpec, Point } from '../packages';
  import { type Placement, pinPositions } from '../project';
  import { bodyStyle, ledColor, resistorBands } from '../visual';

  let {
    comp,
    pkg,
    placement,
    selected = false,
    done = false,
    ghost = false,
    buildMode = false,
    showHandles = false,
  }: {
    comp: Component;
    pkg: PackageSpec;
    placement: Placement;
    selected?: boolean;
    done?: boolean;
    ghost?: boolean;
    buildMode?: boolean;
    showHandles?: boolean;
  } = $props();

  const pins = $derived(pinPositions(comp, pkg, placement));
  const pinList = $derived(comp.pins.map((p) => ({ num: p.num, pt: pins[p.num] })));
  const n = $derived(comp.pins.length);

  const bbox = $derived.by(() => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const { pt } of pinList) {
      x0 = Math.min(x0, pt.x);
      y0 = Math.min(y0, pt.y);
      x1 = Math.max(x1, pt.x);
      y1 = Math.max(y1, pt.y);
    }
    if (!Number.isFinite(x0)) return { x0: placement.x, y0: placement.y, x1: placement.x, y1: placement.y };
    return { x0, y0, x1, y1 };
  });
  const center = $derived({ x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2 });

  const style = $derived(bodyStyle(comp.ref, comp.value, comp.footprint));

  // Geometry for two-lead parts.
  const two = $derived.by(() => {
    if (pkg.kind !== 'leads' || n !== 2) return null;
    const a = pinList[0].pt;
    const b = pinList[1].pt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      len,
    };
  });

  const bands = $derived(style === 'resistor' ? resistorBands(comp.value) : undefined);

  function labelPos(): Point {
    if (pkg.kind === 'leads') {
      if (two && two.len > 0) {
        // Put the label beside the body, away from the lead direction.
        const rad = (two.angle * Math.PI) / 180;
        const nx = -Math.sin(rad);
        const ny = Math.cos(rad);
        const off = style === 'led' || style === 'electrolytic' ? 1.25 : 0.95;
        const side = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1;
        return { x: two.mid.x + nx * off * side, y: two.mid.y + ny * off * side };
      }
      return { x: center.x, y: bbox.y0 - 1.1 };
    }
    return center;
  }
  const label = $derived(labelPos());
  const rigid = $derived(pkg.kind !== 'leads');
</script>

<g
  class="part"
  class:selected
  class:done
  class:ghost
  class:build={buildMode}
  data-kind={ghost ? undefined : 'component'}
  data-ref={comp.ref}
>
  {#if pkg.kind === 'dip'}
    {@const cols = Math.ceil(n / 2)}
    <g transform="translate({placement.x} {placement.y}) rotate({placement.rotation * 90})">
      {#each Array.from({ length: cols }, (_, i) => i) as i (i)}
        <rect class="leg" x={i - 0.14} y={-0.12} width="0.28" height="0.55" />
        <rect class="leg" x={i - 0.14} y={pkg.rowSpacing - 0.43} width="0.28" height="0.55" />
      {/each}
      <rect
        class="ic outline"
        x={-0.48}
        y={0.38}
        width={cols - 1 + 0.96}
        height={Math.max(0.5, pkg.rowSpacing - 0.76)}
        rx="0.12"
      />
      <path
        class="notch"
        d="M {-0.48} {pkg.rowSpacing / 2 - 0.32} A 0.32 0.32 0 0 1 {-0.48} {pkg.rowSpacing / 2 + 0.32} Z"
      />
      <circle class="pin1" cx={0} cy={pkg.rowSpacing - 0.75} r="0.12" />
    </g>
  {:else if pkg.kind === 'sip'}
    <g transform="translate({placement.x} {placement.y}) rotate({placement.rotation * 90})">
      <rect class="header outline" x={-0.47} y={-0.47} width={n - 1 + 0.94} height="0.94" rx="0.08" />
      {#each Array.from({ length: n }, (_, i) => i) as i (i)}
        <rect class="pinsq" class:first={i === 0} x={i - 0.17} y={-0.17} width="0.34" height="0.34" />
      {/each}
    </g>
  {:else if two && two.len > 0}
    {@const L = two.len}
    <g transform="translate({two.mid.x} {two.mid.y}) rotate({two.angle})">
      <line class="lead" x1={-L / 2} y1="0" x2={L / 2} y2="0" />
      {#if style === 'resistor'}
        {@const bl = Math.max(1.1, Math.min(2.6, L - 0.7))}
        <rect class="resistor outline" x={-bl / 2} y={-0.36} width={bl} height="0.72" rx="0.3" />
        {#if bands}
          {#each bands as color, i (i)}
            {@const bx = -bl / 2 + bl * (i < 3 ? 0.22 + i * 0.16 : 0.8)}
            <rect x={bx - 0.07} y={-0.36} width="0.14" height="0.72" fill={color} />
          {/each}
        {/if}
      {:else if style === 'led'}
        <circle class="outline led" cx="0" cy="0" r="0.8" fill={ledColor(comp.value)} />
        <!-- The flat side marks the cathode, pin 1 in KiCad. -->
        <line class="led-flat" x1={-0.62} y1={-0.5} x2={-0.62} y2={0.5} />
        <circle cx="0.2" cy="-0.2" r="0.22" fill="rgba(255,255,255,0.55)" />
      {:else if style === 'electrolytic'}
        {#if L <= 2.2}
          <circle class="outline elec" cx="0" cy="0" r="0.95" />
          <path class="elec-stripe" d="M 0.55 -0.77 A 0.95 0.95 0 0 1 0.55 0.77 L 0.75 0.58 A 0.95 0.95 0 0 0 0.75 -0.58 Z" />
          <text class="polarity" x="-0.42" y="0">+</text>
        {:else}
          {@const bl = Math.min(2.6, L - 0.7)}
          <rect class="outline elec" x={-bl / 2} y={-0.5} width={bl} height="1" rx="0.2" />
          <rect class="elec-stripe" x={bl / 2 - 0.45} y={-0.5} width="0.3" height="1" />
        {/if}
      {:else if style === 'ceramic'}
        <ellipse class="outline ceramic" cx="0" cy="0" rx={Math.min(0.75, Math.max(0.5, L / 2))} ry="0.5" />
      {:else if style === 'diode'}
        {@const bl = Math.max(1, Math.min(2.2, L - 0.8))}
        <rect class="outline diode" x={-bl / 2} y={-0.32} width={bl} height="0.64" rx="0.12" />
        <rect class="diode-band" x={-bl / 2 + 0.15} y={-0.32} width="0.2" height="0.64" />
      {:else if style === 'inductor'}
        {@const bl = Math.max(1.1, Math.min(2.4, L - 0.7))}
        <rect class="outline inductor" x={-bl / 2} y={-0.42} width={bl} height="0.84" rx="0.4" />
      {:else}
        {@const bl = Math.max(0.9, Math.min(2.4, L - 0.7))}
        <rect class="outline generic" x={-bl / 2} y={-0.4} width={bl} height="0.8" rx="0.15" />
      {/if}
    </g>
  {:else}
    {#each pinList as p (p.num)}
      <line class="lead" x1={p.pt.x} y1={p.pt.y} x2={center.x} y2={center.y} />
    {/each}
    {#if style === 'transistor' && n === 3}
      <g transform="translate({center.x} {center.y}) rotate({placement.rotation * 90})">
        <path class="outline transistor" d="M -1.25 0.15 L 1.25 0.15 L 1.25 -0.1 A 1.3 0.9 0 0 0 -1.25 -0.1 Z" />
      </g>
    {:else}
      <rect
        class="outline generic"
        x={center.x - 0.7}
        y={center.y - 0.5}
        width="1.4"
        height="1"
        rx="0.15"
      />
    {/if}
  {/if}

  {#if !rigid}
    {#each pinList as p, i (p.num)}
      <circle class="lead-end" class:first={i === 0} cx={p.pt.x} cy={p.pt.y} r="0.17" />
    {/each}
  {/if}

  <text class="label" class:on-body={rigid} x={label.x} y={label.y}>
    <tspan class="ref">{comp.ref}</tspan>
    {#if rigid && comp.value && (pkg.kind === 'dip' ? n >= 6 : n >= 4)}
      <tspan class="value" dx="0.3">{comp.value}</tspan>
    {/if}
  </text>

  {#if done && !ghost}
    <g class="check" transform="translate({rigid ? bbox.x1 + 0.5 : label.x + 1.1} {rigid ? bbox.y0 - 0.5 : label.y})">
      <circle r="0.42" />
      <path d="M -0.2 0 L -0.04 0.16 L 0.22 -0.14" />
    </g>
  {/if}

  {#if showHandles && !ghost}
    {#each pinList as p (p.num)}
      <circle class="handle" data-kind="lead" data-ref={comp.ref} data-pin={p.num} cx={p.pt.x} cy={p.pt.y} r="0.36" />
    {/each}
  {/if}
</g>

<style>
  .part {
    cursor: grab;
  }
  .part.build {
    cursor: pointer;
  }
  .part.ghost {
    opacity: 0.6;
    pointer-events: none;
  }
  .part.build.done {
    opacity: 0.45;
  }
  .outline {
    stroke: rgba(0, 0, 0, 0.35);
    stroke-width: 0.05;
  }
  .selected .outline {
    stroke: var(--accent);
    stroke-width: 0.16;
  }
  .part.build:not(.done) .outline {
    stroke: #f5b74e;
    stroke-width: 0.14;
    stroke-dasharray: 0.3 0.2;
  }
  .ic {
    fill: #26272b;
  }
  .header {
    fill: #1e1e20;
  }
  .notch {
    fill: #0f0f11;
  }
  .pin1 {
    fill: #6b6d75;
  }
  .leg {
    fill: #b8bcc4;
  }
  .pinsq {
    fill: #d8b54a;
  }
  .pinsq.first {
    fill: #f0d070;
  }
  .lead {
    stroke: #aeb3bb;
    stroke-width: 0.12;
    stroke-linecap: round;
  }
  .lead-end {
    fill: #c9cdd4;
    stroke: #6f747c;
    stroke-width: 0.04;
  }
  .resistor {
    fill: #e7cf9e;
  }
  .led {
    fill-opacity: 0.88;
  }
  .led-flat {
    stroke: rgba(0, 0, 0, 0.45);
    stroke-width: 0.1;
  }
  .elec {
    fill: #2c4a8c;
  }
  .elec-stripe {
    fill: #c9d4ea;
  }
  .polarity {
    font-size: 0.6px;
    fill: #fff;
    text-anchor: middle;
    dominant-baseline: central;
    font-weight: 700;
  }
  .ceramic {
    fill: #e9a23b;
  }
  .diode {
    fill: #222;
  }
  .diode-band {
    fill: #ccc;
  }
  .inductor {
    fill: #4f7a5a;
  }
  .transistor {
    fill: #222;
  }
  .generic {
    fill: #5b6170;
  }
  .label {
    font-size: 0.6px;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
    fill: #1e2128;
    paint-order: stroke;
    stroke: rgba(242, 238, 229, 0.92);
    stroke-width: 0.18;
    stroke-linejoin: round;
  }
  .label.on-body {
    fill: #f2f2f2;
    stroke: none;
  }
  .ref {
    font-weight: 700;
  }
  .value {
    font-weight: 400;
    opacity: 0.85;
  }
  .check circle {
    fill: var(--ok);
    stroke: #0b3d26;
    stroke-width: 0.05;
  }
  .check path {
    fill: none;
    stroke: #0b1f14;
    stroke-width: 0.11;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .handle {
    fill: rgba(91, 156, 255, 0.25);
    stroke: var(--accent);
    stroke-width: 0.07;
    cursor: crosshair;
  }
  .handle:hover {
    fill: rgba(91, 156, 255, 0.5);
  }
</style>
