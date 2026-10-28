import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import {
  CompositeTypeDeclarationAst,
  DocumentAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../src/syntax/ast/declarations';
import type { GreenElement } from '../src/syntax/green';
import { highlight, printTree } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function diagnosticFor(source: string, code: string) {
  const result = parse(source, 'test.psl');
  const diagnostic = result.diagnostics.find((d) => d.code === code);
  if (!diagnostic) {
    throw new Error(
      `expected a ${code} diagnostic for ${JSON.stringify(source)}, got [${result.diagnostics
        .map((d) => d.code)
        .join(', ')}]`,
    );
  }
  return { result, message: diagnostic.message, diagnostic };
}

describe('parse() syntactic diagnostics', () => {
  it('reports an unterminated block, anchored on the opening brace', () => {
    const source = 'model User {\n  id Int';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_UNTERMINATED_BLOCK');
    expect(message).toBe('Unterminated block declaration');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model User {
                 ~
        id Int
      "
    `);
    expect(result.document).toBeInstanceOf(DocumentAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('commits a bare non-reserved identifier to a malformed custom declaration', () => {
    const source = 'oops';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "oops" block');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      oops
          ~
      "
    `);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(GenericBlockDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('commits a nameless model block to a typed node with a keyword-anchored diagnostic', () => {
    const source = 'model {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model {
      ~~~~~
      }
      "
    `);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a stray invalid character as an unsupported top-level declaration', () => {
    const source = '§';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
    );
    expect(message).toBe('Unsupported top-level declaration "§"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      §
      ~
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a recursive namespace block with the inner namespace name', () => {
    const source = 'namespace outer {\nnamespace inner {\n}\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      'Recursive "namespace inner" block is not allowed; namespace blocks may not nest',
    );
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      namespace outer {
      namespace inner {
      ~~~~~~~~~
      }
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a reserved namespace name', () => {
    const source = 'namespace __unspecified__ {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      'Namespace name "__unspecified__" is reserved for the parser-synthesised bucket for top-level declarations',
    );
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      namespace __unspecified__ {
                ~~~~~~~~~~~~~~~
      }
      "
    `);
  });

  it('reports a types block nested inside a namespace', () => {
    const source = 'namespace outer {\ntypes {\n}\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_NAMESPACE_BLOCK');
    expect(message).toBe(
      '`types` blocks must be declared at the document top level, not inside a namespace block',
    );
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      namespace outer {
      types {
      ~~~~~
      }
      }
      "
    `);
  });

  it('reports a malformed model member with the offending token', () => {
    const source = 'model M {\n  123\n  id Int\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_MODEL_MEMBER');
    expect(message).toBe('Invalid model member declaration "123"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model M {
        123
        ~~~
        id Int
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a model field missing its type, anchored on the field name', () => {
    const source = 'model Foo {\n  field\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_MODEL_MEMBER');
    expect(message).toBe('Expected a type after field "field"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model Foo {
        field
        ~~~~~
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('refuses a second type constructor call on one field', () => {
    const result = parse('model M {\n  f Timestamp(3) Timestamptz(3)\n}', 'test.psl');
    expect(result.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: 'PSL_INVALID_MODEL_MEMBER', message: 'Expected a type after field "Timestamptz"' },
      { code: 'PSL_INVALID_MODEL_MEMBER', message: 'Invalid model member declaration "("' },
    ]);
  });

  it('reports a composite-type field missing its type, anchored on the field name', () => {
    const source = 'type Foo {\n  field\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_MODEL_MEMBER');
    expect(message).toBe('Expected a type after field "field"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      type Foo {
        field
        ~~~~~
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a malformed types-block member with the offending token', () => {
    const source = 'types {\n  123\n  Ok = Int\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_TYPES_MEMBER');
    expect(message).toBe('Invalid types declaration "123"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      types {
        123
        ~~~
        Ok = Int
      }
      "
    `);
  });

  it('reports a malformed generic-block entry with implementer wording', () => {
    const source = 'datasource db {\n  123\n  provider = "x"\n}';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
    );
    expect(message).toBe('Invalid block entry');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      datasource db {
        123
        ~~~
        provider = "x"
      }
      "
    `);
  });

  it('treats a bare key followed by a stray value as a bare entry plus an invalid member', () => {
    const source = 'datasource db {\n  provider "x"\n}';
    const { result, message } = diagnosticFor(source, 'PSL_INVALID_EXTENSION_BLOCK_MEMBER');
    // `provider` (no `=`) is a valid bare entry; the trailing `"x"` is the
    // invalid member the diagnostic points at.
    expect(message).toBe('Invalid block entry');
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(GenericBlockDeclarationAst);
    if (decl instanceof GenericBlockDeclarationAst) {
      const entries = Array.from(decl.entries());
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key()?.token()?.text).toBe('provider');
      expect(entries[0]!.value()).toBeUndefined();
    }
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('accepts a bare generic-block key with no value as a bare-member entry', () => {
    const source = 'datasource db {\n  provider\n}';
    const result = parse(source, 'test.psl');
    // A bare key carries no value and is not a diagnostic: the domain-enum
    // member shape `enum Status { Active }` relies on this entry.
    expect(result.diagnostics).toEqual([]);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(GenericBlockDeclarationAst);
    if (decl instanceof GenericBlockDeclarationAst) {
      const entries = Array.from(decl.entries());
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key()?.token()?.text).toBe('provider');
      expect(entries[0]!.value()).toBeUndefined();
    }
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a types-block member missing its "=", anchored on the name', () => {
    const source = 'types {\n  UserId Int\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_TYPES_MEMBER');
    expect(message).toBe('Expected "=" after "UserId"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      types {
        UserId Int
        ~~~~~~
      }
      "
    `);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(TypesBlockAst);
    if (decl instanceof TypesBlockAst) {
      const named = Array.from(decl.declarations());
      expect(named).toHaveLength(1);
      expect(named[0]!.name()?.token()?.text).toBe('UserId');
    }
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a malformed `?` in a types-block member as a types diagnostic', () => {
    const source = 'types {\n  Foo = Bar??\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_TYPES_MEMBER');
    expect(message).toBe(
      'Unexpected "?"; a type may be optional (`Foo?`), a list (`Foo[]`), have nullable elements (`Foo?[]`), or both (`Foo?[]?`)',
    );
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      types {
        Foo = Bar??
                  ~
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports a malformed `?` in a model field as a model diagnostic', () => {
    const source = 'model M {\n  x Bar??\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_MODEL_MEMBER');
    expect(message).toBe(
      'Unexpected "?"; a type may be optional (`Foo?`), a list (`Foo[]`), have nullable elements (`Foo?[]`), or both (`Foo?[]?`)',
    );
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model M {
        x Bar??
              ~
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});

