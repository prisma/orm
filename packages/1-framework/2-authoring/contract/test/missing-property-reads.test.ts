import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { answerMissingPropertyReads } from '../src/missing-property-reads';

function guarded() {
  const reads: string[] = [];
  const helpers = answerMissingPropertyReads(
    { column: () => 'column' },
    new Set(['text', 'column']),
    (name) => {
      reads.push(name);
      throw new Error(`no ${name}`);
    },
  );
  return { helpers, reads };
}

describe('answerMissingPropertyReads', () => {
  it('answers a read of a name it is given that the object does not have', () => {
    const { helpers } = guarded();
    expect(() => Reflect.get(helpers, 'text')).toThrow('no text');
  });

  it('reads every other name as on the object', () => {
    const { helpers, reads } = guarded();
    expect([
      helpers.column(),
      Reflect.get(helpers, 'length'),
      Reflect.get(helpers, 'name'),
      Reflect.get(helpers, 'default'),
      Reflect.get(helpers, 'colum'),
      Reflect.get(helpers, 'then'),
      Reflect.get(helpers, 'toJSON'),
      Reflect.get(helpers, Symbol.iterator),
    ]).toEqual([
      'column',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(reads).toEqual([]);
  });

  it('leaves the object plain: its prototype, keys, copies and inspection', () => {
    const { helpers, reads } = guarded();
    expect([
      Object.getPrototypeOf(helpers) === Object.prototype,
      Object.keys(helpers),
      'column' in helpers,
      'text' in helpers,
      Array.from(Object(helpers)),
      Object.keys({ ...helpers }),
      String(helpers),
      JSON.stringify(helpers),
      inspect(helpers),
    ]).toEqual([
      true,
      ['column'],
      true,
      false,
      [],
      ['column'],
      '[object Object]',
      '{}',
      '{ column: [Function: column] }',
    ]);
    expect(reads).toEqual([]);
  });

  it('can be awaited and compared', async () => {
    const { helpers, reads } = guarded();
    expect(await Promise.resolve(helpers)).toBe(helpers);
    expect(helpers).toEqual(helpers);
    expect(helpers).toHaveProperty('column');
    expect(reads).toEqual([]);
  });
});
