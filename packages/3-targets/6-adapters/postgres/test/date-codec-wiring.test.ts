import { describe, expect, it } from 'vitest';
import { postgresAuthoringTypes } from '../src/core/control-mutation-defaults';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import * as columnTypes from '../src/exports/column-types';

const codecId = 'pg/timestamptz-date@1';

describe('Postgres Date adapter wiring', () => {
  it('exports the Date column descriptor', () => {
    expect(columnTypes).not.toHaveProperty('timestamptzDateColumn');
    expect(columnTypes).toHaveProperty('timestamptzJsDateColumn', {
      codecId,
      nativeType: 'timestamptz',
    });
  });

  it('offers only precision-bearing TimestamptzJsDate without changing defaults', () => {
    expect(postgresAuthoringTypes).not.toHaveProperty('DateTimeDate');
    expect(postgresAuthoringTypes).not.toHaveProperty('TimestamptzDate');
    expect(postgresAuthoringTypes).toHaveProperty('TimestamptzJsDate', {
      kind: 'typeConstructor',
      args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
      output: {
        codecId,
        nativeType: 'timestamptz',
        typeParams: { precision: { kind: 'arg', index: 0 } },
      },
    });
    expect(postgresAuthoringTypes.DateTime.output.codecId).toBe('pg/timestamptz-temporal@1');
    expect(postgresAuthoringTypes.Timestamptz.output.codecId).toBe('pg/timestamptz-temporal@1');
  });

  it('declares storage and precision expansion for Date columns', () => {
    expect(postgresAdapterDescriptorMeta.types.storage).toContainEqual({
      typeId: codecId,
      familyId: 'sql',
      targetId: 'postgres',
      nativeType: 'timestamptz',
    });
    const hook = postgresAdapterDescriptorMeta.types.codecTypes.controlPlaneHooks[codecId];
    expect(hook.expandNativeType).toBeDefined();
    expect(hook.expandNativeType?.({ nativeType: 'timestamptz' })).toBe('timestamptz');
    for (const precision of [0, 3, 6]) {
      expect(
        hook.expandNativeType?.({ nativeType: 'timestamptz', typeParams: { precision } }),
      ).toBe(`timestamptz(${precision})`);
    }
    expect(() =>
      hook.expandNativeType?.({ nativeType: 'timestamptz', typeParams: { precision: -1 } }),
    ).toThrow();
  });
});
