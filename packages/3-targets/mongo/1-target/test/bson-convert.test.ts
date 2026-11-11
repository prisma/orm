import { describe, expect, it } from 'vitest';
import { castsFrom } from '../src/core/migrations/bson-convert';

const TYPES = ['double', 'string', 'objectId', 'bool', 'date', 'int', 'long', 'decimal'] as const;

describe('castsFrom', () => {
  it("casts only where $convert's result is what casting the value means", () => {
    const casts = TYPES.flatMap((to) =>
      TYPES.filter((from) => from !== to && castsFrom(from, to)).map((from) => `${from} to ${to}`),
    );

    expect(casts).toEqual([
      'string to double',
      'int to double',
      'long to double',
      'decimal to double',
      'double to string',
      'objectId to string',
      'bool to string',
      'date to string',
      'int to string',
      'long to string',
      'decimal to string',
      'string to objectId',
      'double to bool',
      'int to bool',
      'long to bool',
      'decimal to bool',
      'string to date',
      'double to int',
      'string to int',
      'long to int',
      'decimal to int',
      'double to long',
      'string to long',
      'int to long',
      'decimal to long',
      'double to decimal',
      'string to decimal',
      'int to decimal',
      'long to decimal',
    ]);
  });

  it('leaves off the pairs $convert accepts whose result is not what the value meant', () => {
    expect(
      [
        ['bool', 'double'],
        ['date', 'double'],
        ['string', 'bool'],
        ['objectId', 'bool'],
        ['date', 'bool'],
        ['double', 'date'],
        ['long', 'date'],
        ['decimal', 'date'],
        ['objectId', 'date'],
        ['bool', 'int'],
        ['bool', 'long'],
        ['date', 'long'],
        ['bool', 'decimal'],
        ['date', 'decimal'],
      ].filter(([from, to]) => castsFrom(from ?? '', to ?? '')),
    ).toEqual([]);
  });
});
