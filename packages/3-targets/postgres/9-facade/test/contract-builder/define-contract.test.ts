import { createPostgresBuiltinCodecLookup } from '@internal/adapter-postgres/control';
import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';

const textColumn = {
  codecId: 'sql/char@1' as const,
  typeParams: {},
};

describe('postgres defineContract wrap', () => {
  it('pre-binds family and target (no factory form)', () => {
    const result = defineContract({});
    expect(result.target).toBe('postgres');
    expect(result.targetFamily).toBe('sql');
  });

  it('pre-binds family and target (factory form)', () => {
    const result = defineContract({}, ({ field: f, model: m, gen, type }) => ({
      models: {
        Foo: m('Foo', { fields: { id: f.column(type.Char(36)).id().onCreate(gen.uuid()) } }),
      },
    }));
    expect(result.target).toBe('postgres');
    expect(result.targetFamily).toBe('sql');
    expect(domainModelsAtDefaultNamespace(result.domain)['Foo']).toBeDefined();
  });

  it('declares Date columns through the composed type helpers', () => {
    const result = defineContract({}, ({ field: f, model: m, type, gen }) => ({
      models: {
        Event: m('Event', {
          fields: {
            id: f.column(type.Char(36)).id().onCreate(gen.uuid()),
            at: f.column(type.TimestamptzJsDate()),
            precise: f.column(type.TimestamptzJsDate(3)).onCreate(gen.now()).onUpdate(gen.now()),
            created: f.column(type.temporal.CreatedAtJsDate()),
            updated: f.column(type.temporal.UpdatedAtJsDate()),
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
                  at: { codecId: 'pg/timestamptz-date@1', dataType: 'pg/timestamptz' },
                  precise: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
                  created: {
                    codecId: 'pg/timestamptz-date@1',
                    dataType: 'pg/timestamptz',
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
      ref: { namespace: 'public', entry: 'Event', field: 'created' },
      onCreate: { kind: 'generator', id: 'timestampNow' },
    });
  });

  it('types Date columns through the codec map, with no type of their own', () => {
    const contract = defineContract({}, ({ field: f, model: m, type }) => ({
      models: {
        Event: m('Event', {
          fields: {
            id: f.column({ codecId: 'pg/int4@1' }).id(),
            at: f.column(type.TimestamptzJsDate()),
            maybe: f.column(type.TimestamptzJsDate(6)).optional(),
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
    expect(dts).toContain('readonly codecId: "pg/timestamptz-date@1"');
    expect(dts).toContain('type FieldTypeOverrides = {  };');
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
