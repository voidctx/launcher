export class TokenizeError extends Error {
  constructor(message, offset) {
    super(message);
    this.name = 'TokenizeError';
    this.offset = offset;
  }
}

const P4 = new Set(['>>>=']);
const P3 = new Set(['...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=']);
const P2 = new Set([
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
  '+=', '-=', '*=', '%=', '&=', '|=', '^=', '<<', '>>', '**'
]);

const REGEX_AFTER = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await'
]);

const EXPR_BEFORE_BRACE = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'yield', 'await'
]);

const CTRL_KEYWORDS = new Set(['if', 'while', 'for', 'with']);

const WS_RE = /\s/;
const NUM_RE = /0[xX][0-9a-fA-F_]+n?|0[oO][0-7_]+n?|0[bB][01_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?/y;

function isLT(c) {
  return c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
}

function isDigit(code) {
  return code >= 48 && code <= 57;
}

function isIdStartCode(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
    code === 95 || code === 36 || code > 127;
}

function isIdPartCode(code) {
  return isIdStartCode(code) || isDigit(code);
}

function regexAllowed(prev) {
  if (!prev) return true;
  switch (prev.type) {
    case 'number':
    case 'string':
    case 'regex':
      return false;
    case 'template':
      return prev.open === true;
    case 'name':
      return !prev.prevDot && REGEX_AFTER.has(prev.value);
    case 'punct': {
      const v = prev.value;
      if (v === ')') return prev.ctrl === true;
      if (v === '}') return prev.block === true;
      if (v === ']' || v === '++' || v === '--') return false;
      return true;
    }
    default:
      return true;
  }
}

function braceIsBlock(prev) {
  if (!prev) return true;
  if (prev.type === 'punct') {
    const v = prev.value;
    return v === ')' || v === ';' || v === '{' || v === '}' || v === '=>';
  }
  if (prev.type === 'name') return prev.prevDot ? false : !EXPR_BEFORE_BRACE.has(prev.value);
  return false;
}

function cookString(raw) {
  if (raw.indexOf('\\') === -1) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') { out += c; continue; }
    const n = raw[++i];
    if (n === undefined) break;
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case '\r': if (raw[i + 1] === '\n') i++; break;
      case '\n': case '\u2028': case '\u2029': break;
      case 'x': {
        const h = raw.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(h)) { out += String.fromCharCode(parseInt(h, 16)); i += 2; }
        else out += 'x';
        break;
      }
      case 'u': {
        if (raw[i + 1] === '{') {
          const end = raw.indexOf('}', i + 2);
          const h = end === -1 ? '' : raw.slice(i + 2, end);
          if (/^[0-9a-fA-F]{1,6}$/.test(h) && parseInt(h, 16) <= 0x10ffff) {
            out += String.fromCodePoint(parseInt(h, 16));
            i = end;
          } else out += 'u';
        } else {
          const h = raw.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(h)) { out += String.fromCharCode(parseInt(h, 16)); i += 4; }
          else out += 'u';
        }
        break;
      }
      default: out += n;
    }
  }
  return out;
}

