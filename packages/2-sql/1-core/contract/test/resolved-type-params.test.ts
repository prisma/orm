import { describe, expect, it } from 'vitest';
import { resolvedTypeParams } from '../src/ir/storage-type-instance';

const namedTypes = {
  Short: {
    kind: 'codec-instance',
    codecId: 'sql/varchar@1',
    nativeType: 'character varying',
    typeParams: { length: 10 },
  },
  Email: { kind: 'codec-instance', codecId: 'pg/text@1', nativeType: 'text', typeParams: {} },
} as const;

describe('resolvedTypeParams', () => {
  it('reads a type by its own parameters, or else by those of the named type it names', () => {
    expect({
      own: resolvedTypeParams({ typeParams: { length: 3 } }, namedTypes),
      named: resolvedTypeParams({ typeRef: 'Short' }, namedTypes),
      none: resolvedTypeParams({}, namedTypes),
    }).toEqual({ own: { length: 3 }, named: { length: 10 }, none: undefined });
  });

  it("reads empty parameters, its own or a named type's, as none", () => {
    expect({
      own: resolvedTypeParams({ typeParams: {} }, namedTypes),
      named: resolvedTypeParams({ typeRef: 'Email' }, namedTypes),
    }).toEqual({ own: undefined, named: undefined });
  });

  it('reads a named type the contract does not declare as having no parameters', () => {
    expect(resolvedTypeParams({ typeRef: 'Missing' }, namedTypes)).toBeUndefined();
  });
});
