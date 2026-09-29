import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

// Flat config for ESLint 9. `next lint` was removed in Next.js 16, so the
// `lint` script runs ESLint directly with Next's recommended rules.
export default defineConfig([
  ...nextVitals,
  {
    // React Compiler advisories. They flag deliberate patterns here — reading
    // browser storage into state on mount, and TurnstileWidget's latest-callback
    // ref — so they report as warnings rather than failing lint.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'node_modules/**',
    'site/**',
    'UnitedMarketingDesk-Assets/**',
    'public/assets/**',
    'next-env.d.ts',
  ]),
]);