export function computeLineStarts(src) {
  const lineStarts = [0];
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const c = src.charCodeAt(i);
    if (c === 13) {
      if (src.charCodeAt(i + 1) === 10) i++;
      lineStarts.push(i + 1);
    } else if (c === 10 || c === 0x2028 || c === 0x2029) {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

export function tokenize(src) {
  const n = src.length;
  const tokens = [];
  const lineStarts = computeLineStarts(src);

  let pos = 0;
  let nest = 0;
  const braceStack = [];
  const parenStack = [];

  const last = () => tokens[tokens.length - 1];

  function add(type, value, start, end, extra) {
    const p = last();
    const tok = {
      type, value, start, end,
      depth: nest,
      prevDot: !!p && p.type === 'punct' && (p.value === '.' || p.value === '?.')
    };
    if (extra) Object.assign(tok, extra);
    tokens.push(tok);
    return tok;
  }

  function readTemplateChunk(from) {
    let i = from;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') return { end: i + 1, raw: src.slice(from, i), open: false };
      if (c === '$' && src[i + 1] === '{') return { end: i + 2, raw: src.slice(from, i), open: true };
      i++;
    }
    throw new TokenizeError('Unterminated template literal', from);
  }

  function tryReadRegex(start) {
    let i = start + 1;
    let inClass = false;
    while (i < n) {
      const c = src[i];
      if (isLT(c)) return null;
      if (c === '\\') {
        if (i + 1 >= n || isLT(src[i + 1])) return null;
        i += 2;
        continue;
      }
      if (inClass) {
        if (c === ']') inClass = false;
      } else if (c === '[') {
        inClass = true;
      } else if (c === '/') {
        i++;
        while (i < n && isIdPartCode(src.charCodeAt(i))) i++;
        return { raw: src.slice(start, i), end: i };
      }
      i++;
    }
    return null;
  }

  function readName(start) {
    let i = start;
    let value = '';
    let escaped = false;
    while (i < n) {
      const c = src[i];
      const code = src.charCodeAt(i);
      if (c === '\\') {
        if (src[i + 1] !== 'u') throw new TokenizeError('Invalid escape in identifier', i);
        let hex;
        let next;
        if (src[i + 2] === '{') {
          const close = src.indexOf('}', i + 3);
          if (close === -1) throw new TokenizeError('Invalid unicode escape in identifier', i);
          hex = src.slice(i + 3, close);
          next = close + 1;
        } else {
          hex = src.slice(i + 2, i + 6);
          next = i + 6;
        }
        if (!/^[0-9a-fA-F]{1,6}$/.test(hex) || parseInt(hex, 16) > 0x10ffff) {
          throw new TokenizeError('Invalid unicode escape in identifier', i);
        }
        value += String.fromCodePoint(parseInt(hex, 16));
        escaped = true;
        i = next;
      } else if (isIdPartCode(code) && !(code > 127 && WS_RE.test(c))) {
        value += c;
        i++;
      } else {
        break;
      }
    }
    return { value, end: i, escaped };
  }

  while (pos < n) {
    const ch = src[pos];
    const code = src.charCodeAt(pos);

    if (code === 32 || (code >= 9 && code <= 13) || (code > 127 && WS_RE.test(ch))) {
      pos++;
      continue;
    }

    if (isIdStartCode(code) || ch === '\\' ||
        (ch === '#' && pos + 1 < n && (isIdStartCode(src.charCodeAt(pos + 1)) || src[pos + 1] === '\\'))) {
      const priv = ch === '#';
      const r = readName(priv ? pos + 1 : pos);
      if (r.end === (priv ? pos + 1 : pos)) throw new TokenizeError('Unexpected character', pos);
      add('name', priv ? '#' + r.value : r.value, pos, r.end, { escaped: r.escaped });
      pos = r.end;
      continue;
    }

    if (isDigit(code) || (ch === '.' && isDigit(src.charCodeAt(pos + 1)))) {
      NUM_RE.lastIndex = pos;
      const m = NUM_RE.exec(src);
      if (!m) throw new TokenizeError('Invalid number', pos);
      add('number', m[0], pos, pos + m[0].length);
      pos += m[0].length;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let i = pos + 1;
      for (;;) {
        if (i >= n) throw new TokenizeError('Unterminated string literal', pos);
        const c = src[i];
        if (c === '\\') {
          if (src[i + 1] === '\r' && src[i + 2] === '\n') i += 3; else i += 2;
          continue;
        }
        if (c === ch) break;
        if (c === '\n' || c === '\r') throw new TokenizeError('Unterminated string literal', pos);
        i++;
      }
      add('string', cookString(src.slice(pos + 1, i)), pos, i + 1);
      pos = i + 1;
      continue;
    }

    if (ch === '`') {
      const chunk = readTemplateChunk(pos + 1);
      add('template', chunk.raw, pos, chunk.end, { head: true, open: chunk.open });
      if (chunk.open) { braceStack.push({ tpl: true }); nest++; }
      pos = chunk.end;
      continue;
    }

    if (ch === '/') {
      const nx = src[pos + 1];
      if (nx === '/') {
        pos += 2;
        while (pos < n && !isLT(src[pos])) pos++;
        continue;
      }
      if (nx === '*') {
        const end = src.indexOf('*/', pos + 2);
        if (end === -1) throw new TokenizeError('Unterminated block comment', pos);
        pos = end + 2;
        continue;
      }
      if (regexAllowed(last())) {
        const r = tryReadRegex(pos);
        if (r) {
          add('regex', r.raw, pos, r.end);
          pos = r.end;
          continue;
        }
      }
      if (nx === '=') { add('punct', '/=', pos, pos + 2); pos += 2; }
      else { add('punct', '/', pos, pos + 1); pos += 1; }
      continue;
    }

    if (ch === '{') {
      const block = braceIsBlock(last());
      add('punct', '{', pos, pos + 1);
      braceStack.push({ tpl: false, block });
      nest++;
      pos++;
      continue;
    }
    if (ch === '}') {
      const top = braceStack.pop();
      if (top && top.tpl) {
        nest = Math.max(0, nest - 1);
        const chunk = readTemplateChunk(pos + 1);
        add('template', chunk.raw, pos, chunk.end, { head: false, open: chunk.open });
        if (chunk.open) { braceStack.push({ tpl: true }); nest++; }
        pos = chunk.end;
        continue;
      }
      nest = Math.max(0, nest - 1);
      add('punct', '}', pos, pos + 1, { block: top ? top.block : false });
      pos++;
      continue;
    }
    if (ch === '(') {
      const p = last();
      parenStack.push(!!p && p.type === 'name' && !p.prevDot && CTRL_KEYWORDS.has(p.value));
      add('punct', '(', pos, pos + 1);
      nest++;
      pos++;
      continue;
    }
    if (ch === ')') {
      const ctrl = parenStack.pop() === true;
      nest = Math.max(0, nest - 1);
      add('punct', ')', pos, pos + 1, { ctrl });
      pos++;
      continue;
    }
    if (ch === '[') {
      add('punct', '[', pos, pos + 1);
      nest++;
      pos++;
      continue;
    }
    if (ch === ']') {
      nest = Math.max(0, nest - 1);
      add('punct', ']', pos, pos + 1);
      pos++;
      continue;
    }

    const s4 = src.substr(pos, 4);
    if (P4.has(s4)) { add('punct', s4, pos, pos + 4); pos += 4; continue; }
    const s3 = s4.slice(0, 3);
    if (P3.has(s3)) { add('punct', s3, pos, pos + 3); pos += 3; continue; }
    const s2 = s4.slice(0, 2);
    if (P2.has(s2) && !(s2 === '?.' && isDigit(src.charCodeAt(pos + 2)))) {
      add('punct', s2, pos, pos + 2);
      pos += 2;
      continue;
    }
    add('punct', ch, pos, pos + 1);
    pos++;
  }

  return { tokens, lineStarts };
}

export function locate(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
}
