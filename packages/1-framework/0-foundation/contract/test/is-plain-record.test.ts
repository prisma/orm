import { describe, expect, it } from 'vitest';
import { isPlainRecord } from '../src/is-plain-record';

class Node {
  readonly name = 'node';
}

describe('isPlainRecord', () => {
  it('accepts object literals and objects without a prototype', () => {
    expect([{ a: 1 }, Object.create(null)].map(isPlainRecord)).toEqual([true, true]);
  });

  it('rejects null, primitives, arrays and class instances', () => {
    expect([null, undefined, 'a', 1, [], new Node(), new Date()].map(isPlainRecord)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
