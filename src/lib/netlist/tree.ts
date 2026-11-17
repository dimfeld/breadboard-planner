/**
 * A small element tree that both the XML parser and the S-expression parser
 * produce. KiCad writes the same structure in both formats, so one extractor
 * can read either.
 */
export interface El {
  name: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
}

export function child(el: El, name: string): El | undefined {
  return el.children.find((c) => c.name === name);
}

export function children(el: El, name: string): El[] {
  return el.children.filter((c) => c.name === name);
}

/** Value from an attribute, or from the text of a child element with that name. */
export function field(el: El, name: string): string | undefined {
  if (name in el.attrs) return el.attrs[name];
  const c = child(el, name);
  if (c) return c.text;
  return undefined;
}

export function descendants(el: El, name: string, out: El[] = []): El[] {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Minimal, tolerant XML parser. It is enough for netlist files. */
export function parseXml(src: string): El {
  const root: El = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: El[] = [root];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i, textEnd));
    }
    if (lt === -1) break;
    i = lt;

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      stack[stack.length - 1].text += src.slice(i + 9, end === -1 ? n : end);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<?', i) || src.startsWith('<!', i)) {
      const end = src.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      const name = src.slice(i + 2, end).trim();
      // Pop up to the matching element. Tolerate bad nesting.
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === name) {
          stack.length = s;
          break;
        }
      }
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Start tag. Find the closing '>' while respecting quoted attribute values.
    let j = i + 1;
    let quote = '';
    while (j < n) {
      const ch = src[j];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }
    let body = src.slice(i + 1, j);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const nameMatch = /^\s*([^\s/>]+)/.exec(body);
    const el: El = { name: nameMatch ? nameMatch[1] : '', attrs: {}, children: [], text: '' };
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    const attrSrc = nameMatch ? body.slice(nameMatch[0].length) : body;
    while ((m = attrRe.exec(attrSrc))) {
      el.attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    }
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
    i = j + 1;
  }

  trimText(root);
  return root;
}

function trimText(el: El) {
  el.text = el.text.trim();
  el.children.forEach(trimText);
}

/**
 * S-expression parser for KiCad netlists. A list like `(ref "R1")` becomes an
 * element named "ref" with text "R1". A list with child lists becomes an
 * element with children.
 */
export function parseSexpr(src: string): El {
  let i = 0;
  const n = src.length;

  function skipWs() {
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') i++;
      else if (ch === '#' && (i === 0 || src[i - 1] === '\n')) {
        while (i < n && src[i] !== '\n') i++;
      } else break;
    }
  }

  function readAtom(): string {
    if (src[i] === '"') {
      i++;
      let out = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n) {
          const nx = src[i + 1];
          out += nx === 'n' ? '\n' : nx;
          i += 2;
        } else {
          out += src[i++];
        }
      }
      i++;
      return out;
    }
    const start = i;
    while (i < n && !/[\s()]/.test(src[i])) i++;
    return src.slice(start, i);
  }

  function readList(): El {
    // Assumes src[i] === '('
    i++;
    skipWs();
    const name = src[i] === '(' ? '' : readAtom();
    const el: El = { name, attrs: {}, children: [], text: '' };
    const texts: string[] = [];
    while (i < n) {
      skipWs();
      if (src[i] === ')') {
        i++;
        break;
      }
      if (src[i] === '(') {
        el.children.push(readList());
      } else {
        texts.push(readAtom());
      }
    }
    el.text = texts.join(' ');
    return el;
  }

  const root: El = { name: '#root', attrs: {}, children: [], text: '' };
  while (i < n) {
    skipWs();
    if (src[i] === '(') root.children.push(readList());
    else if (i < n) i++;
  }
  return root;
}
