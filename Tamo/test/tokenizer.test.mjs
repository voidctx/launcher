import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, TokenizeError, locate } from '../src/tokenizer.mjs';

const kinds = (src) => tokenize(src).tokens.map((t) => `${t.type}:${t.value}`);
const names = (src) => tokenize(src).tokens.filter((t) => t.type === 'name').map((t) => t.value);

test('comments are skipped, code after them is kept', () => {
  assert.deepEqual(names('a // process\nb /* eval */ c'), ['a', 'b', 'c']);
});

test('U+2028 and U+2029 end a line comment', () => {
  assert.deepEqual(names('a // x\u2028process.exit()'), ['a', 'process', 'exit']);
  assert.deepEqual(names('a // x\u2029process'), ['a', 'process']);
});

test('names inside strings are not names', () => {
  assert.deepEqual(names(`const a = 'process'; const b = "eval(";`), ['const', 'a', 'const', 'b']);
});

test('string escapes are decoded', () => {
  const t = tokenize(`'\\x70roc\\u0065ss'`).tokens[0];
  assert.equal(t.type, 'string');
  assert.equal(t.value, 'process');
  const u = tokenize(`'\\u{70}rocess'`).tokens[0];
  assert.equal(u.value, 'process');
});

test('unterminated string / comment / template throw TokenizeError', () => {
  assert.throws(() => tokenize(`'abc`), TokenizeError);
  assert.throws(() => tokenize(`/* abc`), TokenizeError);
  assert.throws(() => tokenize('`abc'), TokenizeError);
  assert.throws(() => tokenize(`'a\nb'`), TokenizeError);
});

test('code inside template substitutions is tokenized (nested)', () => {
  assert.deepEqual(names('`a ${ process.env } b ${ `x ${ eval } y` } c`'), ['process', 'env', 'eval']);
});

test('braces inside a substitution do not end it early', () => {
  assert.deepEqual(names('`${ {a: 1}.a } ${ b }`'), ['a', 'a', 'b']);
});

test('identifiers with unicode escapes are decoded and marked', () => {
  const t = tokenize('\\u0070rocess').tokens[0];
  assert.equal(t.value, 'process');
  assert.equal(t.escaped, true);
  const u = tokenize('pro\\u{63}ess').tokens[0];
  assert.equal(u.value, 'process');
});

test('regex literal vs division', () => {
  assert.deepEqual(kinds('x = /a\\/b[/]c/g.test(y)').slice(0, 3), ['name:x', 'punct:=', 'regex:/a\\/b[/]c/g']);
  assert.deepEqual(kinds('a / b / c'), ['name:a', 'punct:/', 'name:b', 'punct:/', 'name:c']);
  assert.deepEqual(kinds('(a) / 2'), ['punct:(', 'name:a', 'punct:)', 'punct:/', 'number:2']);
});

test('a regex after a block-closing brace is a regex, not a division', () => {
  // `'` inside the regex must not start a string
  const t = tokenize(`function f(){} /'/; process.exit(); /'/.test('')`).tokens;
  assert.ok(t.some((x) => x.type === 'regex'));
  assert.ok(t.some((x) => x.type === 'name' && x.value === 'process'));
});

test('a division after an object literal is a division', () => {
  assert.deepEqual(kinds('x = {a:1}.a / 2 / 1').filter((s) => s.startsWith('regex')), []);
});

test('regex after if (...) header', () => {
  const t = tokenize(`if (x) /'/.test(y); process`).tokens;
  assert.ok(t.some((x) => x.type === 'regex'));
  assert.ok(t.some((x) => x.type === 'name' && x.value === 'process'));
});

test('postfix ++ is followed by division, not a regex', () => {
  const t = tokenize('a++ / process.exit() / 1').tokens;
  assert.ok(t.some((x) => x.type === 'name' && x.value === 'process'));
});

test('numbers do not swallow member access', () => {
  assert.deepEqual(names('0.5.constructor.constructor'), ['constructor', 'constructor']);
  assert.deepEqual(names('1..toString()'), ['toString']);
});

test('prevDot marks property names', () => {
  const t = tokenize('a.process; process').tokens.filter((x) => x.value === 'process');
  assert.equal(t[0].prevDot, true);
  assert.equal(t[1].prevDot, false);
});

test('depth tracks brackets (0 = top level)', () => {
  const t = tokenize('a; { b } c').tokens;
  const depth = Object.fromEntries(t.filter((x) => x.type === 'name').map((x) => [x.value, x.depth]));
  assert.deepEqual(depth, { a: 0, b: 1, c: 0 });
});

test('locate gives 1-based line and column', () => {
  const { lineStarts } = tokenize('a\nbb\r\nccc');
  assert.deepEqual(locate(lineStarts, 0), { line: 1, column: 1 });
  assert.deepEqual(locate(lineStarts, 3), { line: 2, column: 2 });
  assert.deepEqual(locate(lineStarts, 6), { line: 3, column: 1 });
});

test('never hangs on random garbage', () => {
  const chars = ['/', '*', '`', '$', '{', '}', "'", '"', '\\', '(', ')', '[', ']', 'a', ' ', '\n', '1', '.', '#', '\u2028'];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 2000; i++) {
    let s = '';
    const len = 1 + Math.floor(rnd() * 60);
    for (let j = 0; j < len; j++) s += chars[Math.floor(rnd() * chars.length)];
    try { tokenize(s); } catch (e) { assert.ok(e instanceof TokenizeError, `unexpected ${e}`); }
  }
});
