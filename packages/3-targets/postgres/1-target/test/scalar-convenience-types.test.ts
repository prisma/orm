import {
  instantiateAuthoringTypeCall,
  instantiateAuthoringTypeConstructor,
  typeChoiceArgumentsFromObject,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import {
  postgresConvenienceScalarTypes,
  postgresDeprecatedScalarTypes,
  postgresExplicitTypes,
  postgresScalarTypes,
} from '../src/core/type-constructors';

type ConvenienceName = keyof typeof postgresConvenienceScalarTypes;
type ExplicitName = keyof typeof postgresExplicitTypes;

function convenience(name: ConvenienceName, written: Readonly<Record<string, unknown>> = {}) {
  const args = typeChoiceArgumentsFromObject(name, postgresConvenienceScalarTypes[name], [written]);
  return instantiateAuthoringTypeCall(postgresScalarTypes, name, args);
}

function explicit(name: ExplicitName, args: readonly unknown[] = []) {
  return instantiateAuthoringTypeConstructor(postgresExplicitTypes[name], args);
}

describe('a convenience scalar type', () => {
  it.each([
    ['Int', {}, 'Int4', []],
    ['Int', { storage: 'int2' }, 'Int2', []],
    ['BigInt', {}, 'Int8BigInt', []],
    ['BigInt', { as: 'number' }, 'Int8Number', []],
    ['BigInt', { storage: 'numeric' }, 'NumericBigInt', []],
    ['Float', {}, 'Float8', []],
    ['Float', { storage: 'float4' }, 'Float4', []],
    ['Decimal', {}, 'NumericString', []],
    ['Decimal', { precision: 10, scale: 2 }, 'NumericString', [10, 2]],
    ['String', {}, 'Text', []],
    ['String', { storage: 'varchar' }, 'Varchar', []],
    ['String', { storage: 'varchar', length: 12 }, 'Varchar', [12]],
    ['String', { storage: 'char', length: 3 }, 'Char', [3]],
    ['Boolean', {}, 'Bool', []],
    ['Bytes', {}, 'Bytea', []],
  ] as const)('%s(%o) is exactly %s(%o)', (name, written, explicitName, args) => {
    expect(convenience(name, written)).toEqual(explicit(explicitName, args));
  });

  it.each([
    [
      'BigInt',
      { storage: 'numeric', as: 'number' },
      'Argument "storage" of BigInt cannot be numeric with as: number; write one of: int8.',
    ],
    [
      'String',
      { length: 12 },
      'Argument "length" of String does not apply to Text, the type that storage: text chooses.',
    ],
    ['Int', { storage: 'int8' }, 'Argument "storage" of Int is int8; write one of: int4, int2.'],
  ] as const)('refuses %s(%o) at the argument', (name, written, message) => {
    expect(() => convenience(name, written)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID', message }),
    );
  });
});

describe('a deprecated explicit type name', () => {
  it.each([
    ['SmallInt', 'Int2'],
    ['BigIntNumber', 'Int8Number'],
    ['Numeric', 'NumericString'],
    ['UnboundedInt', 'NumericBigInt'],
    ['Real', 'Float4'],
    ['VarChar', 'Varchar'],
    ['VarBit', 'Varbit'],
  ] as const)('%s is an alias of %s, with the same codec and arguments', (alias, replacement) => {
    const { deprecated, ...descriptor } = postgresDeprecatedScalarTypes[alias];
    const { inferred: _inferred, ...replacing } = {
      inferred: undefined,
      ...postgresExplicitTypes[replacement],
    };
    expect({ deprecated, descriptor }).toEqual({
      deprecated: { replacement },
      descriptor: replacing,
    });
  });
});