describe('parse() commits reserved declaration keywords on the keyword alone', () => {
  it('model with a missing name yields a typed node anchored on the keyword', () => {
    const source = 'model {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model {
      ~~~~~
      }
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('model with a missing brace yields a typed node and reports the brace', () => {
    const source = 'model User';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "model" block');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model User
                ~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare model keyword yields a typed node and reports the missing name', () => {
    const source = 'model';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "model"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model
      ~~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a nameless enum block parses as a nameless generic block with no parse diagnostic', () => {
    // `enum` is no longer a reserved native keyword: it routes through the
    // generic-block grammar, so a nameless `enum {}` is a structurally valid
    // generic block. Whether a name is required is a resolve-time descriptor
    // concern, not a parse-time one.
    const source = 'enum {\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([]);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(
      GenericBlockDeclarationAst,
    );
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('enum with a name but no brace reports the missing brace as a generic block', () => {
    const source = 'enum';
    const { result, message } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "enum" block');
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(
      GenericBlockDeclarationAst,
    );
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('namespace with a missing name yields a typed node', () => {
    const source = 'namespace {\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "namespace"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      namespace {
      ~~~~~~~~~
      }
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('namespace with a missing brace yields a typed node and reports the brace', () => {
    const source = 'namespace outer';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "namespace" block');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      namespace outer
                     ~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare namespace keyword yields a typed node and reports the missing name', () => {
    const source = 'namespace';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "namespace"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      namespace
      ~~~~~~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('type with a name but no brace yields a composite type and reports the brace', () => {
    const source = 'type Address';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "type" block');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      type Address
                  ~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(
      CompositeTypeDeclarationAst,
    );
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare type keyword yields a composite type and reports the missing name', () => {
    const source = 'type';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected a name after "type"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      type
      ~~~~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(
      CompositeTypeDeclarationAst,
    );
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('a bare types keyword yields a types block and reports the missing brace', () => {
    const source = 'types';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "types" block');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      types
           ~
      "
    `);
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(TypesBlockAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('keeps parsing later declarations after a malformed reserved header', () => {
    const source = 'model User\nmodel Order {\n}';
    const result = parse(source, 'test.psl');
    const diagnostic = result.diagnostics.find((d) => d.code === 'PSL_INVALID_DECLARATION');
    expect(diagnostic).toBeDefined();
    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        ModelDeclaration
          Ident "model"
          Whitespace " "
          Identifier
            Ident "User"
        Newline "\\n"
        ModelDeclaration
          Ident "model"
          Whitespace " "
          Identifier
            Ident "Order"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          RBrace "}""
    `);
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic!.range),
    ).toMatchInlineSnapshot(`
      "
      model User
                ~
      model Order {
      }
      "
    `);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[1]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  // F05: the missing-brace caret anchors immediately after the last significant
  // token, before any trailing trivia — `bump()` flushes trivia before
  // consuming a token, so the cursor offset sits right after `User` even when
  // trailing whitespace/newlines follow. This pins that the caret does not float
  // past the trailing whitespace.
  it('anchors the missing-brace caret after the name, not past trailing whitespace', () => {
    const source = 'model User  \n';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_DECLARATION');
    expect(message).toBe('Expected "{" to open the "model" block');
    // Caret sits at column 10 — immediately after `User` — not at the end of the
    // trailing whitespace run (which would be column 12). The rendered source
    // line carries the trailing whitespace verbatim, so this asserts the range
    // directly rather than via a trailing-whitespace-sensitive snapshot.
    expect(diagnostic.range.start).toEqual({ line: 0, character: 10 });
    expect(diagnostic.range.end).toEqual({ line: 0, character: 10 });
    expect(Array.from(result.document.declarations())[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});

describe('parse() diagnoses unterminated string literals', () => {
  it('reports an unterminated string that runs to EOF, anchored on the token', () => {
    const source = 'model M {\n  id Int @default("oops';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_UNTERMINATED_STRING');
    expect(message).toBe('Unterminated string literal');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model M {
        id Int @default("oops
                        ~~~~~
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('reports an unterminated string stopped at a newline', () => {
    const source = 'model M {\n  id Int @default("oops\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_UNTERMINATED_STRING');
    expect(message).toBe('Unterminated string literal');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model M {
        id Int @default("oops
                        ~~~~~
      }
      "
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('does not flag a well-formed string literal', () => {
    const source = 'model M {\n  id Int @default("ok")\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.find((d) => d.code === 'PSL_UNTERMINATED_STRING')).toBeUndefined();
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('flags a literal ending in an escaped quote as unterminated', () => {
    const source = 'model M {\n  id Int @default("a\\"';
    const { result, message } = diagnosticFor(source, 'PSL_UNTERMINATED_STRING');
    expect(message).toBe('Unterminated string literal');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('does not flag a literal whose escaped quote precedes a real closing quote', () => {
    const source = 'model M {\n  id Int @default("a\\"")\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.find((d) => d.code === 'PSL_UNTERMINATED_STRING')).toBeUndefined();
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});

describe('parse() attribute attachment is newline-insensitive', () => {
  // F06: a standalone attribute on the line after a field attaches to that
  // field, because newlines are trivia in this grammar. This test pins the
  // current behaviour so any future change has a signal; no code change.
  it('attaches a standalone attribute on the next line to the preceding field', () => {
    const source = 'model M {\n  id Int\n  @id\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toHaveLength(0);
    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        ModelDeclaration
          Ident "model"
          Whitespace " "
          Identifier
            Ident "M"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          FieldDeclaration
            Identifier
              Ident "id"
            Whitespace " "
            TypeAnnotation
              QualifiedName
                Identifier
                  Ident "Int"
            Newline "\\n"
            Whitespace "  "
            FieldAttribute
              At "@"
              QualifiedName
                Identifier
                  Ident "id"
          Newline "\\n"
          RBrace "}""
    `);
    const model = Array.from(result.document.declarations())[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});

function memberTexts(result: ReturnType<typeof parse>): string[] {
  const [declaration] = Array.from(result.document.syntax.childNodes());
  return Array.from(
    declaration?.childNodes() ?? [],
    (member) => `${member.kind} ${greenText(member.green)}`,
  );
}

function messagesOf(result: ReturnType<typeof parse>): string[] {
  return result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
}

describe('parse() keeps the rest of a line in a member whose arguments or value fail to parse', () => {
  it('reports the argument error of a field attribute, anchored on the first token it cannot read', () => {
    const source = 'model User {\n  id Int @default(+foo)\n  name String\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_ATTRIBUTE_SYNTAX');
    expect(message).toBe('Unexpected "+" in attribute arguments');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model User {
        id Int @default(+foo)
                        ~
        name String
      }
      "
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration id Int @default(+foo)',
      'FieldDeclaration name String',
    ]);
  });

  it('does not read a name left on the line as another field', () => {
    const result = parse(
      'model User {\n  id Int @default(1 extra String)\n  name String\n}',
      'test.psl',
    );
    expect(messagesOf(result)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "extra" in attribute arguments',
    ]);
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration id Int @default(1 extra String)',
      'FieldDeclaration name String',
    ]);
  });

  it('does not read a block attribute left on the line as a member', () => {
    const result = parse('model User {\n  id Int @default(1 @@map("x"))\n}', 'test.psl');
    expect(messagesOf(result)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "@@" in attribute arguments',
    ]);
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration id Int @default(1 @@map("x"))',
    ]);
  });

  it('keeps the rest of the line after a failure in a nested list or call', () => {
    const result = parse(
      'model User {\n  id Int @default(fn([1 +a], 2))\n  name String\n}',
      'test.psl',
    );
    expect(messagesOf(result)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments',
    ]);
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration id Int @default(fn([1 +a], 2))',
      'FieldDeclaration name String',
    ]);
  });

  it('reports type arguments that fail to parse with the member code', () => {
    const source = 'model User {\n  embedding Vector(+dims) @unique\n  name String\n}';
    const { result, message, diagnostic } = diagnosticFor(source, 'PSL_INVALID_MODEL_MEMBER');
    expect(message).toBe('Unexpected "+" in type arguments');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      model User {
        embedding Vector(+dims) @unique
                         ~
        name String
      }
      "
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration embedding Vector(+dims) @unique',
      'FieldDeclaration name String',
    ]);
  });

  it('reports nothing for arguments left open at the end of a line', () => {
    const result = parse(
      'model User {\n  name String @default("anonymous"\n  active Boolean\n}',
      'test.psl',
    );
    expect(result.diagnostics).toEqual([]);
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration name String @default("anonymous"',
      'FieldDeclaration active Boolean',
    ]);
  });

  it('leaves the closing brace of the block to the block', () => {
    const result = parse('model User { id Int @default(1 }', 'test.psl');
    const [model] = Array.from(result.document.declarations());
    expect(result.diagnostics).toEqual([]);
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    if (model instanceof ModelDeclarationAst) expect(model.rbrace()).toBeDefined();
  });

  it('keeps the rest of the line in a block attribute of a model', () => {
    const result = parse(
      'model User {\n  id Int\n  @@index([id +other])\n  name String\n}',
      'test.psl',
    );
    expect(messagesOf(result)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments',
    ]);
    expect(memberTexts(result)).toEqual([
      'Identifier User',
      'FieldDeclaration id Int',
      'ModelAttribute @@index([id +other])',
      'FieldDeclaration name String',
    ]);
  });

  it('keeps the rest of the line in a block attribute of a generic block', () => {
    const result = parse('policy P {\n  @@map("p" +other)\n  k = 1\n}', 'test.psl');
    expect(messagesOf(result)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments',
    ]);
    expect(memberTexts(result)).toEqual([
      'Identifier P',
      'ModelAttribute @@map("p" +other)',
      'KeyValuePair k = 1',
    ]);
  });

  it('reports an entry value left unclosed, anchored on the first token it cannot read', () => {
    const source = 'policy P {\n  roles = [a +b]\n  k = 1\n}';
    const { result, message, diagnostic } = diagnosticFor(
      source,
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
    );
    expect(message).toBe('Unexpected "+" in the entry value');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic.range),
    ).toMatchInlineSnapshot(`
      "
      policy P {
        roles = [a +b]
                   ~
        k = 1
      }
      "
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(memberTexts(result)).toEqual([
      'Identifier P',
      'KeyValuePair roles = [a +b]',
      'KeyValuePair k = 1',
    ]);
  });

  it('keeps the rest of the line after an entry value that is an unclosed call', () => {
    const result = parse('policy P {\n  using = check(+owner)\n  k = 1\n}', 'test.psl');
    expect(messagesOf(result)).toEqual([
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER: Unexpected "+" in the entry value',
    ]);
    expect(memberTexts(result)).toEqual([
      'Identifier P',
      'KeyValuePair using = check(+owner)',
      'KeyValuePair k = 1',
    ]);
  });

  it('reports a missing entry value once and keeps what follows on the line', () => {
    const result = parse('policy P {\n  using = +owner\n  k = 1\n}', 'test.psl');
    expect(messagesOf(result)).toEqual([
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER: Expected a value after "="',
    ]);
    expect(memberTexts(result)).toEqual([
      'Identifier P',
      'KeyValuePair using = +owner',
      'KeyValuePair k = 1',
    ]);
  });

  it('reports an unterminated object value once', () => {
    const result = parse('policy P {\n  opts = { a: 1 +b\n  k = 1\n}', 'test.psl');
    expect(messagesOf(result)).toEqual(['PSL_INVALID_OBJECT_LITERAL: Unterminated object literal']);
    expect(memberTexts(result)).toEqual([
      'Identifier P',
      'KeyValuePair opts = { a: 1 +b',
      'KeyValuePair k = 1',
    ]);
  });

  it('keeps the rest of the line in an attribute of an enum member', () => {
    const result = parse('enum Role {\n  ADMIN @map("admin" +x)\n  USER\n}', 'test.psl');
    expect(messagesOf(result)).toEqual([
      'PSL_INVALID_ATTRIBUTE_SYNTAX: Unexpected "+" in attribute arguments',
    ]);
    expect(memberTexts(result)).toEqual([
      'Identifier Role',
      'KeyValuePair ADMIN @map("admin" +x)',
      'KeyValuePair USER',
    ]);
  });

  it('still reads two fields on one line and two entries on one line', () => {
    const model = parse('model User { id Int @id name String @default("a") }', 'test.psl');
    const block = parse('policy P { a = [1, 2] b = fn(3) }', 'test.psl');
    expect(model.diagnostics).toEqual([]);
    expect(block.diagnostics).toEqual([]);
    expect(memberTexts(model)).toEqual([
      'Identifier User',
      'FieldDeclaration id Int @id',
      'FieldDeclaration name String @default("a")',
    ]);
    expect(memberTexts(block)).toEqual([
      'Identifier P',
      'KeyValuePair a = [1, 2]',
      'KeyValuePair b = fn(3)',
    ]);
  });
});
