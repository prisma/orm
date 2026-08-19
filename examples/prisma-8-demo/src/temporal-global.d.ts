// Ambient `Temporal` for the demo. The implementation is installed at runtime where it is needed —
// `test/setup-temporal.ts` for the suites, an import at the top of `scripts/seed.ts` for the seed —
// because `temporal-polyfill/full/global`'s own published types resolve to `export {}` and declare
// nothing.
/// <reference types="temporal-polyfill/types/global" />
