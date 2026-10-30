import { describe, expect, it } from 'vitest';
import mongoRuntimeAdapterDescriptor from '../src/exports/runtime';

describe('the generators the Mongo runtime adapter registers', () => {
  it('are timestampNow and a now generator for each date and time codec, one value per operation', () => {
    expect(
      mongoRuntimeAdapterDescriptor
        .mutationDefaultGenerators()
        .map(({ id, stability }) => [id, stability]),
    ).toEqual([
      ['timestampNow', 'query'],
      ['instantNow', 'query'],
      ['plainDateNow', 'query'],
      ['plainTimeNow', 'query'],
      ['instantStringNow', 'query'],
      ['dateStringNow', 'query'],
      ['timeStringNow', 'query'],
    ]);
  });

  it('generate the values their codecs write, the ones that need no Temporal among them', () => {
    const generators = mongoRuntimeAdapterDescriptor.mutationDefaultGenerators();
    const generated = Object.fromEntries(
      ['timestampNow', 'dateStringNow', 'timeStringNow'].map((id) => [
        id,
        generators.find((generator) => generator.id === id)?.generate(),
      ]),
    );
    expect({
      timestampNow: generated['timestampNow'] instanceof Date,
      dateStringNow: generated['dateStringNow'],
      timeStringNow: generated['timeStringNow'],
    }).toEqual({
      timestampNow: true,
      dateStringNow: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      timeStringNow: expect.stringMatching(/^\d{2}:\d{2}:\d{2}\.\d{3}$/),
    });
  });
});
