import { describe, expect, it } from 'vitest';
import { postgresAuthoringTypes } from '../src/core/control-mutation-defaults';

describe('scalar documentation', () => {
  it.each(Object.entries(postgresAuthoringTypes))('documents %s', (_name, descriptor) => {
    expect(descriptor).toHaveProperty('documentation', expect.stringMatching(/\S.+/));
  });
});
