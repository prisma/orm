/**
 * End-to-end TS narrowing for the paradedb bm25 index type.
 *
 * Verifies that when a contract attaches `paradedbPack` via the
 * `defineContract({...}, ({ model }) => ...)` factory form, the
 * `constraints.index({ type: 'bm25', options: ... })` call site narrows
 * `options` against the registered shape and rejects unregistered types
 * and bad option shapes at compile time.
 */
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import paradedbPack from '@internal/extension-paradedb/pack';
import {
  defineContract,
  field,
  model,
  postgres18,
  postgresDriver,
} from '@internal/postgres/contract-builder';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('paradedb bm25 narrowing in TS authoring DSL', () => {
  it('typechecks and accepts a well-formed bm25 index via the helpers factory', () => {
    const contract = defineContract(
      {
        requiredCapabilities: [...postgres18, ...postgresDriver],
        extensions: { paradedb: paradedbPack },
      },
      ({ model: helperModel, field: helperField }) => {
        const Doc = helperModel('Doc', {
          fields: {
            id: helperField.column(int4Column).id(),
            body: helperField.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'doc',
          indexes: [
            constraints.index([cols.body], {
              type: 'bm25',
              options: { key_field: 'id' },
              name: 'doc_body_bm25_idx',
            }),
          ],
        }));
        return { models: { Doc } };
      },
    );

    const indexes = contract.storage.namespaces['public'].entries.table.doc.indexes;
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({
      columns: ['body'],
      name: 'doc_body_bm25_idx_a755c485',
      prefix: 'doc_body_bm25_idx',
      type: 'bm25',
      options: { key_field: 'id' },
    });
  });

  it('rejects a bm25 index with an unknown options key at compile time', () => {
    expect(() =>
      defineContract(
        {
          requiredCapabilities: [...postgres18, ...postgresDriver],
          extensions: { paradedb: paradedbPack },
        },
        ({ model: helperModel, field: helperField }) => {
          const Doc = helperModel('Doc', {
            fields: {
              id: helperField.column(int4Column).id(),
              body: helperField.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'doc',
            indexes: [
              constraints.index([cols.body], {
                type: 'bm25',
                // @ts-expect-error — bm25 options is { key_field: string } in strict mode; unknown_key is rejected
                options: { key_field: 'id', unknown_key: 'x' },
              }),
            ],
          }));
          return { models: { Doc } };
        },
      ),
    ).toThrow(/unknown_key/);
  });

  it('rejects a bm25 index missing the required key_field at compile time', () => {
    expect(() =>
      defineContract(
        {
          requiredCapabilities: [...postgres18, ...postgresDriver],
          extensions: { paradedb: paradedbPack },
        },
        ({ model: helperModel, field: helperField }) => {
          const Doc = helperModel('Doc', {
            fields: {
              id: helperField.column(int4Column).id(),
              body: helperField.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'doc',
            indexes: [
              constraints.index([cols.body], {
                type: 'bm25',
                // @ts-expect-error — bm25 options requires key_field
                options: {},
              }),
            ],
          }));
          return { models: { Doc } };
        },
      ),
    ).toThrow(/key_field/);
  });

  it('rejects an unregistered index type at compile time', () => {
    expect(() =>
      defineContract(
        {
          requiredCapabilities: [...postgres18, ...postgresDriver],
          extensions: { paradedb: paradedbPack },
        },
        ({ model: helperModel, field: helperField }) => {
          const Doc = helperModel('Doc', {
            fields: {
              id: helperField.column(int4Column).id(),
              body: helperField.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'doc',
            indexes: [
              constraints.index([cols.body], {
                // @ts-expect-error — only 'bm25' is registered when paradedb is attached; 'made-up' is not
                type: 'made-up',
                options: { key_field: 'id' },
              }),
            ],
          }));
          return { models: { Doc } };
        },
      ),
    ).toThrow(/unregistered index type "made-up"/);
  });

  it('rejects options without a type at compile time', () => {
    expect(() =>
      defineContract(
        {
          requiredCapabilities: [...postgres18, ...postgresDriver],
          extensions: { paradedb: paradedbPack },
        },
        ({ model: helperModel, field: helperField }) => {
          const Doc = helperModel('Doc', {
            fields: {
              id: helperField.column(int4Column).id(),
              body: helperField.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'doc',
            indexes: [
              // @ts-expect-error — providing options without a type is a compile error when packs contribute index types
              constraints.index([cols.body], {
                options: { key_field: 'id' },
              }),
            ],
          }));
          return { models: { Doc } };
        },
      ),
    ).toThrow(/options requires an explicit type/);
  });

  it('imported bare model() rejects any type/options — strict by default', () => {
    const Doc = model('Doc', {
      fields: {
        id: field.column(int4Column).id(),
        body: field.column(textColumn),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'doc',
      indexes: [
        // @ts-expect-error - bare model() has no attached packs, so no index
        // type literals are registered; type/options aren't allowed at all.
        constraints.index([cols.body], { type: 'made-up', options: {} }),
      ],
    }));

    expect(() =>
      defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver], models: { Doc } }),
    ).toThrow(/unregistered index type "made-up"/);
  });

  it('imported bare model() still accepts a default index with no type/options', () => {
    const Doc = model('Doc', {
      fields: {
        id: field.column(int4Column).id(),
        body: field.column(textColumn),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'doc',
      indexes: [constraints.index([cols.body])],
    }));
    expectTypeOf<typeof Doc.__indexTypes>().toEqualTypeOf<Record<never, never>>();

    defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver], models: { Doc } });
  });

  it("helpers-bound model() carries the merged packs' index-type map", () => {
    defineContract(
      {
        requiredCapabilities: [...postgres18, ...postgresDriver],
        extensions: { paradedb: paradedbPack },
      },
      ({ model: helperModel, field: helperField }) => {
        const Doc = helperModel('Doc', {
          fields: {
            id: helperField.column(int4Column).id(),
            body: helperField.column(textColumn),
          },
        });
        expectTypeOf<typeof Doc.__indexTypes>().toMatchTypeOf<{
          readonly bm25: { readonly options: { readonly key_field: string } };
        }>();
        return {
          models: {
            Doc: Doc.sql({ table: 'doc' }),
          },
        };
      },
    );
  });
});
