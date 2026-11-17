import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import { expect, it } from 'vitest';
import { sqlFamilyPslBlockDescriptors } from '../src/core/authoring-entity-types';

it('documents the enum block', () => {
  const block: AuthoringPslBlockDescriptor = sqlFamilyPslBlockDescriptors.enum;
  expect(block.documentation).toEqual(expect.stringMatching(/enum/i));
});
