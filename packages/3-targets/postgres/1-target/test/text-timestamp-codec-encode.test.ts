import { describe, expect, it } from 'vitest';
import {
  pgTimestampStringDescriptor,
  pgTimestamptzStringDescriptor,
} from '../src/core/temporal-string-codecs';

const wrongTyped = (value: unknown): never => value as never;

describe.each([
  { descriptor: pgTimestampStringDescriptor, text: '2024-01-02T03:04:05.678' },
  { descriptor: pgTimestamptzStringDescriptor, text: '2024-01-02T03:04:05.678Z' },
])('$descriptor.codecId encode', ({ descriptor, text }) => {
  const codec = descriptor.factory({})({ name: '<test>' });
  const codecId = descriptor.codecId;

  it('passes text through', async () => {
    expect(await codec.toWire(text, {})).toBe(text);
  });

  it.each([
    ['a Date', new Date('2024-01-02T03:04:05.678Z')],
    ['a number', 1_704_164_645_678],
    ['null', null],
  ])('refuses %s', async (received, value) => {
    await expect(codec.toWire(wrongTyped(value), {})).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message: `Codec '${codecId}' writes ISO 8601 text, but received ${received}.`,
      meta: { codecId, received },
    });
  });
});
