import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mysqlNowGenerators } from '../src/core/date-time-now-generators';
import {
  mysqlGeneratorDescriptors,
  mysqlGeneratorFunctions,
  mysqlNowGeneratorIds,
} from '../src/core/generator-functions';
import { mysqlCodecRegistry } from '../src/core/registry';

type Generate = (params?: Readonly<Record<string, unknown>>) => unknown;

const generate: Readonly<Record<string, Generate>> = {
  [TIMESTAMP_NOW_GENERATOR_ID]: (params) => timestampNowRuntimeGenerator().generate(params),
  ...Object.fromEntries(mysqlNowGenerators.map(({ id, generate }) => [id, generate])),
};

function codecFor(codecId: string) {
  const descriptor = mysqlCodecRegistry.descriptorFor(codecId);
  if (descriptor === undefined) throw new Error(`no registered codec for '${codecId}'`);
  return descriptor.factory({ precision: 6 })({ name: '<test>' });
}

const nowFunction = mysqlGeneratorFunctions.find(({ name }) => name === 'now');

function nowBindingFor(codecId: string, typeParams?: Record<string, unknown>) {
  const binding = nowFunction?.bindings.find(({ codecIds }) => codecIds.includes(codecId));
  const field = { codecId, typeParams, length: undefined };
  const resolved = binding?.resolve({ args: {}, field });
  return resolved?.ok === true ? resolved.generator : undefined;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the MySQL "now" generator for each codec', () => {
  it('pairs each date and time codec with its generator', () => {
    expect(mysqlNowGeneratorIds).toEqual({
      'mysql/datetime@1': 'timestampNow',
      'mysql/datetime-temporal@1': 'instantNow',
      'mysql/datetime-string@1': 'instantStringNow',
      'mysql/timestamp-date@1': 'timestampNow',
      'mysql/timestamp-temporal@1': 'instantNow',
      'mysql/timestamp-string@1': 'instantStringNow',
      'mysql/date-string@1': 'dateStringNow',
      'mysql/date-temporal@1': 'plainDateNow',
      'mysql/time-string@1': 'timeStringNow',
      'mysql/time-temporal@1': 'plainTimeNow',
    });
  });

  it('declares every generator it binds to the control plane', () => {
    expect(mysqlGeneratorDescriptors.map(({ id }) => id).sort()).toEqual(
      [...new Set(Object.values(mysqlNowGeneratorIds))].sort(),
    );
  });

  it('hands the column precision to a generator, and 0, the precision MySQL gives a bare type, when the column has none', () => {
    expect([
      nowBindingFor('mysql/datetime-string@1', { precision: 3 }),
      nowBindingFor('mysql/time-temporal@1'),
      nowBindingFor('mysql/date-string@1'),
    ]).toEqual([
      { kind: 'generator', id: 'instantStringNow', params: { precision: 3 } },
      { kind: 'generator', id: 'plainTimeNow', params: { precision: 0 } },
      { kind: 'generator', id: 'dateStringNow' },
    ]);
  });

  it('hands a precision below 3 to timestampNow, and none at 3 or more, so a bare DateTime keeps its contract', () => {
    expect([
      nowBindingFor('mysql/datetime@1', { precision: 3 }),
      nowBindingFor('mysql/datetime@1', { precision: 6 }),
      nowBindingFor('mysql/timestamp-date@1', { precision: 0 }),
      nowBindingFor('mysql/datetime@1'),
      nowBindingFor('mysql/timestamp-date@1', { precision: 2 }),
    ]).toEqual([
      { kind: 'generator', id: 'timestampNow' },
      { kind: 'generator', id: 'timestampNow' },
      { kind: 'generator', id: 'timestampNow', params: { precision: 0 } },
      { kind: 'generator', id: 'timestampNow', params: { precision: 0 } },
      { kind: 'generator', id: 'timestampNow', params: { precision: 2 } },
    ]);
  });

  it.each(Object.entries(mysqlNowGeneratorIds))(
    'generates a value %s writes',
    async (codecId, generatorId) => {
      const value = generate[generatorId]?.({ precision: 6 });
      expect(typeof (await codecFor(codecId).toWire(value, {}))).toBe('string');
    },
  );

  it('round down to the column precision, so MySQL stores the value as written rather than rounding it up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-29T23:59:59.987Z'));
    const at = (id: string, precision: number) => String(generate[id]?.({ precision }));
    expect({
      instant0: at('instantNow', 0),
      instant2: at('instantNow', 2),
      text1: at('instantStringNow', 1),
      clock0: at('plainTimeNow', 0),
      clockText3: at('timeStringNow', 3),
      day: at('dateStringNow', 0),
      plainDay: at('plainDateNow', 0),
    }).toEqual({
      instant0: '2024-02-29T23:59:59Z',
      instant2: '2024-02-29T23:59:59.98Z',
      text1: '2024-02-29T23:59:59.9Z',
      clock0: '23:59:59',
      clockText3: '23:59:59.987',
      day: '2024-02-29',
      plainDay: '2024-02-29',
    });
  });
});
