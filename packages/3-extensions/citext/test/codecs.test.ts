import { enumRefusalOf } from '@internal/framework-components/codec';
import { pgText } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import { citextDescriptor } from '../src/core/codecs';
import { citextCitext } from '../src/core/data-types';
import citextPack from '../src/exports/pack';
import citextRuntime from '../src/exports/runtime';
import { fromContractJson, toContractJson } from './contract-json';

const codec = citextDescriptor.factory()({ name: 'email' });
const ctx = {};

describe('pg/citext@1', () => {
  it('represents citext/citext with the traits of a text codec, written as a JSON string', () => {
    expect({
      codecId: citextDescriptor.codecId,
      dataType: citextDescriptor.dataType,
      traits: citextDescriptor.traits,
      jsonType: citextDescriptor.jsonType,
    }).toEqual({
      codecId: 'pg/citext@1',
      dataType: 'citext/citext',
      traits: ['equality', 'order', 'textual'],
      jsonType: 'string',
    });
  });

  it('sends and reads the text unchanged, keeping its case', async () => {
    expect(await codec.toWire('Ada@Example.com', ctx)).toBe('Ada@Example.com');
    expect(await codec.fromWire('Ada@Example.com', ctx)).toBe('Ada@Example.com');
  });

  it('stores a value in the contract as its text', () => {
    const stored = toContractJson(codec, 'Ada');
    expect(stored).toBe('Ada');
    expect(fromContractJson(codec, stored)).toBe('Ada');
  });

  it('refuses an enum, because a CHECK on citext admits a member in another case', () => {
    expect(enumRefusalOf(citextDescriptor)).toMatch(
      /citext column compares without regard to case/,
    );
  });

  it('renders a literal as a TypeScript string', () => {
    expect(citextDescriptor.renderValueLiteral('a@x.com')).toBe('"a@x.com"');
  });
});

describe('citext/citext', () => {
  it('is written and reported as citext', () => {
    expect(citextCitext.sql.texts).toEqual([{ text: 'citext', written: true, catalog: true }]);
  });

  it('takes text unchanged and nothing else', () => {
    expect(Object.keys(citextCitext.casts)).toEqual([pgText.id]);
    expect(citextCitext.casts[pgText.id]?.('Ada')).toBe('Ada');
  });

  it('refuses a stored value that is not a string', () => {
    expect(() => citextCitext.fromContract(1, {})).toThrow();
  });
});

describe('the citext pack', () => {
  it('offers citext.Citext, inferred, producing pg/citext@1', () => {
    expect(citextPack.authoring.type.citext.Citext).toMatchObject({
      kind: 'typeConstructor',
      inferred: true,
      output: { codecId: 'pg/citext@1' },
    });
  });

  it('registers its data type and codec on both planes', () => {
    expect({
      dataTypes: citextPack.dataTypes.map((type) => type.id),
      runtimeCodecs: citextRuntime.codecs().map((descriptor) => descriptor.codecId),
      codecTypesImport: citextPack.types.codecTypes.import,
    }).toEqual({
      dataTypes: ['citext/citext'],
      runtimeCodecs: ['pg/citext@1'],
      codecTypesImport: {
        package: '@internal/extension-citext/codec-types',
        named: 'CodecTypes',
        alias: 'CitextTypes',
      },
    });
  });
});
