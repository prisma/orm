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
import { SQL_EXPRESSION_DATA_TYPE_ID } from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';
import { sqliteTargetDescriptorMeta } from '../src/core/descriptor-meta';
import { sqliteTargetDescriptorMetaRuntime } from '../src/core/descriptor-meta-runtime';

const written = (text: string): readonly SqlTypeText[] => [{ text, written: true }];

/** Every SQLite text is written only, so no SQLite data type claims a reported type. */
const EXPECTED: Readonly<Record<string, readonly SqlTypeText[]>> = {
  'sqlite/text': written('text'),
  'sqlite/json': written('text'),
  'sqlite/datetime': written('text'),
  'sqlite/integer': written('integer'),
  'sqlite/bigint': written('integer'),
  'sqlite/real': written('real'),
  'sqlite/blob': written('blob'),
  'sqlite/character': written('character'),
  'sqlite/character-varying': written('character varying'),
};

const registered: readonly DataType[] = sqliteTargetDescriptorMeta.dataTypes;

function sqlTypeOf(id: string): SqlDataType {
  const type = registered.find((candidate) => candidate.id === id);
  if (type === undefined || !isSqlDataType(type)) {
    throw new Error(`${id} is not a registered SQL data type`);
  }
  return type;
}

describe('the SQLite data type declarations', () => {
  it('registers exactly these data types', () => {
    expect(registered.map((type) => type.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(registered.map((type) => [type.id] as const))(
    '%s declares its written texts and claims nothing',
    (id) => {
      expect(EXPECTED).toHaveProperty([id]);
      const { sql } = sqlTypeOf(id);
      expect(sql.texts).toEqual(EXPECTED[id]);
      expect(sql.claimsKind).toBeUndefined();
      expect(sql.render).toBeUndefined();
      expect(sql.fromReported).toBeUndefined();
    },
  );

  it('registers the data types from the target, in both planes', () => {
    expect(sqliteTargetDescriptorMetaRuntime.dataTypes).toBe(registered);
  });

  it.each(Object.keys(EXPECTED))('claims no reported type with %s', (id) => {
    const [text] = EXPECTED[id] ?? [];
    const reported = {
      text: text?.text ?? '',
      kind: undefined,
      schema: undefined,
      name: undefined,
    };
    expect(resolveReportedSqlType(reported, registered)).toBeUndefined();
  });
});

describe('writing a SQLite column type', () => {
  it.each([
    ['sqlite/text', {}, 'text'],
    ['sqlite/json', {}, 'text'],
    ['sqlite/datetime', {}, 'text'],
    ['sqlite/integer', {}, 'integer'],
    ['sqlite/bigint', {}, 'integer'],
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

describe("the SQL family's sql/expression data type", () => {
  it('is not among the data types this target declares texts for', () => {
    expect(registered.map((type) => type.id)).not.toContain(SQL_EXPRESSION_DATA_TYPE_ID);
  });

  it('is represented by no codec this target ships', () => {
    expect(
      codecDescriptors
        .filter((descriptor) => descriptor.dataType === SQL_EXPRESSION_DATA_TYPE_ID)
        .map((descriptor) => descriptor.codecId),
    ).toEqual([]);
  });
});
