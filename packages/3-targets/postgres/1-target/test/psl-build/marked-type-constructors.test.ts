import { fewestArgumentsCall, inferredTypeConstructors } from '@internal/family-sql/psl-build';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringTypes } from '../../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-registry';
import { postgresDataTypes } from '../../src/core/data-types';
import { postgresScalarAndNativeTypeConstructors } from '../../src/core/type-constructors';

const authoringTypes: AuthoringTypeNamespace = {
  ...postgresAuthoringTypes,
  ...postgresScalarAndNativeTypeConstructors,
};
const dataTypeLookup = createDataTypeLookup(postgresDataTypes);
const constructors = inferredTypeConstructors({
  authoringTypes,
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypeLookup,
});

function call(dataType: string, params: Record<string, unknown>) {
  const marked = constructors.get(dataType);
  return marked === undefined ? undefined : fewestArgumentsCall(marked, params);
}

describe('inferredTypeConstructors', () => {
  it('finds the constructor marked inferred for each data type, by its path', () => {
    expect(
      Object.fromEntries(
        ['pg/text', 'pg/numeric', 'pg/timestamptz', 'pg/bit', 'pg/enum'].map((id) => [
          id,
          constructors.get(id)?.path,
        ]),
      ),
    ).toEqual({
      'pg/text': ['String'],
      'pg/numeric': ['Numeric'],
      'pg/timestamptz': ['TimestamptzJsDate'],
      'pg/bit': ['Bit'],
      'pg/enum': ['pg', 'enum'],
    });
  });

  it('has nothing for a data type no constructor is marked for', () => {
    expect([constructors.get('pg/tsquery'), constructors.get('pg/text-array')]).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('fewestArgumentsCall', () => {
  it('drops arguments from the end while the normal form stays the same', () => {
    expect({
      numeric10: call('pg/numeric', { precision: 10, scale: 0 }),
      numeric10_2: call('pg/numeric', { precision: 10, scale: 2 }),
      numeric: call('pg/numeric', {}),
      char1: call('pg/char', { length: 1 }),
      char5: call('pg/char', { length: 5 }),
      bit1: call('pg/bit', { length: 1 }),
      varbit: call('pg/varbit', {}),
      timestamptz3: call('pg/timestamptz', { precision: 3 }),
      text: call('pg/text', {}),
    }).toEqual({
      numeric10: { path: ['Numeric'], args: [10] },
      numeric10_2: { path: ['Numeric'], args: [10, 2] },
      numeric: { path: ['Numeric'], args: [] },
      char1: { path: ['Char'], args: [] },
      char5: { path: ['Char'], args: [5] },
      bit1: { path: ['Bit'], args: [] },
      varbit: { path: ['VarBit'], args: [] },
      timestamptz3: { path: ['TimestamptzJsDate'], args: [3] },
      text: { path: ['String'], args: [] },
    });
  });

  it('gives nothing for a constructor whose argument names another entity', () => {
    expect(call('pg/enum', { typeName: 'mood' })).toBeUndefined();
  });
});
