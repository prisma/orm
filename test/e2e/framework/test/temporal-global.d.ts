// Ambient `Temporal` for this suite. The runtime global arrives via the `setup-temporal.ts` vitest
// setup file; this declares the matching types so `tsc` sees the same global the tests run against.
/// <reference types="temporal-polyfill/types/global" />
