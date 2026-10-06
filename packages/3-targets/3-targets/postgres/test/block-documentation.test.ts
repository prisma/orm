import { blockSpecFactoryOf, buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringPslBlockDescriptors } from '../src/core/authoring';

function specContext() {
  const { document, sources } = parse('', 'block-documentation.test.psl');
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  return { symbols: symbolTable };
}

describe('PostgreSQL block documentation', () => {
  const ctx = specContext();
  for (const descriptor of Object.values(postgresAuthoringPslBlockDescriptors)) {
    it(`documents ${descriptor.keyword} and its keys`, () => {
      expect(descriptor.documentation).toEqual(expect.stringMatching(/\S/));
      const spec = blockSpecFactoryOf(descriptor)(ctx);
      if (spec.mode === 'struct') {
        for (const parameter of Object.values(spec.parameters)) {
          expect(parameter.documentation).toEqual(expect.stringMatching(/\S/));
        }
      } else {
        expect(spec.value.documentation).toEqual(expect.stringMatching(/\S/));
      }
    });
  }
});
