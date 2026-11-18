import { describe, expect, it } from 'vitest';
import runtimeAdapterDescriptor from '../src/core/runtime/runtime-adapter';

const generators = runtimeAdapterDescriptor.mutationDefaultGenerators?.() ?? [];
const generate = (id: string, params?: Record<string, unknown>) =>
  generators.find((entry) => entry.id === id)?.generate(params);

describe('the MySQL runtime mutation default generators', () => {
  it('register a now() generator for every date and time codec, each once per query', () => {
    expect(generators.map(({ id, stability }) => ({ id, stability }))).toEqual([
      { id: 'timestampNow', stability: 'query' },
      { id: 'instantNow', stability: 'query' },
      { id: 'plainDateNow', stability: 'query' },
      { id: 'plainTimeNow', stability: 'query' },
      { id: 'instantStringNow', stability: 'query' },
      { id: 'dateStringNow', stability: 'query' },
      { id: 'timeStringNow', stability: 'query' },
    ]);
  });

  it('generate the text the string types read, at the precision they are given', () => {
    expect({
      instant: generate('instantStringNow', { precision: 0 }),
      date: generate('dateStringNow'),
      time: generate('timeStringNow', { precision: 0 }),
    }).toEqual({
      instant: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      time: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/),
    });
  });
});
