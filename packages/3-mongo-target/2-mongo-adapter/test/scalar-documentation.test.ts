import { describe, expect, it } from 'vitest';
import { mongoScalarAuthoringTypes } from '../src/exports/control';

describe('scalar documentation', () => {
  it.each(Object.entries(mongoScalarAuthoringTypes))('documents %s', (_name, descriptor) => {
    expect(descriptor).toHaveProperty('documentation', expect.stringMatching(/\S.+/));
  });
});
