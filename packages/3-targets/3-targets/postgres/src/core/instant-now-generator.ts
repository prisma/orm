import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';
import { errorTemporalUnavailableForDefault } from './errors';

/**
 * Canonical id for the wall-clock-now mutation default generator that produces a
 * `Temporal.Instant`.
 *
 * The sibling of `family-sql`'s `timestampNow`, which produces a `Date` and stays exactly as it
 * is — SQLite and this target's own `*String` presets both bind a `Date` or its text through an
 * identity codec quite happily. A Temporal-backed column cannot: its codec encodes a
 * `Temporal.Instant` and nothing else, so `temporal.updatedAt()` needs a clock that speaks the
 * column's own application value. Two generators rather than one generator that switches, because
 * a generator receives no column or codec context — the id it is reached by is the only place the
 * representation can be decided.
 */
export const INSTANT_NOW_GENERATOR_ID = 'instantNow' as const;

/**
 * Builds the control-plane descriptor. `buildPhases` mirrors `timestampNow`'s: both phases, so
 * `temporal.updatedAt()` writes on create and on update.
 *
 * `applicableCodecIds` is omitted for the same reason it is omitted there — the generator is
 * preset-only and is never reachable through `@default(instantNow())` lowering, so the
 * `@default(...)` compatibility check has no role to play.
 */
export function instantNowControlDescriptor(): MutationDefaultGeneratorDescriptor {
  return {
    id: INSTANT_NOW_GENERATOR_ID,
    buildPhases: () => ({
      onCreate: { kind: 'generator', id: INSTANT_NOW_GENERATOR_ID },
      onUpdate: { kind: 'generator', id: INSTANT_NOW_GENERATOR_ID },
    }),
  };
}

/**
 * Reads the clock as a `Temporal.Instant`.
 *
 * The capability check is the same lazy one the Temporal codecs perform, and for the same reason:
 * a client whose temporal columns are all `*String` never reaches this, so it must not be forced
 * to provide Temporal. `typeof` rather than a property read because an absent global is a
 * ReferenceError on any other form of access.
 */
export function instantNow(): Temporal.Instant {
  if (typeof Temporal === 'undefined') {
    throw errorTemporalUnavailableForDefault(INSTANT_NOW_GENERATOR_ID);
  }
  return Temporal.Now.instant();
}
