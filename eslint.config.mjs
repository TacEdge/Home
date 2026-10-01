import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Layer boundaries (docs/SYSTEM-ARCHITECTURE.md §4, M1 contract §7):
//   app → domain, kev, trust, ui, lib
//   kev → domain, trust, lib
//   domain → db, trust, lib
//   integrations → domain, lib
//   trust → db, lib
//   db → lib
//   ui → lib (types only)
//   lib → nothing internal
// Nothing imports app. Only kev/providers may import an LLM SDK.
const layers = ['app', 'ui', 'domain', 'kev', 'integrations', 'trust', 'db', 'lib'];
const allowed = {
  app: ['domain', 'kev', 'trust', 'ui', 'lib'],
  kev: ['domain', 'trust', 'lib'],
  domain: ['db', 'trust', 'lib'],
  integrations: ['domain', 'lib'],
  trust: ['db', 'lib'],
  db: ['lib'],
  ui: ['lib'],
  lib: [],
};

const forbidFor = (layer) =>
  layers
    .filter((other) => other !== layer && !allowed[layer].includes(other))
    .map((other) => ({
      group: [`@/${other}`, `@/${other}/*`, `**/src/${other}`, `**/src/${other}/*`],
      message: `Layer "${layer}" may not import from "${other}" (see SYSTEM-ARCHITECTURE.md §4).`,
    }));

// Only the LLM provider adapter (src/kev/providers/*) may import an LLM SDK.
const llmSdkPaths = [
  { name: '@anthropic-ai/sdk', message: 'Only src/kev/providers/* may import an LLM SDK.' },
];

const boundaryRules = layers.flatMap((layer) => [
  {
    files: [`src/${layer}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbidFor(layer), paths: llmSdkPaths }],
    },
  },
  ...(layer === 'kev'
    ? [
        {
          files: ['src/kev/providers/**/*.{ts,tsx}'],
          rules: { 'no-restricted-imports': ['error', { patterns: forbidFor(layer) }] },
        },
      ]
    : []),
]);

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.next-*/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'prototype/**', // reference only; never linted, built or deployed
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
  ]),
  {
    files: ['**/*.{ts,tsx,mts}'],
    rules: {
      // Configuration only through src/lib/env.ts (contract §5.3).
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration from @/lib/env, not process.env.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: [
      'src/lib/env.ts',
      'src/instrumentation.ts', // reads only Next's own NEXT_RUNTIME
      'next.config.ts',
      'drizzle.config.ts',
      'vitest.config.mts',
      'playwright.config.ts',
      'scripts/**',
      'tests/**',
      'playwright.config.ts',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },
  ...boundaryRules,
]);
