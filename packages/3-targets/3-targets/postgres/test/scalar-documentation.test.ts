import { expect, it } from 'vitest';
import { postgresAuthoringTypes } from '../src/core/authoring';

it.each(['BigIntNumber', 'UnboundedInt'] as const)('documents %s', (name) => {
  expect(postgresAuthoringTypes[name]).toHaveProperty(
    'documentation',
    expect.stringMatching(/\S.+/),
  );
});
