// Ambient `Temporal` for the worker. `worker.ts` installs the implementation at runtime with
// `import 'temporal-polyfill/full/global'`; that entry point's own published types resolve to
// `export {}` and declare nothing, so the types come from here.
/// <reference types="temporal-polyfill/types/global" />
