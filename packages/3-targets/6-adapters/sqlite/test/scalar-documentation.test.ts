import { describe, expect, it } from 'vitest';
import { sqliteScalarAuthoringTypes } from '../src/core/control-mutation-defaults';

describe('scalar documentation', () => {
  it.each(Object.entries(sqliteScalarAuthoringTypes))('documents %s', (_name, descriptor) => {
    expect(descriptor).toHaveProperty('documentation', expect.stringMatching(/\S.+/));
  });
});
