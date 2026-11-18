// Deliberately not `@repo/tsdown`: the shell build lives in that
// package and reads this package's table, so depending on it here would make
// the two packages depend on each other and turbo would refuse to order the
// build. The settings below are the shared base minus the parts this package
// does not use (it has no `src/exports/` directory to rewrite subpaths for).
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/shells.ts', 'src/platform-entrypoints.ts'],
  dts: { enabled: true, sourcemap: true },
  exports: { enabled: 'local-only' },
  skipNodeModulesBundle: true,
  sourcemap: true,
  tsconfig: 'tsconfig.prod.json',
});
