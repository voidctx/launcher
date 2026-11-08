import vm from 'node:vm';
import { tokenize, TokenizeError, locate } from './tokenizer.mjs';

/**
 * Service module format (the only one supported):
 *
 *     export default {
 *       async server(req) { return { status, headers, body }; }
 *     };
 *
 * Top-level statements before it (let count = 0; helper functions ...) are
 * allowed and keep their state between requests while the service is loaded.
 *
 * There is no module system inside the sandbox, so the code is turned into the
 * body of a function:   export default X   ->   __exports.default = X
 * Line numbers stay the same as in the original source.
 */

export const FUNCTION_PARAMS = ['__exports'];
export const SOURCE_FILENAME = 'service.js';

function problem(id, message, tok, lineStarts) {
  const p = { id, message };
  if (tok && lineStarts) {
    const { line, column } = locate(lineStarts, tok.start);
    p.line = line;
    p.column = column;
    p.offset = tok.start;
  }
  return p;
}

/** Finds the single top-level `export default`. */
export function locateExportDefault(tokens, lineStarts) {
  const problems = [];
  let index = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'name' || t.value !== 'export' || t.prevDot) continue;
    const next = tokens[i + 1];
    if (next && next.type === 'punct' && next.value === ':') continue; // object key
    if (next && next.type === 'name' && next.value === 'default') {
      if (t.depth !== 0) {
        problems.push(problem('EXP003', '`export default` must be a top-level statement', t, lineStarts));
      } else if (index !== -1) {
        problems.push(problem('EXP002', 'only one `export default` is allowed', t, lineStarts));
      } else {
        index = i;
      }
    } else {
      problems.push(problem('EXP002', 'only `export default` is supported (named exports are not)', t, lineStarts));
    }
  }
  if (index === -1 && problems.length === 0) {
    problems.push({ id: 'EXP001', message: 'the module must contain `export default { async server(req) { ... } }`' });
  }
  return { index, problems };
}

export function buildBody(src, tokens, exportIndex) {
  const exp = tokens[exportIndex];
  const def = tokens[exportIndex + 1];
  return "'use strict';" + src.slice(0, exp.start) + '__exports.default =' + src.slice(def.end) + '\n';
}

function syntaxLine(err) {
  const m = /^service\.js:(\d+)/m.exec(String(err && err.stack));
  return m ? Number(m[1]) : undefined;
}

/**
 * Tokenizes the source, checks the export, builds the function body and
 * compiles it (compile only, nothing is executed).
 *
 * Returns { ok, body, tokens, lineStarts, errors }.
 * `tokens` / `lineStarts` are present whenever tokenizing succeeded.
 */
export function analyze(code) {
  const out = { ok: false, body: null, tokens: null, lineStarts: null, errors: [] };

  let tk;
  try {
    tk = tokenize(code);
  } catch (e) {
    if (e instanceof TokenizeError) {
      out.errors.push({ id: 'SYN001', message: e.message, offset: e.offset });
      return out;
    }
    throw e;
  }
  out.tokens = tk.tokens;
  out.lineStarts = tk.lineStarts;

  const ex = locateExportDefault(tk.tokens, tk.lineStarts);
  if (ex.problems.length > 0) {
    out.errors.push(...ex.problems);
    return out;
  }

  const body = buildBody(code, tk.tokens, ex.index);
  try {
    vm.compileFunction(body, FUNCTION_PARAMS, { filename: SOURCE_FILENAME });
  } catch (e) {
    const err = { id: 'SYN002', message: String((e && e.message) || e).slice(0, 300) };
    const line = syntaxLine(e);
    if (line) err.line = line;
    out.errors.push(err);
    return out;
  }

  out.ok = true;
  out.body = body;
  return out;
}
