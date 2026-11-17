<script lang="ts">
  import { BOARD_DEFS, ROW_NAMES, type BoardInstance, boardBounds } from '../boards';

  let { board, selected = false }: { board: BoardInstance; selected?: boolean } = $props();

  const def = $derived(BOARD_DEFS[board.type]);
  const b = $derived(def.bounds);

  const terminalHoles = $derived.by(() => {
    const out: { x: number; y: number }[] = [];
    for (let c = 0; c < def.columns; c++) for (const y of def.rowY) out.push({ x: c, y });
    return out;
  });
  const railHoles = $derived(def.rails.flatMap((r) => def.railX.map((x) => ({ x, y: r.ly }))));

  const numberedColumns = $derived(
    Array.from({ length: def.columns }, (_, i) => i).filter((i) => i === 0 || (i + 1) % 5 === 0),
  );

  function railLineY(ly: number, side: 'top' | 'bottom', polarity: '+' | '-') {
    // Each rail gets a colored line on the side away from its partner rail.
    if (side === 'top') return polarity === '-' ? ly - 0.62 : ly + 0.62;
    return polarity === '+' ? ly - 0.62 : ly + 0.62;
  }
  const H = 0.19; // half hole size

  const gb = $derived(boardBounds(board));
  // Text stays upright on a vertical board.
  const upright = (x: number, y: number) => (board.vertical ? `rotate(-90 ${x} ${y})` : undefined);
  // Turned numbers are wider across the label row, so move them away from the rail lines.
  const numOff = $derived(board.vertical ? 0.8 : 1);
</script>

<g transform="translate({board.x} {board.y}){board.vertical ? ' rotate(90)' : ''}">
  <rect
    x={b.x0}
    y={b.y0}
    width={b.x1 - b.x0}
    height={b.y1 - b.y0}
    rx="0.5"
    class="body"
    class:selected
  />
  <rect x={b.x0} y={def.channelY - 0.32} width={b.x1 - b.x0} height="0.64" class="channel" />

  {#each def.rails as rail (rail.ly)}
    {@const y = railLineY(rail.ly, rail.side, rail.polarity)}
    <line
      x1={def.railX[0] - 0.6}
      x2={def.railX[def.railX.length - 1] + 0.6}
      y1={y}
      y2={y}
      class={rail.polarity === '+' ? 'rail-plus' : 'rail-minus'}
    />
    <text
      x={def.railX[0] - 1.25}
      y={rail.ly}
      transform={upright(def.railX[0] - 1.25, rail.ly)}
      class="rail-label"
      class:plus={rail.polarity === '+'}
    >
      {rail.polarity === '+' ? '+' : '−'}
    </text>
    <text
      x={def.railX[def.railX.length - 1] + 1.25}
      y={rail.ly}
      transform={upright(def.railX[def.railX.length - 1] + 1.25, rail.ly)}
      class="rail-label"
      class:plus={rail.polarity === '+'}
    >
      {rail.polarity === '+' ? '+' : '−'}
    </text>
  {/each}

  <g class="holes">
    {#each terminalHoles as h (h.x * 100 + h.y)}
      <rect x={h.x - H} y={h.y - H} width={H * 2} height={H * 2} rx="0.05" />
    {/each}
    {#each railHoles as h (h.x * 100 + h.y)}
      <rect x={h.x - H} y={h.y - H} width={H * 2} height={H * 2} rx="0.05" />
    {/each}
  </g>

  <g class="labels">
    {#each numberedColumns as c (c)}
      <text x={c} y={def.rowY[0] - numOff} transform={upright(c, def.rowY[0] - numOff)}>{c + 1}</text>
      <text x={c} y={def.rowY[9] + numOff} transform={upright(c, def.rowY[9] + numOff)}>{c + 1}</text>
    {/each}
    {#each def.rowY as y, r (y)}
      <text x={-1} {y} transform={upright(-1, y)}>{ROW_NAMES[r]}</text>
      <text x={def.columns} {y} transform={upright(def.columns, y)}>{ROW_NAMES[r]}</text>
    {/each}
  </g>

</g>

<g class="handle" data-kind="board-handle" data-id={board.id}>
  <rect x={gb.x0} y={gb.y0 - 1.5} width={Math.max(7, board.name.length * 0.45 + 2.5)} height="1.25" rx="0.3" />
  <text x={gb.x0 + 0.5} y={gb.y0 - 0.86}>⠿ {board.name}</text>
</g>

<style>
  .body {
    fill: #f2eee5;
    stroke: #cfc8b8;
    stroke-width: 0.08;
  }
  .body.selected {
    stroke: var(--accent);
    stroke-width: 0.18;
  }
  .channel {
    fill: #e2dccf;
  }
  .rail-plus {
    stroke: #e5484d;
    stroke-width: 0.1;
  }
  .rail-minus {
    stroke: #3e7bfa;
    stroke-width: 0.1;
  }
  .rail-label {
    font-size: 0.8px;
    font-weight: 700;
    fill: #3e7bfa;
    text-anchor: middle;
    dominant-baseline: central;
  }
  .rail-label.plus {
    fill: #e5484d;
  }
  .holes rect {
    fill: #4a4844;
  }
  .labels text {
    font-size: 0.5px;
    fill: #8d877a;
    text-anchor: middle;
    dominant-baseline: central;
    font-family: var(--mono);
  }
  .handle {
    cursor: grab;
  }
  .handle rect {
    fill: #2a2f3a;
    stroke: #3b4150;
    stroke-width: 0.06;
  }
  .handle:hover rect {
    fill: #343a47;
  }
  .handle text {
    font-size: 0.62px;
    fill: #cfd4df;
    dominant-baseline: central;
  }
</style>
