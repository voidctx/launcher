import crypto from 'node:crypto';
import { analyze } from './source.mjs';
import { computeLineStarts, locate } from './tokenizer.mjs';
import { SCAN_DEFAULTS, DENY_MODULES, UNSUPPORTED_GLOBALS } from './config.mjs';

/**
 * Deploy-time scanner.
 *
 *   scan(code, options?) -> {
 *     verdict:  'approved' | 'flagged' | 'rejected',
 *     reasons:  [{ id, severity, title, message, line?, column?, snippet? }],
 *     summary:  { high, medium, low },
 *     stats:    { bytes, lines, tokens },
 *     sha256:   hash of the exact code that was scanned,
 *     scannerVersion, scannedAt
 *   }
 *
 *   rejected  at least one "high" finding  -> must not run
 *   flagged   at least one "medium" finding -> a human should review
 *   approved  nothing above "low"
 *
 * This is a rule-based filter. It cannot prove code is safe: it looks for
 * known-dangerous constructs and for common ways of hiding them. The runtime
 * (isolation.mjs) is the second layer and does not trust this verdict.
 *
 * The text in `message` and `snippet` comes from the scanned code. Escape it
 * before putting it into HTML.
 */

export const SCANNER_VERSION = 1;

export const RULES = Object.freeze({
  LIM001: ['high', 'Code too large'],
  LIM002: ['high', 'Binary data in source'],
  LIM003: ['high', 'Source is not text'],
  SYN001: ['high', 'Cannot tokenize source'],
  SYN002: ['high', 'Syntax error'],
  EXP001: ['high', 'Missing export default'],
  EXP002: ['high', 'Unsupported export'],
  EXP003: ['high', 'export default not at top level'],
  IMP001: ['high', 'Dynamic import'],
  IMP002: ['high', 'import.meta'],
  IMP003: ['high', 'Forbidden module'],
  IMP004: ['high', 'Module not allowed'],
  IMP005: ['high', 'Unreadable import'],
  API001: ['high', 'require()'],
  API002: ['high', 'process access'],
  API003: ['high', 'eval'],
  API004: ['high', 'Function constructor'],
  API005: ['medium', 'Global object access'],
  API006: ['high', 'constructor.constructor'],
  API007: ['medium', 'constructor access'],
  API008: ['medium', 'Engine internals'],
  API009: ['low', 'Not available in the sandbox'],
  OBF001: ['medium', 'Escaped identifier'],
  OBF002: ['medium', 'Computed access to a sensitive name'],
  OBF003: ['medium', 'String names a forbidden module'],
  RAW001: ['medium', 'Suspicious text outside parsed code'],
  LOOP001: ['low', 'Possible infinite loop']
});

// Names that are suspicious wherever they appear (even after a dot).
const ANY_POSITION = new Set(['__proto__', 'prepareStackTrace', 'captureStackTrace']);
// Names that are suspicious when used as a computed key: obj['process'].
const SENSITIVE_KEYS = new Set([
  'process', 'require', 'eval', 'Function', 'globalThis', 'global',
  'mainModule', 'binding', 'dlopen', '__proto__', 'prepareStackTrace', 'captureStackTrace'
]);
const SENSITIVE_MODULE_STRINGS = new Set(['child_process', 'worker_threads', 'cluster']);
// Words after which "[" starts an array literal, not a property access.
const NOT_VALUE_KEYWORDS = new Set([
  'return', 'typeof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case',
  'yield', 'await', 'instanceof', 'else', 'do'
]);

