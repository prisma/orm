import type { SqlDataType, SqlTypeParams } from '@internal/sql-contract/data-type';
import { type as arktype } from 'arktype';

const CANDIDATE_VALUES = [3, 1, 2, 10];
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function accepts(type: SqlDataType, params: SqlTypeParams): boolean {
  return type.params === undefined || !(type.params(params) instanceof arktype.errors);
}

/**
 * Parameters for each written text of `type` that its schema accepts, one set per text; for a type
 * that claims a kind, an enum-like name in the unbound namespace and one in a named schema.
 */
export function writtenTypeSamples(type: SqlDataType): readonly SqlTypeParams[] {
  if (type.sql.claimsKind !== undefined) {
    return [{ typeName: 'Mood' }, { typeName: 'app.status' }, { typeName: 'app.Status' }];
  }
  return type.sql.texts
    .filter((text) => text.written === true)
    .flatMap((text) => {
      const params: Record<string, number> = {};
      for (const match of text.text.matchAll(PLACEHOLDER)) {
        const name = match[1] ?? '';
        const value = CANDIDATE_VALUES.find((candidate) =>
          accepts(type, { ...params, [name]: candidate }),
        );
        if (value === undefined) return [];
        params[name] = value;
      }
      return accepts(type, params) ? [params] : [];
    });
}
