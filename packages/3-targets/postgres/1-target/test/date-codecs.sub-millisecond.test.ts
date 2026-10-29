import { describe, expect, it } from 'vitest';
import { pgTimestamp, pgTimestamptz } from '../src/core/data-types';
import { pgTimestampDateDescriptor, pgTimestamptzDateDescriptor } from '../src/core/date-codecs';

const instance = { name: 'test' };
const timestamptzDate = pgTimestamptzDateDescriptor.factory({ precision: 6 })(instance);
const timestampDate = pgTimestampDateDescriptor.factory({ precision: 6 })(instance);

describe('the Date codecs and digits below a millisecond', () => {
  it('refuse a stored value with them, naming the types that hold it', () => {
    expect(() =>
      timestamptzDate.fromDataTypeValue(
        pgTimestamptz.valueFrom('2024-01-01T01:00:00.123456Z', { precision: 6 }),
      ),
    ).toThrow(/2024-01-01T01:00:00\.123456Z[\s\S]*TimestamptzString[\s\S]*TimestamptzTemporal/);
    expect(() =>
      timestampDate.fromDataTypeValue(
        pgTimestamp.valueFrom('2024-01-01T01:00:00.123456', { precision: 6 }),
      ),
    ).toThrow(/2024-01-01T01:00:00\.123456[\s\S]*TimestampString[\s\S]*TimestampInstant/);
  });

  it('take a stored value at a millisecond', () => {
    expect([
      timestamptzDate.fromDataTypeValue(
        pgTimestamptz.valueFrom('2024-01-01T01:00:00.123Z', { precision: 6 }),
      ),
      timestampDate.fromDataTypeValue(
        pgTimestamp.valueFrom('2024-01-01T01:00:00.12', { precision: 6 }),
      ),
    ]).toEqual([new Date('2024-01-01T01:00:00.123Z'), new Date('2024-01-01T01:00:00.120Z')]);
  });

  it('read a row with them as the Date at the millisecond', async () => {
    expect([
      await timestamptzDate.fromWire('2024-01-01 01:00:00.123456+00', {}),
      await timestampDate.fromWire('2024-01-01 01:00:00.123456', {}),
    ]).toEqual([new Date('2024-01-01T01:00:00.123Z'), new Date('2024-01-01T01:00:00.123Z')]);
  });
});
