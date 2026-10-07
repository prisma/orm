import 'temporal-polyfill/full/global';
import { describe, expect, it } from 'vitest';
import { defineContract, enumType, member } from '../src/exports/contract-builder';
import postgresStatic from '../src/static/postgres-static';

const TextLevel = enumType(
  'TextLevel',
  { codecId: 'pg/text@1', nativeType: 'text' },
  member('Low', 'low'),
);
const InstantLevel = enumType(
  'InstantLevel',
  { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
  member('Launch', Temporal.Instant.from('2024-01-01T00:00:00Z')),
);

const contractJson: unknown = JSON.parse(
  JSON.stringify(
    defineContract({ enums: { TextLevel, InstantLevel } }, ({ field, model }) => ({
      models: {
        Reading: model('Reading', {
          fields: {
            id: field.id.uuidv4String(),
            text: field.namedType(TextLevel),
            instant: field.namedType(InstantLevel),
          },
        }),
      },
    })),
  ),
);

function withoutTemporal<T>(body: () => T): T {
  const original = Reflect.get(globalThis, 'Temporal');
  Reflect.deleteProperty(globalThis, 'Temporal');
  try {
    return body();
  } finally {
    Reflect.set(globalThis, 'Temporal', original);
  }
}

describe('a client whose contract has a Temporal enum, in a runtime without Temporal', () => {
  it('builds, reads its other enums, and fails only when the Temporal enum is read', () => {
    const observed = withoutTemporal(() => {
      const { enums } = postgresStatic({ contractJson });
      const levels =
        enums['public'] ?? expect.unreachable('the TS builder registers enums in public');
      let instantError: unknown;
      try {
        void levels['InstantLevel']?.members;
      } catch (error) {
        instantError = error;
      }
      return {
        temporalPresent: 'Temporal' in globalThis,
        enumNames: Object.keys(levels),
        text: levels['TextLevel']?.has('low'),
        instantError,
      };
    });

    expect(observed).toEqual({
      temporalPresent: false,
      enumNames: ['TextLevel', 'InstantLevel'],
      text: true,
      instantError: expect.objectContaining({ code: 'RUNTIME.TEMPORAL_UNAVAILABLE' }),
    });
  });
});
