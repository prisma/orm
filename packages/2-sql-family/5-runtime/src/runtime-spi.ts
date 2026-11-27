import type { ExecutionPlan } from '@internal/framework-components/runtime';
import type { MarkerReadResult, SqlQueryable } from '@internal/sql-relational-core/ast';

/**
 * Reader of the SQL contract marker. SQL runtimes call `readMarker` on the driver before their first use of the database (unless `verifyMarker` is false). The adapter owns the full marker-read flow — probing for storage, issuing the read, decoding the row — and returns a tagged result so callers can distinguish "marker storage missing", "no row for this space", and "present".
 */
export interface MarkerReader {
  readMarker(queryable: SqlQueryable): Promise<MarkerReadResult>;
}

/**
 * SQL family adapter SPI consumed by `SqlRuntimeBase`. Encapsulates the
 * runtime contract, marker reader, and plan validation logic so the
 * runtime can be unit-tested without a concrete SQL adapter profile.
 *
 * Implemented by `SqlFamilyAdapter` for production and by mock classes
 * in tests.
 */
export interface RuntimeFamilyAdapter<TContract = unknown> {
  readonly contract: TContract;
  readonly markerReader: MarkerReader;
  validatePlan(plan: ExecutionPlan, contract: TContract): void;
}

/**
 * Controls whether the runtime reads and checks the contract marker row on first use.
 *
 * - `'onFirstUse'` (default when omitted): the marker is read through the driver once per runtime lifetime, before the runtime's first use of the database: its first statement, or a connection taken to hold by `connection()`, a transaction or a subclass's raw connection, whichever comes first. Any hash mismatch or absent marker, and a marker that cannot be read or decoded, emits a structured `warn`-level log through the runtime's {@link RuntimeLog} and the work proceeds; a `warn` that throws is ignored. A read that cannot reach the database (a `SqlConnectionError`, `DRIVER.NOT_CONNECTED` or `DRIVER.CONNECTION_FAILED`) is the one exception: every call waiting on it rejects with that driver error, nothing is logged, and the next call reads again. Otherwise the check runs once whatever its outcome; later calls skip the marker reader entirely.
 * - `false`: the marker reader is never invoked. No log line is emitted. Use this to opt out of
 *   the diagnostic entirely (e.g. during a known deploy-skew window).
 *
 * A client that checks its stack against the contract when it is created (`CONTRACT.CAPABILITIES_NOT_PROVIDED`) reports that through the same setting: `false` turns that warning off too.
 *
 * The string-or-false shape is forward-compatible: future modes such as `'startup'` (eager check
 * inside the wrapper `connect()` step) can be added as additive union members without an API break.
 * `true` is intentionally not permitted — modes are always named.
 *
 * Default-on so contract drift surfaces by default — teams who never thought to enable the diagnostic
 * still see the warning when something goes wrong.
 */
export type VerifyMarkerOption = 'onFirstUse' | false;

export type TelemetryOutcome = 'success' | 'runtime-error';

export interface RuntimeTelemetryEvent {
  readonly lane: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly outcome: TelemetryOutcome;
  readonly durationMs?: number;
}
