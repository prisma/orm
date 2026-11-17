import type { ContractEnum, JsonValue } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const HASHES = {
  storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
  profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
};

const valueLiterals: Record<string, (value: JsonValue) => string | undefined> = {
  'test/text@1': (value) => JSON.stringify(value),
  'test/bigint@1': (value) => `${value}n`,
  'test/date@1': () => undefined,
  'test/float@1': (value) => (typeof value === 'number' ? String(value) : undefined),
  'test/bool@1': (value) => String(value),
};

const codecLookup: CodecLookup = {
  get: () => undefined,
  renderOutputTypeFor: () => undefined,
  renderValueLiteralFor: (id, value) => valueLiterals[id]?.(value),
};

function enumOf(codecId: string, ...members: [string, JsonValue][]): ContractEnum {
  return { codecId, members: members.map(([name, value]) => ({ name, value })) };
}

function emitEnums(enums: Record<string, ContractEnum>, lookup: CodecLookup | undefined): string {
  const contract = createTestContract({
    namespaces: { public: { models: {}, enum: enums } },
  });
  return generateContractDts(contract, createMockSpi(), [], HASHES, undefined, lookup);
}

function memberTypesOf(dts: string): string {
  const start = dts.indexOf('readonly enumMemberTypes?:');
  expect(start).toBeGreaterThan(-1);
  return dts.slice(start, dts.indexOf('\n', start));
}

describe('generateContractDts enum member types', () => {
  it('types each member as the literal its codec renders for the stored form', () => {
    const dts = emitEnums(
      {
        Role: enumOf('test/text@1', ['User', 'user']),
        Level: enumOf('test/bigint@1', ['Low', '1'], ['High', '-10']),
        Ratio: enumOf('test/float@1', ['Half', 1.5]),
        Flag: enumOf('test/bool@1', ['On', true]),
      },
      codecLookup,
    );
    expect(memberTypesOf(dts)).toBe(
      'readonly enumMemberTypes?: { ' +
        'readonly Role: readonly [{ readonly name: "User"; readonly value: "user" }]; ' +
        'readonly Level: readonly [{ readonly name: "Low"; readonly value: 1n }, { readonly name: "High"; readonly value: -10n }]; ' +
        'readonly Ratio: readonly [{ readonly name: "Half"; readonly value: 1.5 }]; ' +
        'readonly Flag: readonly [{ readonly name: "On"; readonly value: true }] };',
    );
  });

  it("types a member with no literal type as its codec's output type", () => {
    const dts = emitEnums(
      {
        Launch: enumOf('test/date@1', ['First', '2024-01-01T00:00:00.000Z']),
        Ratio: enumOf('test/float@1', ['Unknown', 'NaN']),
      },
      codecLookup,
    );
    expect(memberTypesOf(dts)).toBe(
      'readonly enumMemberTypes?: { ' +
        'readonly Launch: readonly [{ readonly name: "First"; readonly value: CodecTypes["test/date@1"]["output"] }]; ' +
        'readonly Ratio: readonly [{ readonly name: "Unknown"; readonly value: CodecTypes["test/float@1"]["output"] }] };',
    );
  });

  it("types members as their codec's output type when the lookup renders no literal for them", () => {
    const withoutCodec = emitEnums({ Level: enumOf('test/missing@1', ['Low', '1']) }, codecLookup);
    const withoutRenderer = emitEnums(
      { Level: enumOf('test/bigint@1', ['Low', '1']) },
      { get: () => undefined, renderOutputTypeFor: () => undefined },
    );
    const withoutLookup = emitEnums({ Level: enumOf('test/bigint@1', ['Low', '1']) }, undefined);
    expect([
      memberTypesOf(withoutCodec),
      memberTypesOf(withoutRenderer),
      memberTypesOf(withoutLookup),
    ]).toEqual([
      'readonly enumMemberTypes?: { readonly Level: readonly [{ readonly name: "Low"; readonly value: CodecTypes["test/missing@1"]["output"] }] };',
      'readonly enumMemberTypes?: { readonly Level: readonly [{ readonly name: "Low"; readonly value: CodecTypes["test/bigint@1"]["output"] }] };',
      'readonly enumMemberTypes?: { readonly Level: readonly [{ readonly name: "Low"; readonly value: CodecTypes["test/bigint@1"]["output"] }] };',
    ]);
  });

  it("types a member as its codec's output type when the rendered literal is not a safe type expression", () => {
    const dts = emitEnums(
      { Level: enumOf('test/unsafe@1', ['Low', 'low']) },
      {
        get: () => undefined,
        renderOutputTypeFor: () => undefined,
        renderValueLiteralFor: () => '"low"; export type Injected = 1; type X = "x"',
      },
    );
    expect(memberTypesOf(dts)).toBe(
      'readonly enumMemberTypes?: { readonly Level: readonly [{ readonly name: "Low"; readonly value: CodecTypes["test/unsafe@1"]["output"] }] };',
    );
  });

  it('keeps the stored forms in the enum entry', () => {
    const dts = emitEnums({ Level: enumOf('test/bigint@1', ['Low', '1']) }, codecLookup);
    expect(dts).toContain(
      'readonly enum: { readonly Level: { readonly codecId: "test/bigint@1"; readonly members: readonly [{ readonly name: "Low"; readonly value: "1" }] } };',
    );
  });

  it('emits no member types for a namespace without enums', () => {
    const dts = emitEnums({}, codecLookup);
    expect(dts).not.toContain('enumMemberTypes');
  });
});
