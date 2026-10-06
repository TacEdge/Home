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

// One narrow exception (ADR 0007 §42): app may import the calendar
// composition root, src/integrations/calendar/entry.ts, and nothing else in
// integrations. It assembles the domain's calendar refresh with the real
// provider, so domain never imports integrations and app never sees a
// provider. tests/unit/layer-exceptions.test.ts holds the rule to this.
const EXCEPTIONS = { app: { integrations: 'calendar/entry' } };

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const forbidFor = (layer) =>
  layers
    .filter((other) => other !== layer && !allowed[layer].includes(other))
    .map((other) => {
      const message = `Layer "${layer}" may not import from "${other}" (see SYSTEM-ARCHITECTURE.md §4).`;
      const only = EXCEPTIONS[layer]?.[other];
      if (!only)
        return {
          group: [`@/${other}`, `@/${other}/*`, `**/src/${other}`, `**/src/${other}/*`],
          message,
        };
      // Everything in the layer except exactly the one allowed module.
      return {
        regex: `^(@/|.*/src/)${other}(?!/${escape(only)}$)(/.*)?$`,
        message: `${message} The one exception is @/${other}/${only}.`,
      };
    });

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
