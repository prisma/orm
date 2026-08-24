import { timeouts } from '@repo/test-utils';
import { configDefaults, defineConfig } from 'vitest/config';

// init-journey's 4-cell pack+install matrix runs nightly only
// (.github/workflows/integration-nightly.yml); RUN_INIT_JOURNEY=1 opts it in.
export const initJourneyExclude = process.env['RUN_INIT_JOURNEY']
  ? []
  : ['test/cli-journeys/init-journey.e2e.test.ts'];

export default defineConfig({
  test: {
    // PGlite (WASM) intermittently aborts the worker fork on Linux CI with the
    // V8 CHECK `jit_page_->allocations_.erase(addr) == 1`. That CHECK lives in
    // V8's ThreadIsolation JIT-page bookkeeping (deps/v8/src/common/
    // code-memory-access.cc) and its only production caller is
    // ThreadIsolation::UnregisterWasmAllocation, reached exclusively through
    // WasmEngine::FreeDeadCode -> WasmCodeAllocator::FreeCode — i.e. it fires
    // while V8 frees *dead wasm code* (Liftoff code displaced by tier-up, code
    // reaped by the wasm code GC, and the process-global refcounted
    // wasm-to-JS import wrappers every PGlite instantiate/close churns). The
    // failure means a WasmCode was freed whose address was no longer tracked:
    // a refcount/double-free race inside V8, not anything the harness does
    // (the teardown chain withDevDatabase -> @prisma/dev close -> PGlite.close
    // -> awaited worker.terminate is awaited end to end).
    //
    // --no-memory-protection-keys never addressed it. V8 allocates the JIT
    // page tracking unconditionally ("we need to allocate the memory for jit
    // page tracking even if we don't enable the ThreadIsolation protections");
    // the flag only disables the PKU write-protection layered on top, so the
    // bookkeeping holding the CHECK still runs. #814 restored that flag to
    // stop a ~30% e2e flake and it appeared to work, but the mechanism it
    // claimed does not exist — the improvement was probabilistic.
    //
    // So keep the dead-code-freeing path from running at all:
    //   --no-wasm-code-gc   no GC cycles, so FreeDeadCode is unreachable;
    //                       dying code parks until process exit, where whole
    //                       code spaces are released via UnregisterJitPage,
    //                       a path without the per-allocation erase CHECK
    //   --no-wasm-tier-up   stops background tier-up producing dead Liftoff
    //                       code, removing the cross-thread refcount churn
    // Memory cost is bounded: forks are recycled per test file.
    //
    // Adjacent but NOT the same crash: nodejs/node#64500 (open) reports
    // concurrent-PGlite wasm failures on Node 20-27 where --no-wasm-tier-up
    // fixed 100/100 waves on Node 25 — but its signature is a SIGSEGV in
    // TrapWebAssemblyOrContinue, it never mentions --no-wasm-code-gc, and Node
    // 27 canary still reproduced with the flag. These flags therefore rest on
    // the mechanism above, not on a matching upstream repro; if the abort
    // survives them, that is the assumption that failed.
    execArgv: ['--no-wasm-code-gc', '--no-wasm-tier-up', '--no-memory-protection-keys'],
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup-temporal.ts'],
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...initJourneyExclude],
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
    },
    // These tests talk to a database, so they get the same budget as the hooks
    // below. `timeouts.default` is 100ms, which CI's TEST_TIMEOUT_MULTIPLIER
    // turns into the 200ms that `timeouts.vitestPackageDefault` is documented
    // as existing to avoid — and a test killed mid-insert leaves its rows
    // behind, so the next test fails on a UNIQUE violation and the real cause
    // is two failures away.
    testTimeout: timeouts.databaseOperation,
    // Hooks perform filesystem operations (creating/cleaning test directories)
    hookTimeout: timeouts.databaseOperation,
    // Covers ordinary CI flakiness ("Connection terminated unexpectedly").
    // Note it cannot cover the JIT abort above: that kills the worker fork
    // rather than failing a test, so there is nothing for vitest to retry.
    retry: process.env['CI'] ? 2 : 0,
  },
});
