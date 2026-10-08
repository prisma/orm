import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { pgInetDescriptor, pgNumericDescriptor, pgUuidDescriptor } from '../src/core/codecs';

const ctx: CodecInstanceContext = { name: 'decode-json-forms' };

describe('pg/uuid@1 encodeJson', () => {
  it('writes a UUID in the form PostgreSQL writes, which decodeJson reads', () => {
    const codec = pgUuidDescriptor.factory()(ctx);
    const written = [
      'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
      '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
      'a0eebc999c0b4ef8bb6d6bb9bd380a11',
    ].map((value) => codec.encodeJson(value));
    expect(written.map((json) => codec.decodeJson(json))).toEqual([
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    ]);
  });
});

describe('pg/inet@1 encodeJson', () => {
  it('writes an address in the form PostgreSQL writes, which decodeJson reads', () => {
    const codec = pgInetDescriptor.factory()(ctx);
    const written = ['10.0.0.1/32', '::FFFF:10.0.0.1', '2001:0DB8:0:0:0:0:0:1/64'].map((value) =>
      codec.encodeJson(value),
    );
    expect(written.map((json) => codec.decodeJson(json))).toEqual([
      '10.0.0.1',
      '::ffff:10.0.0.1',
      '2001:db8::1/64',
    ]);
  });

  it('keeps text that is not an address, which decodeJson refuses', () => {
    const codec = pgInetDescriptor.factory()(ctx);
    expect(codec.encodeJson('not an address')).toBe('not an address');
  });
});

describe('pg/numeric@1 encodeJson', () => {
  it('writes a decimal numeral as PostgreSQL prints it, which decodeJson reads', () => {
    const codec = pgNumericDescriptor.factory({})(ctx);
    const written = ['01.5', '-0', '-0.00', '00', '-007.50', '1.50', 'NaN', '-Infinity'].map(
      (value) => codec.encodeJson(value),
    );
    expect(written.map((json) => codec.decodeJson(json))).toEqual([
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
