// ESLint flat config (ESLint 10). Syntax-only typescript-eslint — no type-aware
// rules, so a full run stays fast enough for every commit and for CI.
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const TIP_HINT =
  'Hover hints use the app tooltip: the `data-tip="…"` attribute (shown by TipLayer), or <Tip> from components/Tip.tsx for rich content.';

/**
 * Owner rule: a hover hint is never the browser's native tooltip and never the
 * "?" help cursor. `title` stays allowed on <svg> (its accessible name) and
 * <iframe>, and on components, whose `title` prop is usually a visible heading.
 */
const NO_NATIVE_TOOLTIP = [
  {
    selector:
      'JSXOpeningElement[name.name=/^[a-z]/]:not([name.name="svg"]):not([name.name="iframe"]) > JSXAttribute[name.name="title"]',
    message: `Native \`title\` tooltips are not used. ${TIP_HINT}`,
  },
];

const HELP_CURSOR_MESSAGE = `The "?" help cursor is not used. ${TIP_HINT}`;

const NO_HELP_CURSOR = [
  {
    selector: 'Property[key.name="cursor"][value.value="help"]',
    message: HELP_CURSOR_MESSAGE,
  },
  {
    selector: 'Property[key.value="cursor"][value.value="help"]',
    message: HELP_CURSOR_MESSAGE,
  },
  {
    selector: 'Literal[value=/cursor:\\s*help/]',
    message: HELP_CURSOR_MESSAGE,
  },
  {
    selector: 'TemplateElement[value.raw=/cursor:\\s*help/]',
    message: HELP_CURSOR_MESSAGE,
  },
];

export default defineConfig(
  {
    ignores: [
      'dist/',
      'release/',
      'node_modules/',
      'test-data/',
      'coverage/',
      'scripts/cit-xsd/',
      'scripts/pit-xsd/',
      // Agent and tool worktrees live under .claude/ — copies of this repo, not code of it.
      '.claude/',
    ],
  },

  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // ~240 of them today; a warning to burn down, not a wall.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Lazy `require()` of native/optional modules (pdf-parse, pkcs11js) is deliberate.
      '@typescript-eslint/no-require-imports': 'warn',
      // BOM and no-break spaces are matched on purpose in regexes and strings.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipRegExps: true, skipJSXText: true },
      ],

      // Style-level findings: reported, never blocking.
      'no-empty': 'warn',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-catch': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      'no-case-declarations': 'warn',
      'no-control-regex': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',

      'no-restricted-syntax': ['error', ...NO_HELP_CURSOR],
    },
  },

  // Node: the main process, shared code (also bundled into the renderer, but it
  // must not touch the DOM), converters, scripts and the root tool configs.
  {
    files: [
      'src/main/**',
      'src/shared/**',
      'src/converters/**',
      'scripts/**',
      '*.{ts,mts,js,mjs,cjs}',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // Browser: the React renderer.
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['src/renderer/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_NATIVE_TOOLTIP, ...NO_HELP_CURSOR],
    },
  },

  // Known findings, reviewed and left for their owners: kept as errors for new code.
  // convert(): an async Promise executor, but its body is one try/catch that rejects.
  {
    files: ['src/main/converterRegistry.ts'],
    rules: { 'no-async-promise-executor': 'warn' },
  },

  // Unit tests run under Vitest in Node.
  {
    files: ['**/*.test.ts'],
    languageOptions: { globals: { ...globals.node } },
  }
);
