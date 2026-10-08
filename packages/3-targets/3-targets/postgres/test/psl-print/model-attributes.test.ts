import { computeIndexContentHash, formatWireName } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import {
  attributeText,
  buildModels,
  fieldText,
  INT_COLUMN,
  oneModel,
  TEXT_COLUMN,
  table,
} from './print-support';

describe('names the PSL source cannot derive', () => {
  it('maps a model whose table is not the model name', () => {
    const [model] = buildModels({
      models: { Widget: { table: 'widgets', fields: { id: { column: 'id' } } } },
      tables: { widgets: table({ columns: { id: INT_COLUMN }, primaryKey: { columns: ['id'] } }) },
    });
    expect(model?.attributes.map(attributeText)).toEqual(['@@map("widgets")']);
  });

  it('leaves a model whose table is the model name unmapped', () => {
    const [model] = buildModels({
      models: { Widget: { table: 'Widget', fields: { id: { column: 'id' } } } },
      tables: { Widget: table({ columns: { id: INT_COLUMN }, primaryKey: { columns: ['id'] } }) },
    });
    expect(model?.attributes).toEqual([]);
  });

  it('maps a field whose column is not the field name', () => {
    const model = oneModel(
      { id: INT_COLUMN, first_name: TEXT_COLUMN },
      { id: { column: 'id' }, firstName: { column: 'first_name' } },
    );
    expect(model?.fields.map(fieldText)).toEqual([
      'id Int @id',
      'firstName String @map("first_name")',
    ]);
  });
});

describe('keys and indexes', () => {
  it('prints a unique index as an index, never as @unique', () => {
    const model = oneModel(
      { id: INT_COLUMN, email: TEXT_COLUMN },
      { id: { column: 'id' }, email: { column: 'email' } },
    );
    expect(model?.fields.map(fieldText)).toEqual(['id Int @id', 'email String']);

    const [withIndex] = buildModels({
      models: {
        Widget: { table: 'Widget', fields: { id: { column: 'id' }, email: { column: 'email' } } },
      },
      tables: {
        Widget: table({
          columns: { id: INT_COLUMN, email: TEXT_COLUMN },
          primaryKey: { columns: ['id'] },
          indexes: [{ name: 'Widget_email_key', unique: true, columns: ['email'] }],
        }),
      },
    });
    expect(withIndex?.attributes.map(attributeText)).toEqual([
      '@@index([email], map: "Widget_email_key", unique: true)',
    ]);
    expect(withIndex?.fields.map(fieldText)).toEqual(['id Int @id', 'email String']);
  });

  describe('a full-text index', () => {
    const fullTextModel = (index: Record<string, unknown>) =>
      buildModels({
        models: {
          Post: {
            table: 'Post',
            fields: {
              id: { column: 'id' },
              title: { column: 'title' },
              body: { column: 'body_text' },
              summary: { column: 'summary' },
            },
          },
        },
        tables: {
          Post: table({
            columns: {
              id: INT_COLUMN,
              title: TEXT_COLUMN,
              body_text: TEXT_COLUMN,
              summary: TEXT_COLUMN,
            },
            primaryKey: { columns: ['id'] },
            indexes: [index],
          }),
        },
      })[0];

    it('prints as @@fullTextIndex, a group of one as the bare field and a larger group as a list', () => {
      const index = {
        columns: ['title', 'body_text', 'summary'],
        unique: false,
        type: 'fullText',
        options: { weightGroups: [['title'], ['body_text', 'summary']], language: 'english' },
      };
      const name = formatWireName('post_search', computeIndexContentHash(index));

      expect(
        fullTextModel({ ...index, name, prefix: 'post_search' })?.attributes.map(attributeText),
      ).toEqual(['@@fullTextIndex([title, [body, summary]], name: "post_search")']);
    });

    it('prints a language other than the default, a predicate, and an exact name', () => {
      expect(
        fullTextModel({
          name: 'legacy_search',
          columns: ['title'],
          where: 'id > 1',
          unique: false,
          type: 'fullText',
          options: { weightGroups: [['title']], language: 'german' },
        })?.attributes.map(attributeText),
      ).toEqual([
        '@@fullTextIndex([title], map: "legacy_search", language: "german", where: sql`id > 1`)',
      ]);
    });
  });

  it('prints a unique constraint as @@unique, under the field names its columns carry', () => {
    const [model] = buildModels({
      models: {
        Widget: { table: 'Widget', fields: { id: { column: 'id' }, email: { column: 'e_mail' } } },
      },
      tables: {
        Widget: table({
          columns: { id: INT_COLUMN, e_mail: TEXT_COLUMN },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['e_mail'], name: 'widget_email_key' }],
        }),
      },
    });
    expect(model?.attributes.map(attributeText)).toEqual([
      '@@unique([email], map: "widget_email_key")',
    ]);
  });

  it('prints each check constraint the PSL source does not derive', () => {
    const [model] = buildModels({
      models: { Widget: { table: 'Widget', fields: { id: { column: 'id' } } } },
      tables: {
        Widget: table({
          columns: { id: INT_COLUMN },
          primaryKey: { columns: ['id'] },
          checks: [
            { name: 'widget_id_positive', expression: 'id > 0' },
            { name: 'widget_id_small', expression: 'id < 100' },
          ],
        }),
      },
    });
    expect(model?.attributes.map(attributeText)).toEqual([
      '@@check(expression: sql`id > 0`, map: "widget_id_positive")',
      '@@check(expression: sql`id < 100`, map: "widget_id_small")',
    ]);
  });

  it('prints a multi-column primary key as a model attribute', () => {
    const [model] = buildModels({
      models: {
        Widget: { table: 'Widget', fields: { a: { column: 'a' }, b: { column: 'b_col' } } },
      },
      tables: {
        Widget: table({
          columns: { a: INT_COLUMN, b_col: TEXT_COLUMN },
          primaryKey: { columns: ['a', 'b_col'] },
        }),
      },
    });
    expect(model?.attributes.map(attributeText)).toEqual(['@@id([a, b])']);
  });
});
