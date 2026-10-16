import type { DataType } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  isSqlDataType,
  renderSqlTypeName,
  resolveReportedSqlType,
  type SqlDataType,
  type SqlTypeParams,
  type SqlTypeText,
  sqlBaseName,
} from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';
import { sqliteTargetDescriptorMeta } from '../src/core/descriptor-meta';

const writtenAndCatalog = (text: string): readonly SqlTypeText[] => [
  { text, written: true, catalog: true },
];

/** The six SQLite data types written and printed by one text each (ADR 254). */
const EXPECTED: Readonly<Record<string, readonly SqlTypeText[]>> = {
  'sqlite/text': writtenAndCatalog('text'),
  'sqlite/integer': writtenAndCatalog('integer'),
  'sqlite/real': writtenAndCatalog('real'),
  'sqlite/blob': writtenAndCatalog('blob'),
  'sqlite/character': writtenAndCatalog('character'),
  'sqlite/character-varying': writtenAndCatalog('character varying'),
};

/** The two types stored as `sqlite/text`, which declare no texts of their own. */
const STORED_AS_TEXT: readonly string[] = ['sqlite/datetime', 'sqlite/json'];

const registered: readonly DataType[] = sqliteTargetDescriptorMeta.dataTypes;
const withTexts = registered.filter((type) => !STORED_AS_TEXT.includes(type.id));

function sqlTypeOf(id: string): SqlDataType {
  const type = registered.find((candidate) => candidate.id === id);
  if (type === undefined || !isSqlDataType(type)) {
    throw new Error(`${id} is not a registered SQL data type`);
  }
  return type;
}

describe('the SQLite data type declarations', () => {
  it.each(STORED_AS_TEXT.map((id) => [id] as const))(
    '%s is stored as sqlite/text and declares no texts, so it claims no reported type',
    (id) => {
      const { sql } = sqlTypeOf(id);
      expect({ storedAs: sql.storedAs, texts: sql.texts }).toEqual({
        storedAs: 'sqlite/text',
        texts: [],
      });
    },
  );

  it.each(withTexts.map((type) => [type.id] as const))(
    '%s is declared with its one written and catalog text',
    (id) => {
      expect(EXPECTED).toHaveProperty([id]);
      const { sql } = sqlTypeOf(id);
      expect(sql.texts).toEqual(EXPECTED[id]);
      expect(sql.claimsKind).toBeUndefined();
      expect(sql.render).toBeUndefined();
      expect(sql.fromReported).toBeUndefined();
    },
  );

  it.each(
    Object.entries(EXPECTED).map(([id, [text]]) => [id, text?.text.toUpperCase() ?? ''] as const),
  )('%s claims the reported type %s', (id, text) => {
    const reported = { text, kind: undefined, schema: undefined, name: undefined };
    expect(resolveReportedSqlType(reported, registered)).toEqual({ dataType: id, typeParams: {} });
  });

  it('leaves a character type reported with its length unclaimed', () => {
    const reported = { text: 'CHARACTER(36)', kind: undefined, schema: undefined, name: undefined };
    expect(resolveReportedSqlType(reported, registered)).toBeUndefined();
  });
});

describe('writing a SQLite column type', () => {
  it.each([
    ['sqlite/text', {}, 'text'],
    ['sqlite/integer', {}, 'integer'],
    ['sqlite/real', {}, 'real'],
    ['sqlite/blob', {}, 'blob'],
    ['sqlite/character', {}, 'character'],
    ['sqlite/character', { length: 36 }, 'character'],
    ['sqlite/character-varying', {}, 'character varying'],
    ['sqlite/character-varying', { length: 255 }, 'character varying'],
  ] as const)('%s %j is written %s, and that is its base name', (id, params, text) => {
    expect(renderSqlTypeName(sqlTypeOf(id), params)).toBe(text);
    expect(sqlBaseName(sqlTypeOf(id), params)).toBe(text);
  });

  it.each([['sqlite/character'], ['sqlite/character-varying']])(
    '%s forgets its length in the normal form, once and for all',
    (id) => {
      const { normalize } = sqlTypeOf(id).sql;
      const params: SqlTypeParams = { length: 36 };
      expect(normalize(params)).toEqual({});
      expect(normalize(normalize(params))).toEqual(normalize(params));
    },
  );

  it.each([['sqlite/character'], ['sqlite/character-varying']])(
    '%s takes an optional length of 1 or more',
    (id) => {
      const invalidParams = expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' });
      expect(renderSqlTypeName(sqlTypeOf(id), { length: 1 })).toBeDefined();
      expect(() => renderSqlTypeName(sqlTypeOf(id), { length: 0 })).toThrow(invalidParams);
      expect(() => renderSqlTypeName(sqlTypeOf(id), { length: 1.5 })).toThrow(invalidParams);
    },
  );
});

describe('the parameter schema of every codec this target ships', () => {
  const dataTypes = createDataTypeLookup(registered);

  it.each(codecDescriptors.map((descriptor) => [descriptor.codecId, descriptor] as const))(
    '%s uses its data type’s parameter schema',
    (_codecId, descriptor) => {
      const type = dataTypes.get(descriptor.dataType);
      expect(type).toBeDefined();
      expect(descriptor.paramsSchema).toBe(type?.params);
      expect(descriptor.isParameterized).toBe(type?.params !== undefined);
    },
  );
});
