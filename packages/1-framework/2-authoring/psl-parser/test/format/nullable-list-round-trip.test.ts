import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

const lone = (type: string): string => `model M {\n  x ${type}\n}\n`;

describe('format round-trips every scalar-list nullability spelling verbatim', () => {
  it('leaves a non-null scalar unchanged', () => {
    expect(format(lone('String'))).toEqual(lone('String'));
  });

  it('leaves an optional scalar unchanged', () => {
    expect(format(lone('String?'))).toEqual(lone('String?'));
  });

  it('leaves a list unchanged', () => {
    expect(format(lone('String[]'))).toEqual(lone('String[]'));
  });

  it('leaves an element-nullable list unchanged (leading ?)', () => {
    expect(format(lone('String?[]'))).toEqual(lone('String?[]'));
  });

  it('leaves a nullable list unchanged (trailing ?)', () => {
    expect(format(lone('String[]?'))).toEqual(lone('String[]?'));
  });

  it('leaves a both-nullable list unchanged (leading and trailing ?)', () => {
    expect(format(lone('String?[]?'))).toEqual(lone('String?[]?'));
  });
});

describe('format and the absence of a type annotation', () => {
  // A prior dispatch made `parseTypeAnnotation` return void, so a member with
  // no type emits no `TypeAnnotation` node (previously a zero-width one). A
  // named type with no base type is the only diagnostic-free no-type member;
  // it must round-trip without a stray column or trailing space.
  it('round-trips a named type that has no base type', () => {
    const source = 'types {\n  Foo = String\n  Bar =\n}\n';
    expect(format(source)).toEqual(source);
  });

  // Model and composite-type fields require a type, so a no-type field is a
  // parse diagnostic rather than valid printer input — documented here so the
  // boundary is explicit.
  it('rejects a model field written without a type', () => {
    expect(() => format('model M {\n  id\n}\n')).toThrow('Cannot format PSL with parse errors');
  });
});
