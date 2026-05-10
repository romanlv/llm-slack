/** @type {import('lint-staged').Configuration} */
export default {
  // Auto-fix lint issues on staged JS/TS files.
  '*.{js,jsx,ts,tsx}': ['eslint --max-warnings=0 --fix'],

  // Project-wide checks that should not receive staged filenames as args.
  // Returned as functions so lint-staged runs them verbatim.
  '*.{ts,tsx}': (files) => [
    'tsc -b',
    `vitest related --run ${files.map((f) => JSON.stringify(f)).join(' ')}`,
  ],
};
