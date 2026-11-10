import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../src/scanner.mjs';

const wrap = (body) => `export default { async server(req) { ${body} } };`;
const ids = (r) => r.reasons.map((x) => x.id);
const has = (r, id) => ids(r).includes(id);

// ---------------------------------------------------------------- approved

const APPROVED = {
  hello: `export default { async server(req) { return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'Hello from /abce!' }; } };`,
  counter: `let count = 0;
export default {
  async server(req) {
    count++;
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count }) };
  }
};`,
  html: 'export default { async server(req) { return { status: 200, headers: { "Content-Type": "text/html" }, body: `<h1>${req.path}</h1>` }; } };',
  jsonEcho: `export default {
  async server(req) {
    const data = req.body ? JSON.parse(req.body) : {};
    return { status: 200, body: JSON.stringify({ method: req.method, data, ratio: 10 / 2 / 1, re: /a+b/.test('aab') }) };
  }
};`,
  classes: `class Counter { constructor() { this.n = 0; } inc() { return ++this.n; } }
const c = new Counter();
export default { async server() { return { body: String(c.inc()) }; } };`,
  commentsMentioningNothingDangerous: `// serves a greeting\n/* block */\nexport default { async server() { return { body: 'ok' }; } };`,
  wordProcessInText: `export default { async server() { return { body: 'we process the request' }; } };`,
  ownFunctionCalledProcess: `function process(x) { return x * 2; }\nexport default { async server() { return { body: String(process(4)) }; } };`
};

for (const [name, code] of Object.entries(APPROVED)) {
  test(`approved: ${name}`, () => {
    const r = scan(code);
    assert.equal(r.verdict, 'approved', JSON.stringify(r.reasons));
  });
}

// ---------------------------------------------------------------- rejected

const REJECTED = [
  ['process access', wrap('process.exit(1);'), 'API002'],
  ['process env', wrap('return { body: process.env.SECRET };'), 'API002'],
  ['require call', wrap(`const fs = require('fs');`), 'API001'],
  ['eval', wrap(`return { body: String(eval('1+1')) };`), 'API003'],
  ['new Function', wrap(`return new Function('return 1')();`), 'API004'],
  ['Function call', wrap(`return Function('return 1')();`), 'API004'],
  ['dynamic import', wrap(`const m = await import('node:fs');`), 'IMP001'],
  ['dynamic import (non-literal)', wrap(`const m = await import(req.path);`), 'IMP001'],
  ['import.meta', wrap(`return { body: import.meta.url };`), 'IMP002'],
  ['constructor.constructor', wrap(`return (() => {}).constructor.constructor('return process')();`), 'API006'],
  ['constructor bracket chain', wrap(`return this['constructor']['constructor']('x')();`), 'API006'],
  ['constructor chain with concat', wrap(`return this['constr' + 'uctor']['constructor']('x')();`), 'API006'],
  ['static import of fs', `import fs from 'node:fs';\n${wrap('')}`, 'IMP003'],
  ['static import of child_process', `import { exec } from "child_process";\n${wrap('')}`, 'IMP003'],
  ['static import fs/promises', `import * as f from 'fs/promises';\n${wrap('')}`, 'IMP003'],
  ['side-effect import', `import 'node:net';\n${wrap('')}`, 'IMP003'],
  ['import of unknown package', `import x from 'left-pad';\n${wrap('')}`, 'IMP004'],
  ['import of relative path', `import x from './other.mjs';\n${wrap('')}`, 'IMP004'],
  ['import of url', `import x from 'https://evil.example/x.js';\n${wrap('')}`, 'IMP004'],
  ['named export', `export const a = 1;\n${wrap('')}`, 'EXP002'],
  ['two default exports', `${wrap('')}\nexport default {};`, 'EXP002'],
  ['no export', `const a = 1;`, 'EXP001'],
  ['export default inside a block', `{ export default {}; }`, 'EXP003'],
  ['syntax error', `export default { async server( { } };`, 'SYN002'],
  ['unterminated string', `export default { server() { return 'abc } };`, 'SYN001'],
  ['top-level await', `await 1;\n${wrap('')}`, 'SYN002'],
  ['with statement (strict mode)', `with ({}) {}\n${wrap('')}`, 'SYN002'],
  ['process inside template substitution', 'export default { async server() { return { body: `${process.env.X}` }; } };', 'API002'],
  ['process hidden after unicode line separator', `export default { async server() { // c\u2028 process.exit();\n return {}; } };`, 'API002'],
  ['process after regex-after-brace', `function f() {} /'/; process.exit(); /'/.test('');\n${wrap('')}`, 'API002'],
  ['process after if-header regex', `if (1) /'/.test('x'); process.exit();\n${wrap('')}`, 'API002'],
  ['process after postfix ++', `let a = 1; a++ / process.exit() / 1;\n${wrap('')}`, 'API002'],
  ['process with unicode escape', wrap('\\u0070rocess.exit();'), 'API002']
];

for (const [name, code, id] of REJECTED) {
  test(`rejected: ${name}`, () => {
    const r = scan(code);
    assert.equal(r.verdict, 'rejected', JSON.stringify(r.reasons));
    assert.ok(has(r, id), `expected ${id}, got ${ids(r)}`);
  });
}

// ---------------------------------------------------------------- flagged

