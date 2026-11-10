import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { pgInetDescriptor, pgNumericDescriptor, pgUuidDescriptor } from '../src/core/codecs';
import { fromContractJson, toContractJson } from './contract-json';

const ctx: CodecInstanceContext = { name: 'decode-json-forms' };

describe('pg/uuid@1 toDataTypeValue', () => {
  it('writes a UUID in the form PostgreSQL writes, which its data type reads', () => {
    const codec = pgUuidDescriptor.factory()(ctx);
    const written = [
      'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
      '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
      'a0eebc999c0b4ef8bb6d6bb9bd380a11',
    ].map((value) => toContractJson(codec, value));
    expect(written.map((json) => fromContractJson(codec, json))).toEqual([
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    ]);
  });
});

describe('pg/inet@1 toDataTypeValue', () => {
  it('writes an address in the form PostgreSQL writes, which its data type reads', () => {
    const codec = pgInetDescriptor.factory()(ctx);
    const written = ['10.0.0.1/32', '::FFFF:10.0.0.1', '2001:0DB8:0:0:0:0:0:1/64'].map((value) =>
      toContractJson(codec, value),
    );
    expect(written.map((json) => fromContractJson(codec, json))).toEqual([
      '10.0.0.1',
      '::ffff:10.0.0.1',
      '2001:db8::1/64',
    ]);
  });

  it('refuses text that is not an address, which its data type does not store', () => {
    const codec = pgInetDescriptor.factory()(ctx);
    expect(() => codec.toDataTypeValue('not an address')).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.DECODE_FAILED',
        meta: expect.objectContaining({ dataType: 'pg/inet' }),
      }),
    );
  });
});

describe('pg/numeric@1 toDataTypeValue', () => {
  it('writes a decimal numeral as PostgreSQL prints it, which its data type reads', () => {
    const codec = pgNumericDescriptor.factory({})(ctx);
    const written = ['01.5', '-0', '-0.00', '00', '-007.50', '1.50', 'NaN', '-Infinity'].map(
      (value) => toContractJson(codec, value),
    );
    expect(written.map((json) => fromContractJson(codec, json))).toEqual([
      '1.5',
      '0',
      '0.00',
      '0',
      '-7.50',
      '1.50',
      'NaN',
      '-Infinity',
    ]);
  });
});
