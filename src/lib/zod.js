import { z } from 'zod';

/**
 * Zod, configured once for the whole app. Import `z` from here, not from 'zod'.
 *
 * `jitless` stops Zod probing for `new Function` (eval) to build a faster
 * validator. That probe is harmless but trips the Content-Security-Policy
 * (no 'unsafe-eval') on every form page; our forms are far too small for the
 * JIT to matter.
 */
z.config({ jitless: true });

export { z };