const FLAGGED = [
  ['globalThis', wrap('return { body: typeof globalThis };'), 'API005'],
  ['single .constructor', wrap('return { body: req.constructor.name };'), 'API007'],
  ['__proto__', wrap('const o = {}; o.__proto__ = {}; return {};'), 'API008'],
  ['Proxy', wrap('return { body: String(typeof new Proxy({}, {})) };'), 'API008'],
  ['Reflect', wrap('return { body: String(Reflect.ownKeys({})) };'), 'API008'],
  ['prepareStackTrace', wrap('Error.prepareStackTrace = () => 1; return {};'), 'API008'],
  ['escaped identifier', wrap('const \\u0061 = 1; return {};'), 'OBF001'],
  ['computed access to "process"', wrap(`return { body: String(this['pro' + 'cess']) };`), 'OBF002'],
  ['string naming child_process', wrap(`const m = 'child_' + 'process'; return {};`), null],
  ['string "child_process"', wrap(`const m = 'node:child_process'; return {};`), 'OBF003'],
  ['child_process only in a comment', `// uses child_process\n${wrap('return {};')}`, 'RAW001'],
  ['eval( only in a comment', `// never call eval(x)\n${wrap('return {};')}`, 'RAW001']
];

for (const [name, code, id] of FLAGGED) {
  test(`flagged: ${name}`, () => {
    const r = scan(code);
    if (id === null) {
      // concatenated pieces that are not a sensitive name on their own: must not crash
      assert.ok(['approved', 'flagged'].includes(r.verdict));
      return;
    }
    assert.equal(r.verdict, 'flagged', JSON.stringify(r.reasons));
    assert.ok(has(r, id), `expected ${id}, got ${ids(r)}`);
  });
}

// ---------------------------------------------------------------- notes (low)

test('unsupported globals are notes and do not change an approved verdict', () => {
  const r = scan(wrap(`return { body: String(typeof setTimeout + typeof fetch + typeof Buffer) };`));
  assert.equal(r.verdict, 'approved');
  assert.ok(has(r, 'API009'));
  assert.equal(r.summary.high, 0);
  assert.equal(r.summary.medium, 0);
});

test('infinite loops are notes (the runtime stops them)', () => {
  const r = scan(wrap('while (true) {} return {};'));
  assert.equal(r.verdict, 'approved');
  assert.ok(has(r, 'LOOP001'));
  assert.ok(has(scan(wrap('for (;;) {} return {};')), 'LOOP001'));
});

// ---------------------------------------------------------------- limits and robustness

test('size limit', () => {
  const big = `export default { async server() { return { body: '${'a'.repeat(300 * 1024)}' }; } };`;
  const r = scan(big);
  assert.equal(r.verdict, 'rejected');
  assert.ok(has(r, 'LIM001'));
  assert.equal(scan(big, { maxCodeBytes: 1024 * 1024 }).verdict, 'approved');
});

test('NUL character', () => {
  const r = scan(wrap(`return { body: 'a\0b' };`));
  assert.ok(has(r, 'LIM002'));
  assert.equal(r.verdict, 'rejected');
});

test('non-string input is rejected, not thrown', () => {
  for (const v of [undefined, null, 42, {}, []]) {
    const r = scan(v);
    assert.equal(r.verdict, 'rejected');
    assert.ok(has(r, 'LIM003'));
  }
});

test('allowModules lets a specific specifier through the import rule', () => {
  const code = `import x from 'left-pad';\nexport default { async server() { return {}; } };`;
  const r = scan(code, { allowModules: ['left-pad'] });
  assert.ok(!has(r, 'IMP004'));
});

test('report shape', () => {
  const code = wrap('process.exit();');
  const r = scan(code);
  assert.equal(typeof r.sha256, 'string');
  assert.equal(r.sha256.length, 64);
  assert.equal(r.scannerVersion, 1);
  assert.ok(!Number.isNaN(Date.parse(r.scannedAt)));
  assert.deepEqual(Object.keys(r.stats).sort(), ['bytes', 'lines', 'tokens']);
  const f = r.reasons.find((x) => x.id === 'API002');
  assert.equal(f.severity, 'high');
  assert.equal(f.line, 1);
  assert.ok(f.snippet.includes('process.exit'));
  // hash is bound to the exact code
  assert.notEqual(scan(code + ' ').sha256, r.sha256);
  assert.equal(scan(code).sha256, r.sha256);
});

test('line numbers point at the right line', () => {
  const r = scan(`let a = 1;\nlet b = 2;\nexport default { async server() {\n  process.exit();\n  return {};\n} };`);
  assert.equal(r.reasons.find((x) => x.id === 'API002').line, 4);
});

test('findings are capped but the verdict still counts everything', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `process.exit(${i});`).join('\n');
  const r = scan(wrap(lines), { maxFindings: 10 });
  assert.equal(r.reasons.length, 10);
  assert.equal(r.verdict, 'rejected');
  assert.equal(r.summary.high, 300);
});

test('hostile inputs never throw', () => {
  const chars = ['/', '*', '`', '$', '{', '}', "'", '"', '\\', '(', ')', '[', ']', 'a', ' ', '\n', '1', '.', 'import', 'export default', 'process', '\u2028', '\0'];
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 1500; i++) {
    let s = '';
    const len = 1 + Math.floor(rnd() * 40);
    for (let j = 0; j < len; j++) s += chars[Math.floor(rnd() * chars.length)];
    const r = scan(s);
    assert.ok(['approved', 'flagged', 'rejected'].includes(r.verdict));
  }
});

test('large input scans quickly', () => {
  const body = Array.from({ length: 5000 }, (_, i) => `const v${i} = ${i} / 2 + 'text ${i}';`).join('\n');
  const t0 = performance.now();
  const r = scan(`${body}\nexport default { async server() { return {}; } };`);
  const ms = performance.now() - t0;
  assert.equal(r.verdict, 'approved');
  assert.ok(ms < 1000, `took ${ms}ms`);
});
