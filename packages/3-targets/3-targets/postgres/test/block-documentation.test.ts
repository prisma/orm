import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringPslBlockDescriptors } from '../src/core/authoring';

describe('PostgreSQL block documentation', () => {
  for (const descriptor of Object.values(postgresAuthoringPslBlockDescriptors)) {
    it(`documents ${descriptor.keyword} and its parameters`, () => {
      const block: AuthoringPslBlockDescriptor = descriptor;
      expect(block.documentation).toEqual(expect.stringMatching(/\S/));
      for (const parameter of Object.values(block.parameters)) {
        expect(parameter.documentation).toEqual(expect.stringMatching(/\S/));
      }
    });
  }
});
