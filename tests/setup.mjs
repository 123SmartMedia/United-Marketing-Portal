/**
 * Test bootstrap for `node --test`.
 *
 * Two resolver shims let the production source files be unit tested unchanged:
 *
 *  1. `server-only` — a marker package that throws outside a React Server
 *     Component graph. Resolved to an empty module here. The real guard still
 *     applies in production: a client component importing those modules fails
 *     the Next.js build.
 *  2. `@/...` — the jsconfig path alias Next resolves for us, mapped to ./src.
 *  3. `next/server` — Next's own bundler resolves the extensionless specifier;
 *     plain Node needs the file.
 */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const srcRoot = pathToFileURL(path.resolve(process.cwd(), 'src') + path.sep).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export{}', format: 'module', shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      // Next resolves extensionless aliases; plain Node does not.
      const target = specifier.slice(2);
      const withExtension = /\.[a-z]+$/i.test(target) ? target : `${target}.js`;
      return nextResolve(new URL(withExtension, srcRoot).href, context);
    }
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }
    return nextResolve(specifier, context);
  },
});
