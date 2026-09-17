import { expect, it } from 'vitest';
import { sqliteAuthoringTypes } from '../src/core/authoring';

it('documents BigIntNumber', () => {
  expect(sqliteAuthoringTypes.BigIntNumber).toHaveProperty(
    'documentation',
    expect.stringMatching(/\S.+/),
  );
});
