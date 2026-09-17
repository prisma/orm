import { createPostgresBuiltinCodecLookup } from '@internal/adapter-postgres/control';
import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

const textColumn = {
  codecId: 'sql/char@1' as const,
  nativeType: 'character varying' as const,
  typeParams: {},
};

describe('postgres defineContract wrap', () => {
  it('pre-binds family and target (no factory form)', () => {
    const result = defineContract({});
    expect(result.target).toBe('postgres');
    expect(result.targetFamily).toBe('sql');
  });

  it('pre-binds family and target (factory form)', () => {
    const result = defineContract({}, ({ field: f, model: m }) => ({
      models: {
        Foo: m('Foo', { fields: { id: f.id.uuidv4String() } }),
      },
    }));
    expect(result.target).toBe('postgres');
    expect(result.targetFamily).toBe('sql');
    expect(domainModelsAtDefaultNamespace(result.domain)['Foo']).toBeDefined();
  });

  it('exposes Date presets through the composed public field facade', () => {
    const result = defineContract({}, ({ field: f, model: m }) => ({
      models: {
        Event: m('Event', {
          fields: {
            id: f.id.uuidv4String(),
            at: f.temporal.timestamptzJsDate(),
            precise: f.temporal.timestamptzJsDate(3, 'now', 'now'),
            created: f.temporal.createdAtJsDate(),
            updated: f.temporal.updatedAtJsDate(),
          },
        }),
      },
    }));
    expect(result.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Event: {
                columns: {
                  at: { codecId: 'pg/timestamptz-date@1', nativeType: 'timestamptz' },
                  precise: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
                  created: {
                    codecId: 'pg/timestamptz-date@1',
                    nativeType: 'timestamptz',
                  },
                  updated: { codecId: 'pg/timestamptz-date@1' },
                },
              },
            },
          },
        },
      },
    });
    expect(result.storage.namespaces.public.entries.table.Event.columns.created).not.toHaveProperty(
      'default',
    );
    expect(result.execution?.mutations?.defaults).toContainEqual({
      ref: { namespace: 'public', table: 'Event', column: 'created' },
      onCreate: { kind: 'generator', id: 'timestampNow' },
    });
  });

  it('emits Date output via the codec map or the precision renderer', () => {
    const contract = defineContract({}, ({ field: f, model: m }) => ({
      models: {
        Event: m('Event', {
          fields: {
            id: f.column({ codecId: 'pg/int4@1', nativeType: 'int4' }).id(),
            at: f.temporal.timestamptzJsDate(),
            maybe: f.temporal.timestamptzJsDate(6).optional(),
          },
        }),
      },
    }));
    const dts = generateContractDts(
      contract,
      sqlEmission,
      [{ package: '@internal/target-postgres/codec-types', named: 'CodecTypes', alias: 'PgTypes' }],
      { storageHash: 'test-storage-hash', profileHash: 'test-profile-hash' },
      undefined,
      createPostgresBuiltinCodecLookup(),
    );
    expect(dts).toContain('import type { CodecTypes as PgTypes }');
    expect(dts).toContain('readonly at: CodecTypes["pg/timestamptz-date@1"]["output"]');
    expect(dts).toContain('readonly maybe: Date | null');
    expect(dts).not.toContain('Date<');
    expect(dts).not.toContain('import type { Date }');
  });

  it('accepts extensions: undefined', () => {
    const result = defineContract({ extensions: undefined });
    expect(result.target).toBe('postgres');
  });

  it('produces a model when defined inline', () => {
    const result = defineContract({
      models: {
        Bar: model('Bar', { fields: { id: field.column(textColumn).id() } }),
      },
    });
    expect(domainModelsAtDefaultNamespace(result.domain)['Bar']).toBeDefined();
  });
});
