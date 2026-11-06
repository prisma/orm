import { describe, expect, it } from 'vitest';
import { parse } from '../../src/parse';
import {
  CompositeTypeDeclarationAst,
  type DeclarationAst,
  type FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  type NamedTypeDeclarationAst,
  TypesBlockAst,
} from '../../src/syntax/ast/declarations';

function declarations(source: string): Iterable<DeclarationAst> {
  return parse(source, 'psl-parser-test.psl').document.declarations();
}

function model(source: string): ModelDeclarationAst {
  for (const declaration of declarations(source)) {
    if (declaration instanceof ModelDeclarationAst) return declaration;
  }
  throw new Error('no model declaration in fixture');
}

function compositeType(source: string): CompositeTypeDeclarationAst {
  for (const declaration of declarations(source)) {
    if (declaration instanceof CompositeTypeDeclarationAst) return declaration;
  }
  throw new Error('no composite-type declaration in fixture');
}

function genericBlock(source: string): GenericBlockDeclarationAst {
  for (const declaration of declarations(source)) {
    if (declaration instanceof GenericBlockDeclarationAst) return declaration;
  }
  throw new Error('no generic-block declaration in fixture');
}

function field(source: string): FieldDeclarationAst {
  const declaration = model(source);
  for (const candidate of declaration.fields()) return candidate;
  throw new Error('no field declaration in fixture');
}

function namedType(source: string): NamedTypeDeclarationAst {
  for (const declaration of declarations(source)) {
    if (declaration instanceof TypesBlockAst) {
      for (const candidate of declaration.declarations()) return candidate;
    }
  }
  throw new Error('no named-type declaration in fixture');
}

describe('docComment', () => {
  it('reads a model declaration', () => {
    expect(model('/// A user.\nmodel User {\n  id Int\n}').docComment()).toBe('A user.');
  });

  it('reads a composite-type declaration', () => {
    expect(compositeType('/// An address.\ntype Address {\n  street String\n}').docComment()).toBe(
      'An address.',
    );
  });

  it('reads a field declaration', () => {
    expect(field('model User {\n  /// The primary key.\n  id Int\n}').docComment()).toBe(
      'The primary key.',
    );
  });

  it('reads a named-type declaration', () => {
    expect(namedType('types {\n  /// A short string.\n  Short = String\n}').docComment()).toBe(
      'A short string.',
    );
  });

  it('reads a generic-block declaration', () => {
    expect(genericBlock('/// Owner-only access.\npolicy ReadOwn {\n}').docComment()).toBe(
      'Owner-only access.',
    );
  });

  it('joins consecutive /// lines', () => {
    const declaration = field('model User {\n  /// Line one.\n  /// Line two.\n  id Int\n}');
    expect(declaration.docComment()).toBe('Line one.\nLine two.');
  });

  it('strips /// and one following space only', () => {
    const declaration = field('model User {\n  ///  two leading spaces\n  id Int\n}');
    expect(declaration.docComment()).toBe(' two leading spaces');
  });

  it('keeps only the lines below a blank-line break', () => {
    const declaration = field('model User {\n  /// excluded\n\n  /// kept\n  id Int\n}');
    expect(declaration.docComment()).toBe('kept');
  });

  it('keeps only the lines below a // line break', () => {
    const declaration = field('model User {\n  // not a doc comment\n  /// kept\n  id Int\n}');
    expect(declaration.docComment()).toBe('kept');
  });

  it('returns a bare /// as an empty string', () => {
    const declaration = field('model User {\n  ///\n  id Int\n}');
    expect(declaration.docComment()).toBe('');
  });

  it('returns undefined when there is no /// comment', () => {
    const declaration = field('model User {\n  id Int\n}');
    expect(declaration.docComment()).toBeUndefined();
  });
});
