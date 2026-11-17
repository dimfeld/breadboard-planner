export interface Pin {
  /** Pin number as written in the netlist, for example "1" or "A3". */
  num: string;
  /** Optional pin function name, for example "VCC" or "TRIG". */
  name?: string;
}

export interface Component {
  ref: string;
  value: string;
  footprint: string;
  description?: string;
  pins: Pin[];
}

export interface NetNode {
  ref: string;
  pin: string;
}

export interface Net {
  name: string;
  nodes: NetNode[];
}

export interface Netlist {
  source: string;
  components: Component[];
  nets: Net[];
}

export function pinKey(ref: string, pin: string): string {
  return `${ref}.${pin}`;
}

/** Natural compare so that "10" sorts after "9" and "R10" after "R9". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
