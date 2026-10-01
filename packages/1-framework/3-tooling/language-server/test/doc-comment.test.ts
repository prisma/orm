import { ModelDeclarationAst, parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { readDocComment } from '../src/doc-comment';

function field(source: string) {
  const { document } = parse(source, 'language-server-test.psl');
  for (const declaration of document.declarations()) {
    if (declaration instanceof ModelDeclarationAst) {
      for (const candidate of declaration.fields()) return candidate;
    }
  }
  throw new Error('no field declaration in fixture');
}

describe('readDocComment', () => {
  it('joins consecutive /// lines', () => {
    const declaration = field('model User {\n  /// Line one.\n  /// Line two.\n  id Int\n}');
    expect(readDocComment(declaration.syntax)).toBe('Line one.\nLine two.');
  });

  it('strips /// and one following space only', () => {
    const declaration = field('model User {\n  ///  two leading spaces\n  id Int\n}');
    expect(readDocComment(declaration.syntax)).toBe(' two leading spaces');
  });

  it('keeps only the lines below a blank-line break', () => {
    const declaration = field('model User {\n  /// excluded\n\n  /// kept\n  id Int\n}');
    expect(readDocComment(declaration.syntax)).toBe('kept');
  });

  it('keeps only the lines below a // line break', () => {
    const declaration = field('model User {\n  // not a doc comment\n  /// kept\n  id Int\n}');
    expect(readDocComment(declaration.syntax)).toBe('kept');
  });

  it('returns undefined when there is no /// comment', () => {
    const declaration = field('model User {\n  id Int\n}');
    expect(readDocComment(declaration.syntax)).toBeUndefined();
  });
});
