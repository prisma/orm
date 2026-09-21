import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { ModelDeclarationAst } from '../src/syntax/ast/declarations';

function firstModel(source: string) {
  const result = parse(source, 'test.psl');
  const model = Array.from(result.document.declarations()).find(
    (declaration) => declaration instanceof ModelDeclarationAst,
  );
  if (!(model instanceof ModelDeclarationAst)) {
    throw new Error('fixture has no model');
  }
  return { result, model };
}

describe('PslSources', () => {
  it('finds the source file for the registered root and descendants', () => {
    const { result, model } = firstModel('model User {\n  id Int\n}');

    expect(result.sources.sourceFileFor(result.document.syntax).filename).toBe('test.psl');
    expect(result.sources.sourceFileFor(model.syntax)).toBe(
      result.sources.sourceFileFor(result.document.syntax),
    );
  });

  it('rejects an unregistered root from an equal-content parse', () => {
    const first = parse('model User {\n  id Int\n}', 'first.psl');
    const second = parse('model User {\n  id Int\n}', 'second.psl');

    expect(() => first.sources.sourceFileFor(second.document.syntax)).toThrow(
      'No SourceFile registered for PSL syntax root',
    );
  });

  it('rejects a detached registry with no singleton fallback', () => {
    const { result } = firstModel('model User {\n  id Int\n}');
    const emptySources = new PslSources([]);

    expect(() => emptySources.sourceFileFor(result.document.syntax)).toThrow(
      'No SourceFile registered for PSL syntax root',
    );
  });
});
