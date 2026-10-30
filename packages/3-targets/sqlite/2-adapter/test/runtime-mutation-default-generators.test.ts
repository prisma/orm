import { describe, expect, it } from 'vitest';
import runtimeAdapterDescriptor from '../src/exports/runtime';

const generators = runtimeAdapterDescriptor.mutationDefaultGenerators?.() ?? [];

describe('the SQLite runtime mutation default generators', () => {
  it('register a now() generator for every date and time codec, each once per query', () => {
    expect(
      generators
        .filter(({ id }) => id.endsWith('Now'))
        .map(({ id, stability }) => ({ id, stability })),
    ).toEqual([
      { id: 'timestampNow', stability: 'query' },
      { id: 'instantNow', stability: 'query' },
      { id: 'plainDateNow', stability: 'query' },
      { id: 'plainTimeNow', stability: 'query' },
      { id: 'timestamptzStringNow', stability: 'query' },
      { id: 'dateStringNow', stability: 'query' },
      { id: 'timeStringNow', stability: 'query' },
    ]);
  });

  it('generate the text the string types store', () => {
    const generate = (id: string) => generators.find((entry) => entry.id === id)?.generate();
    expect({
      instant: generate('timestamptzStringNow'),
      date: generate('dateStringNow'),
      time: generate('timeStringNow'),
    }).toEqual({
      instant: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      time: expect.stringMatching(/^\d{2}:\d{2}:\d{2}\.\d{3}$/),
    });
  });
});
