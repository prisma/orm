import { declaredJsonType } from '@internal/sql-contract/codec-json-type';
import { describe, expect, it } from 'vitest';
import { buildPostgresCodecDescriptorRegistry } from '../src/core/codec-descriptor';
import { postgresCodecDescriptorRegistry } from '../src/core/registry';

describe('the JSON type a codec declares', () => {
  it('is declared by every Postgres and SQL family codec', () => {
    const undeclared = [...postgresCodecDescriptorRegistry.values()]
      .filter((descriptor) => declaredJsonType(descriptor) === undefined)
      .map((descriptor) => descriptor.codecId);
    expect(undeclared).toEqual([]);
  });

  it('is the type the codec value is written as inside a JSON document', () => {
    expect(
      Object.fromEntries(
        [
          'sql/text@1',
          'sql/int@1',
          'sql/raw@1',
          'pg/numeric@1',
          'pg/bool@1',
          'pg/enum@1',
          'pg/text-array@1',
          'pg/bytea@1',
          'pg/interval@1',
          'pg/jsonb@1',
          'pg/int8@1',
          'pg/timestamp-date@1',
          'pg/timestamp-instant@1',
          'pg/interval-string@1',
        ].map((codecId) => [
          codecId,
          postgresCodecDescriptorRegistry.descriptorFor(codecId)?.jsonType,
        ]),
      ),
    ).toEqual({
      'sql/text@1': 'string',
      'sql/int@1': 'number',
      'sql/raw@1': 'any',
      'pg/numeric@1': 'string',
      'pg/bool@1': 'boolean',
      'pg/enum@1': 'string',
      'pg/text-array@1': 'array',
      'pg/bytea@1': 'object',
      'pg/interval@1': 'object',
      'pg/jsonb@1': 'any',
      'pg/int8@1': 'number',
      'pg/timestamp-date@1': 'string',
      'pg/timestamp-instant@1': 'string',
      'pg/interval-string@1': 'string',
    });
  });

  it('is not required of a descriptor the registry accepts, so a codec compiled before codecs declared one still registers', () => {
    const text = postgresCodecDescriptorRegistry.descriptorFor('pg/text@1');
    const undeclared = {
      descriptorKind: text?.descriptorKind,
      codecId: 'demo/undeclared@1',
      traits: text?.traits,
      paramsSchema: undefined,
      isParameterized: false,
      factory: text?.factory.bind(text),
      projectJson: text?.projectJson.bind(text),
    };
    expect(
      buildPostgresCodecDescriptorRegistry([undeclared]).descriptorFor('demo/undeclared@1'),
    ).toBe(undeclared);
  });

  it('is refused when a descriptor declares one that is not a JSON type', () => {
    const text = postgresCodecDescriptorRegistry.descriptorFor('pg/text@1');
    const misdeclared = {
      descriptorKind: text?.descriptorKind,
      codecId: 'demo/misdeclared@1',
      traits: text?.traits,
      paramsSchema: undefined,
      isParameterized: false,
      factory: text?.factory.bind(text),
      projectJson: text?.projectJson.bind(text),
      jsonType: 'presenceOnly',
    };
    expect(() => buildPostgresCodecDescriptorRegistry([misdeclared])).toThrow(
      expect.objectContaining({ code: 'RUNTIME.CODEC_DESCRIPTOR_INVALID' }),
    );
  });
});
