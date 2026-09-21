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
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

const srcRoot = pathToFileURL(path.resolve(process.cwd(), 'src') + path.sep).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export{}', format: 'module', shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      // Next resolves extensionless aliases; plain Node does not. Components are
      // .jsx and libraries are .js, so try both rather than assuming one.
      const target = specifier.slice(2);
      if (/\.[a-z]+$/i.test(target)) {
        return nextResolve(new URL(target, srcRoot).href, context);
      }
      for (const extension of ['.js', '.jsx']) {
        const candidate = new URL(`${target}${extension}`, srcRoot);
        if (existsSync(fileURLToPath(candidate))) {
          return nextResolve(candidate.href, context);
        }
      }
      return nextResolve(new URL(`${target}.js`, srcRoot).href, context);
    }
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }
    return nextResolve(specifier, context);
  },

  /**
   * 4. `.jsx` — Node has no JSX parser, and Next's bundler is not in play here.
   *    esbuild transforms the component source on the fly so the real component
   *    (not a copy of it) is what the tests render.
   */
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.jsx')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { code } = transformSync(source, {
      loader: 'jsx',
      format: 'esm',
      target: 'node22',
      jsx: 'automatic',
      sourcefile: url,
    });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