const RAW_PATTERNS = [
  { re: /child_process|worker_threads/, covers: ['IMP003', 'IMP004', 'OBF003'] },
  { re: /\bprocess\s*\.\s*(?:binding|mainModule|dlopen|exit|env|kill|abort)\b/, covers: ['API002'] },
  { re: /\brequire\s*\(/, covers: ['API001'] },
  { re: /\beval\s*\(/, covers: ['API003'] },
  { re: /\bimport\s*\(/, covers: ['IMP001'] },
  { re: /constructor\s*\.\s*constructor/, covers: ['API006'] },
  { re: /\bglobalThis\b/, covers: ['API005'] }
];

export function scan(code, options = {}) {
  const opts = { ...SCAN_DEFAULTS, ...options };
  const allow = new Set(opts.allowModules);
  const text = typeof code === 'string' ? code : '';

  const findings = [];
  const seen = new Set();
  const idsPresent = new Set();
  const counts = { high: 0, medium: 0, low: 0 };
  let lineStarts = [0];

  function snippetAtLine(line) {
    const from = lineStarts[line - 1];
    if (from === undefined) return undefined;
    const to = lineStarts[line] === undefined ? text.length : lineStarts[line];
    return text.slice(from, to).replace(/[\u0000-\u001f\u2028\u2029]/g, ' ').trim().slice(0, 120);
  }

  function add(id, message, where) {
    const [severity, title] = RULES[id];
    let line;
    let column;
    if (typeof where === 'number') {
      ({ line, column } = locate(lineStarts, where));
    } else if (where && typeof where.line === 'number') {
      line = where.line;
    }
    const key = id + '|' + (line === undefined ? '' : line) + '|' + message;
    if (seen.has(key)) return;
    seen.add(key);
    counts[severity]++;
    idsPresent.add(id);
    if (findings.length < opts.maxFindings) {
      const f = { id, severity, title, message };
      if (line !== undefined) {
        f.line = line;
        if (column !== undefined) f.column = column;
        const snip = snippetAtLine(line);
        if (snip) f.snippet = snip;
      }
      findings.push(f);
    }
  }

  let bytes = 0;
  let tokenCount = 0;

  if (typeof code !== 'string') {
    add('LIM003', 'the source must be a string');
  } else {
    bytes = Buffer.byteLength(code, 'utf8');
    lineStarts = computeLineStarts(code);
    if (bytes > opts.maxCodeBytes) {
      add('LIM001', `source is ${bytes} bytes, the limit is ${opts.maxCodeBytes}`);
    } else {
      try {
        scanCode(code);
      } catch (e) {
        // The scanner must never throw on hostile input: fail closed.
        add('SYN001', 'the scanner could not process this source: ' + String((e && e.message) || e).slice(0, 120));
      }
    }
  }

  function scanCode(src) {
    const nul = src.indexOf('\0');
    if (nul !== -1) add('LIM002', 'the source contains a NUL character', nul);

    const an = analyze(src);
    if (an.lineStarts) lineStarts = an.lineStarts;
    for (const err of an.errors) {
      add(err.id, err.message, typeof err.offset === 'number' ? err.offset : err);
    }
    if (!an.tokens) return;
    tokenCount = an.tokens.length;
    tokenRules(an.tokens);
    memberRules(an.tokens);
    stringRules(an.tokens);
    rawNet(src);
  }

  function tokenRules(toks) {
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== 'name') continue;
      const v = t.value;
      const prev = toks[i - 1];
      const next = toks[i + 1];
      const nv = next && next.type === 'punct' ? next.value : null;

      if (t.escaped) {
        add('OBF001', `identifier "${v}" is written with unicode escapes`, t.start);
      }
      if (ANY_POSITION.has(v)) {
        add('API008', `"${v}" is used to reach engine internals`, t.start);
      }
      if (t.prevDot) continue;
      if (nv === ':') continue; // object key such as { process: 1 }

      switch (v) {
        case 'import':
          if (nv === '(') add('IMP001', 'dynamic import() is not allowed', t.start);
          else if (nv === '.') add('IMP002', 'import.meta is not available', t.start);
          else staticImport(toks, i);
          break;
        case 'require':
          if (nv === '(') add('API001', 'require() is not allowed', t.start);
          else add('API009', 'require is not available in the sandbox', t.start);
          break;
        case 'process':
          if (nv === '.' || nv === '?.' || nv === '[') add('API002', 'access to the host process object', t.start);
          else add('API009', 'process is not available in the sandbox', t.start);
          break;
        case 'eval':
          add('API003', 'eval is not allowed', t.start);
          break;
        case 'Function':
          if (nv === '(' || (prev && prev.type === 'name' && prev.value === 'new')) {
            add('API004', 'the Function constructor compiles code from text', t.start);
          }
          break;
        case 'globalThis':
        case 'global':
          add('API005', `"${v}" gives access to the global object`, t.start);
          break;
        case 'Proxy':
        case 'Reflect':
          add('API008', `"${v}" is used to reach engine internals`, t.start);
          break;
        case 'while':
          if (nv === '(' && isName(toks[i + 2], 'true') && isPunct(toks[i + 3], ')')) {
            add('LOOP001', 'while (true) will be stopped by the time limit', t.start);
          }
          break;
        case 'for':
          if (nv === '(' && isPunct(toks[i + 2], ';') && isPunct(toks[i + 3], ';') && isPunct(toks[i + 4], ')')) {
            add('LOOP001', 'for (;;) will be stopped by the time limit', t.start);
          }
          break;
        default:
          if (UNSUPPORTED_GLOBALS.has(v)) {
            add('API009', `${v}: ${UNSUPPORTED_GLOBALS.get(v)}`, t.start);
          }
      }
    }
  }

  function staticImport(toks, i) {
    const t = toks[i];
    let spec = null;
    const limit = Math.min(toks.length, i + 200);
    for (let j = i + 1; j < limit; j++) {
      const tj = toks[j];
      if (tj.type === 'punct' && tj.value === ';') break;
      if (tj.type === 'string') {
        const before = toks[j - 1];
        if (j === i + 1 || isName(before, 'from')) { spec = tj.value; break; }
      }
    }
    if (spec === null) {
      add('IMP005', 'import statement whose module name could not be determined', t.start);
      return;
    }
    if (allow.has(spec)) return;
    const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
    const base = bare.split('/')[0];
    const looksLikePath = bare.startsWith('.') || bare.startsWith('/') || bare.includes(':');
    if (!looksLikePath && DENY_MODULES.has(base)) {
      add('IMP003', `imports "${spec}", which ${DENY_MODULES.get(base)}`, t.start);
    } else if (looksLikePath) {
      add('IMP004', `imports "${spec}": relative paths and URLs are not allowed`, t.start);
    } else {
      add('IMP004', `imports "${spec}", which is not on the allow-list`, t.start);
    }
  }

  function foldString(toks, j) {
    const isStr = (x) => x && (x.type === 'string' || (x.type === 'template' && x.head && !x.open));
    if (!isStr(toks[j])) return null;
    let value = toks[j].value;
    let end = j;
    while (isPunct(toks[end + 1], '+') && isStr(toks[end + 2])) {
      value += toks[end + 2].value;
      end += 2;
    }
    return { value, end };
  }

  function memberRules(toks) {
    const members = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== 'punct') continue;
      if (t.value === '.' || t.value === '?.') {
        const nx = toks[i + 1];
        if (nx && nx.type === 'name') members.push({ name: nx.value, from: i, to: i + 1, tok: nx, bracket: false });
      } else if (t.value === '[') {
        const p = toks[i - 1];
        const isAccess = p && (
          (p.type === 'name' && !NOT_VALUE_KEYWORDS.has(p.value)) ||
          p.type === 'string' || p.type === 'template' ||
          (p.type === 'punct' && (p.value === ')' || p.value === ']' || p.value === '}'))
        );
        if (!isAccess) continue;
        const f = foldString(toks, i + 1);
        if (f && isPunct(toks[f.end + 1], ']')) {
          members.push({ name: f.value, from: i, to: f.end + 1, tok: toks[i + 1], bracket: true });
        }
      }
    }
    const consumed = new Set();
    for (let k = 0; k < members.length; k++) {
      if (consumed.has(k)) continue;
      const m = members[k];
      const nxt = members[k + 1];
      if (m.name === 'constructor') {
        if (nxt && nxt.from === m.to + 1 && nxt.name === 'constructor') {
          add('API006', 'constructor.constructor reaches the Function constructor', m.tok.start);
          consumed.add(k + 1);
        } else {
          add('API007', 'access to .constructor', m.tok.start);
        }
      } else if (m.bracket && SENSITIVE_KEYS.has(m.name)) {
        add('OBF002', `computed property access to "${m.name}"`, m.tok.start);
      }
    }
  }

  function stringRules(toks) {
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'string') continue;
      if (isPunct(toks[i - 1], '+') && toks[i - 2] && toks[i - 2].type === 'string') continue; // not the start of a run
      const f = foldString(toks, i);
      if (!f) continue;
      const bare = f.value.startsWith('node:') ? f.value.slice(5) : f.value;
      if (SENSITIVE_MODULE_STRINGS.has(bare)) {
        add('OBF003', `the string "${f.value}" names a forbidden module`, toks[i].start);
      }
    }
  }

  function rawNet(src) {
    for (const p of RAW_PATTERNS) {
      const m = p.re.exec(src);
      if (!m) continue;
      if (p.covers.some((id) => idsPresent.has(id))) continue;
      add('RAW001', `the source text contains "${m[0].replace(/\s+/g, ' ')}" in a place the scanner treats as a comment or string`, m.index);
    }
  }

  const verdict = counts.high > 0 ? 'rejected' : counts.medium > 0 ? 'flagged' : 'approved';
  findings.sort((a, b) => (a.line || 0) - (b.line || 0));

  return {
    verdict,
    reasons: findings,
    summary: counts,
    stats: { bytes, lines: lineStarts.length, tokens: tokenCount },
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    scannerVersion: SCANNER_VERSION,
    scannedAt: new Date().toISOString()
  };
}

function isName(t, value) {
  return !!t && t.type === 'name' && t.value === value;
}
function isPunct(t, value) {
  return !!t && t.type === 'punct' && t.value === value;
}
