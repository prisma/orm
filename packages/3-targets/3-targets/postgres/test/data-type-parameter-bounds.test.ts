import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

/** Each data type parameter's bound, checked at its edges on every codec that takes it. */
const BOUNDS: ReadonlyArray<
  readonly [
    string,
    readonly Readonly<Record<string, unknown>>[],
    readonly Readonly<Record<string, unknown>>[],
  ]
> = [
  [
    'pg/numeric',
    [
      {},
      { precision: 1 },
      { precision: 1000 },
      { precision: 10, scale: -1000 },
      { precision: 10, scale: 1000 },
    ],
    [
      { precision: 0 },
      { precision: 1001 },
      { precision: 1.5 },
      { precision: 10, scale: -1001 },
      { precision: 10, scale: 1001 },
      { scale: 2 },
    ],
  ],
  [
    'pg/char',
    [{}, { length: 1 }, { length: 10485760 }],
    [{ length: 0 }, { length: 10485761 }, { length: 1.5 }],
  ],
  [
    'pg/varchar',
    [{}, { length: 1 }, { length: 10485760 }],
    [{ length: 0 }, { length: 10485761 }, { length: 1.5 }],
  ],
  ['pg/bit', [{}, { length: 1 }, { length: 83886080 }], [{ length: 0 }, { length: 83886081 }]],
  ['pg/varbit', [{}, { length: 1 }, { length: 83886080 }], [{ length: 0 }, { length: 83886081 }]],
  ...(['pg/time', 'pg/timetz', 'pg/timestamp', 'pg/timestamptz', 'pg/interval'] as const).map(
    (id) =>
      [
        id,
        [{}, { precision: 0 }, { precision: 6 }],
        [{ precision: -1 }, { precision: 7 }, { precision: 1.5 }],
      ] as const,
  ),
  ['pg/enum', [{ typeName: 'mood' }], [{}, { typeName: '' }, { typeName: 3 }]],
];

function accepts(descriptor: AnyCodecDescriptor, params: Readonly<Record<string, unknown>>) {
  const result = descriptor.paramsSchema?.['~standard'].validate(params);
  if (result === undefined || result instanceof Promise) {
    throw new Error(`${descriptor.codecId} has no synchronous parameter schema`);
  }
  return result.issues === undefined;
}

const cases = BOUNDS.flatMap(([dataType, accepted, refused]) =>
  codecDescriptors
    .filter((descriptor) => descriptor.dataType === dataType)
    .map((descriptor) => [descriptor.codecId, descriptor, accepted, refused] as const),
);

describe('the parameter bounds of every Postgres codec', () => {
  it('covers every codec of a data type with parameters', () => {
    expect(cases.map(([codecId]) => codecId).sort()).toEqual(
      codecDescriptors
        .filter((descriptor) => descriptor.paramsSchema !== undefined)
        .map((descriptor) => descriptor.codecId)
        .sort(),
    );
  });

  it.each(cases)('%s accepts the edges of its bounds', (_codecId, descriptor, accepted) => {
    expect(accepted.filter((params) => !accepts(descriptor, params))).toEqual([]);
  });

  it.each(cases)('%s refuses what lies past them', (_codecId, descriptor, _accepted, refused) => {
    expect(refused.filter((params) => accepts(descriptor, params))).toEqual([]);
  });
});
