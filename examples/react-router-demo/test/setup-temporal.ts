// This example authors its temporal columns with the Temporal representation, so the runtime needs a
// global `Temporal`. Node does not ship one yet, so the suite installs the polyfill the way an
// application would — see docs/reference/postgres-temporal-types.md.
//
// `full/global` rather than `global`: the default build omits non-ISO calendars, and its published
// types resolve to `export {}` so TypeScript never sees the namespace.
import 'temporal-polyfill/full/global';
