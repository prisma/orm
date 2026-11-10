import postgresAdapterControl from '@internal/adapter-postgres/control';
import paradedbControl from '@internal/extension-paradedb/control';
import pgvectorControl from '@internal/extension-pgvector/control';
import postgisControl from '@internal/extension-postgis/control';
import {
  isSqlDataType,
  renderSqlCatalogText,
  renderSqlTypeName,
  type SqlDataType,
  type SqlTypeParams,
} from '@internal/sql-contract/data-type';
import postgresTargetControl from '@internal/target-postgres/control';
import { alterTypeCheck, stackDataTypes } from '@internal/target-postgres/planner-sql-checks';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';

const components = [
  postgresTargetControl,
  postgresAdapterControl,
  pgvectorControl,
  postgisControl,
  paradedbControl,
];
const dataTypes = stackDataTypes(components);
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function accepts(type: SqlDataType, params: SqlTypeParams): boolean {
  return type.params === undefined || !(type.params(params) instanceof arktype.errors);
}

/** Parameters for each written text of `type` its schema accepts; enum-like names for a type that claims a kind. */
function samples(type: SqlDataType): readonly SqlTypeParams[] {
  if (type.sql.claimsKind !== undefined) {
    return [{ typeName: 'Mood' }, { typeName: 'app.status' }];
  }
  return type.sql.texts
    .filter((text) => text.written === true)
    .flatMap((text) => {
      const params: Record<string, number> = {};
      for (const match of text.text.matchAll(PLACEHOLDER)) {
        const name = match[1] ?? '';
        const value = [3, 1, 2, 10, 4326].find((candidate) =>
          accepts(type, { ...params, [name]: candidate }),
        );
        if (value === undefined) return [];
        params[name] = value;
      }
      return accepts(type, params) ? [params] : [];
    });
}

describe('the type check of a Postgres column type change, with extension types', () => {
  it('reads the written text of every data type of the stack as the planner checks it', () => {
    const compared = new Set<string>();
    const disagreements = dataTypes.filter(isSqlDataType).flatMap((type) =>
      samples(type).flatMap((params) => {
        compared.add(type.id);
        const written = renderSqlTypeName(type, params);
        const expected =
          type.sql.claimsKind === undefined
            ? { kind: 'catalog-text', text: renderSqlCatalogText(type, params) }
            : { kind: 'identity', typeName: written, many: false };
        const derived = alterTypeCheck(written, dataTypes, 'test');
        return JSON.stringify(derived) === JSON.stringify(expected)
          ? []
          : [{ type: type.id, written, expected, derived }];
      }),
    );

    expect(disagreements).toEqual([]);
    expect([...compared]).toEqual(
      expect.arrayContaining(['pgvector/vector', 'postgis/geometry', 'pg/enum', 'pg/int4']),
    );
  });
});
