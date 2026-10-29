import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// const blockedBuiltins = [
//   'fs', 'path', 'os', 'child_process', 'cluster',
//   'worker_threads', 'dgram', 'net', 'tls',
//   'http', 'https', 'process', 'perf_hooks',
//   'vm', 'repl', 'async_hooks', 'inspector',
//   'v8', 'buffer', 'timers', 'events'
// ];
const blockedBuiltins = [
  'os', 'child_process', 'cluster',
  'worker_threads', 'dgram', 'net', 'tls',
  'http', 'https', 'process', 'perf_hooks',
  'vm', 'repl', 'async_hooks', 'inspector',
  'v8', 'buffer', 'timers', 'events'
];

export async function resolve(specifier, context, nextResolve) {
  const { parentURL } = context;
  if (!parentURL) {
    return nextResolve(specifier, context);
  }
  const parentPath = fileURLToPath(parentURL);
  const isFromMods = parentPath.includes('/modules');
  if (isFromMods) {
    const normalized = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    const topLevel = normalized.split('/')[0];
    const isBuiltin = blockedBuiltins.includes(topLevel);
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
    if(isBuiltin || isRelative)
    throw new Error(`Import of "${specifier}" is blocked`);
  }
  return nextResolve(specifier, context);
}
