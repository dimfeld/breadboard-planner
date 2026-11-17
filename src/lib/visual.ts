const BAND_COLORS = ['#1b1b1b', '#7a4a21', '#d33a2c', '#f08a24', '#f2d024', '#2e9e4f', '#2f6fd6', '#8a4fc7', '#8c8c8c', '#f4f4f4'];
const GOLD = '#c9a43a';
const SILVER = '#c0c0c0';

/** Parse a resistor value such as "4k7", "10k", "2.2M", "330R" or "470" into ohms. */
export function parseResistance(value: string): number | undefined {
  const v = value.trim().replace(/\s*(ohms?|Ω)$/i, '');
  const m = /^(\d*)(?:[.,](\d+))?\s*([rRkKmMgG])?(\d*)$/.exec(v);
  if (!m || (!m[1] && !m[2])) return undefined;
  const mult = { r: 1, k: 1e3, m: 1e6, g: 1e9 }[(m[3] ?? 'r').toLowerCase()] ?? 1;
  const frac = m[2] ?? m[4] ?? '';
  const n = parseFloat(`${m[1] || '0'}.${frac || '0'}`);
  return Number.isFinite(n) ? n * mult : undefined;
}

/** Four-band color code (two digits, multiplier, 5% tolerance) for a resistor value. */
export function resistorBands(value: string): string[] | undefined {
  const ohms = parseResistance(value);
  if (ohms === undefined || ohms <= 0) return undefined;
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp += 1;
  }
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  let multColor: string;
  if (exp >= 0 && exp <= 9) multColor = BAND_COLORS[exp];
  else if (exp === -1) multColor = GOLD;
  else if (exp === -2) multColor = SILVER;
  else return undefined;
  return [BAND_COLORS[d1], BAND_COLORS[d2], multColor, GOLD];
}

export type BodyStyle = 'resistor' | 'ceramic' | 'electrolytic' | 'led' | 'diode' | 'inductor' | 'transistor' | 'generic';

/** Parse a capacitance value into farads. */
function parseCapacitance(value: string): number | undefined {
  const m = /^(\d+(?:[.,]\d+)?)\s*([pnuµm]?)F?/i.exec(value.trim());
  if (!m) return undefined;
  const mult = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, '': 1 }[m[2].toLowerCase()] ?? 1;
  return parseFloat(m[1].replace(',', '.')) * mult;
}

export function bodyStyle(ref: string, value: string, footprint: string): BodyStyle {
  const prefix = /^[A-Za-z]+/.exec(ref)?.[0].toUpperCase() ?? '';
  if (prefix === 'R' || prefix === 'RV') return 'resistor';
  if (prefix === 'C') {
    const f = parseCapacitance(value);
    if (/CP_|Elec|Radial_D\d/i.test(footprint) || (f !== undefined && f >= 1e-6)) return 'electrolytic';
    return 'ceramic';
  }
  if (/LED/i.test(prefix) || /LED/i.test(footprint) || /LED/i.test(value)) return 'led';
  if (prefix === 'D') return 'diode';
  if (prefix === 'L') return 'inductor';
  if (prefix === 'Q' || /TO-92/i.test(footprint)) return 'transistor';
  return 'generic';
}

export function ledColor(value: string): string {
  const v = value.toLowerCase();
  if (/green|grn/.test(v)) return '#43d17a';
  if (/blue/.test(v)) return '#4d8dff';
  if (/yellow|amber/.test(v)) return '#ffd23f';
  if (/white/.test(v)) return '#f4f4f4';
  if (/orange/.test(v)) return '#ff9a3c';
  return '#ff4d4d';
}
