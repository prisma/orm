import type { AuthoringFieldPresetDescriptor } from '@internal/framework-components/authoring';

/**
 * Hand-written mirror of family-sql's `temporalCodecPresetWithPrecision`
 * output, over an invented portable codec so the contract-ts test pack stays
 * target-agnostic. The id is deliberately not a shipped one — the factory is
 * generic over `codecId`, so an invented anchor exercises it exactly as a real
 * codec would, without tying this pack to a target's codec set.
 *
 * It is hand-written because this package cannot import family-sql:
 * family-sql declares `@internal/sql-contract-ts` as a production
 * dependency, so the reverse import would be a cycle.
 *
 * It is kept honest by `family-sql/test/temporal-codec-presets.test.ts`, which
 * imports this mirror and asserts it deep-equals the factory output. The
 * factory is generic over codecId/nativeType, so the invented codec id anchors
 * exactly as a real one would.
 */
const NOW_PHASE = { kind: 'generator', id: 'timestampNow' } as const;

export const sqlTimestampPresetMirror = {
  kind: 'fieldPreset',
  args: [
    { name: 'precision', kind: 'number', optional: true, integer: true, minimum: 0 },
    { name: 'onCreate', kind: 'option', values: ['now'], optional: true },
    { name: 'onUpdate', kind: 'option', values: ['now'], optional: true },
  ],
  output: {
    codecId: 'test/timestamp@1',
    nativeType: 'timestamp',
    typeParams: { precision: { kind: 'arg', index: 0 } },
    executionDefaults: {
      onCreate: { kind: 'select', index: 1, cases: { now: NOW_PHASE } },
      onUpdate: { kind: 'select', index: 2, cases: { now: NOW_PHASE } },
    },
  },
} as const satisfies AuthoringFieldPresetDescriptor;
