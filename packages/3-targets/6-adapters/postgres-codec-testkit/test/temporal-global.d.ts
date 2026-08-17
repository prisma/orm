// Ambient `Temporal` for this package's suites only. Kept under `test/` so it never reaches the
// built types: the package's own sources do not reference Temporal, and consumers supply their own.
/// <reference types="temporal-polyfill/types/global" />
