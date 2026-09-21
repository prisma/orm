import { describe, expect, it } from 'vitest';
import {
  Cursor,
  parse,
  parseBlockAttribute,
  parseCompositeType,
  parseField,
  parseGenericBlock,
  parseKeyValue,
  parseModel,
  parseNamedType,
  parseNamespace,
  parseTypesBlock,
} from '../src/parse';
import {
  AttributeArgListAst,
  FieldAttributeAst,
  ModelAttributeAst,
} from '../src/syntax/ast/attributes';
import {
  CompositeTypeDeclarationAst,
  DocumentAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../src/syntax/ast/declarations';
import {
  type ExpressionAst,
  FunctionCallAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
} from '../src/syntax/ast/expressions';
import { printSyntax } from '../src/syntax/ast-helpers';
import type { GreenElement, GreenNode } from '../src/syntax/green';
import type { SyntaxNode } from '../src/syntax/red';
import { highlight, printTree } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function greenRoot(source: string): GreenNode {
  return parse(source, 'test.psl').document.syntax.green;
}

describe('parse() well-formed document conformance', () => {
  it('reproduces a model with a field and a field attribute', () => {
    const source = 'model User {\n  id Int @id\n}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        ModelDeclaration
          Ident "model"
          Whitespace " "
          Identifier
            Ident "User"
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
            Whitespace " "
            FieldAttribute
              At "@"
              QualifiedName
                Identifier
                  Ident "id"
          Newline "\\n"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a model with a field and a block attribute', () => {
    const source = 'model User {\n  id Int\n@@map\n}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        ModelDeclaration
          Ident "model"
          Whitespace " "
          Identifier
            Ident "User"
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
          ModelAttribute
            DoubleAt "@@"
            QualifiedName
              Identifier
                Ident "map"
          Newline "\\n"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces an enum as a generic block with bare members', () => {
    const source = 'enum Role {\n  ADMIN\n  USER\n}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        GenericBlockDeclaration
          Ident "enum"
          Whitespace " "
          Identifier
            Ident "Role"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "ADMIN"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "USER"
          Newline "\\n"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces an enum with a @@type block attribute and key=value members', () => {
    const source = 'enum Role {\n  @@type("pg/text@1")\n  Admin = "admin"\n}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        GenericBlockDeclaration
          Ident "enum"
          Whitespace " "
          Identifier
            Ident "Role"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          ModelAttribute
            DoubleAt "@@"
            QualifiedName
              Identifier
                Ident "type"
            AttributeArgList
              LParen "("
              AttributeArg
                StringLiteralExpr
                  StringLiteral "\\"pg/text@1\\""
              RParen ")"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "Admin"
            Whitespace " "
            Equals "="
            Whitespace " "
            StringLiteralExpr
              StringLiteral "\\"admin\\""
          Newline "\\n"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a types block with a named type', () => {
    const source = 'types {\n  UserId = Int\n}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        TypesBlock
          Ident "types"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          NamedTypeDeclaration
            Identifier
              Ident "UserId"
            Whitespace " "
            Equals "="
            Whitespace " "
            TypeAnnotation
              QualifiedName
                Identifier
                  Ident "Int"
          Newline "\\n"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a named-type declaration with an attribute inside a types block', () => {
    const source = 'types {\n  UserId = Int @db\n}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        TypesBlock
          Ident "types"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          NamedTypeDeclaration
            Identifier
              Ident "UserId"
            Whitespace " "
            Equals "="
            Whitespace " "
            TypeAnnotation
              QualifiedName
                Identifier
                  Ident "Int"
            Whitespace " "
            FieldAttribute
              At "@"
              QualifiedName
                Identifier
                  Ident "db"
          Newline "\\n"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a generic block declaration with a key-value entry', () => {
    const source = 'datasource db {\n  provider = "postgresql"\n}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        GenericBlockDeclaration
          Ident "datasource"
          Whitespace " "
          Identifier
            Ident "db"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "provider"
            Whitespace " "
            Equals "="
            Whitespace " "
            StringLiteralExpr
              StringLiteral "\\"postgresql\\""
          Newline "\\n"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('parses a @@-block attribute inside a generic block as a ModelAttribute member, not a spurious invalid member', () => {
    const source = 'enum2 Priority {\n  @@type("pg/text@1")\n  Low = "low"\n}';
    const result = parse(source, 'test.psl');

    expect(result.diagnostics).toEqual([]);
    expect(greenText(result.document.syntax.green)).toBe(source);

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        GenericBlockDeclaration
          Ident "enum2"
          Whitespace " "
          Identifier
            Ident "Priority"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          ModelAttribute
            DoubleAt "@@"
            QualifiedName
              Identifier
                Ident "type"
            AttributeArgList
              LParen "("
              AttributeArg
                StringLiteralExpr
                  StringLiteral "\\"pg/text@1\\""
              RParen ")"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "Low"
            Whitespace " "
            Equals "="
            Whitespace " "
            StringLiteralExpr
              StringLiteral "\\"low\\""
          Newline "\\n"
          RBrace "}""
    `);

    const block = Array.from(result.document.declarations())[0];
    expect(block).toBeInstanceOf(GenericBlockDeclarationAst);
    if (!(block instanceof GenericBlockDeclarationAst)) return;

    const attributes = Array.from(block.attributes());
    expect(attributes).toHaveLength(1);
    expect(attributes[0]).toBeInstanceOf(ModelAttributeAst);
    expect(attributes[0]!.name()?.identifier()?.token()?.text).toBe('type');
    const args = Array.from(attributes[0]!.argList()?.args() ?? []);
    expect(args).toHaveLength(1);
    const argValue = args[0]!.value();
    expect(argValue && StringLiteralExprAst.cast(argValue.syntax)?.value()).toBe('pg/text@1');

    const entries = Array.from(block.entries());
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key()?.token()?.text).toBe('Low');
  });

  it('reproduces a composite type declaration', () => {
    const source = 'type Address {street String@@map}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        CompositeTypeDeclaration
          Ident "type"
          Whitespace " "
          Identifier
            Ident "Address"
          Whitespace " "
          LBrace "{"
          FieldDeclaration
            Identifier
              Ident "street"
            Whitespace " "
            TypeAnnotation
              QualifiedName
                Identifier
                  Ident "String"
          ModelAttribute
            DoubleAt "@@"
            QualifiedName
              Identifier
                Ident "map"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a namespace with nested declarations', () => {
    const source = 'namespace auth {model User{}enum Role{}extend Something{}}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        Namespace
          Ident "namespace"
          Whitespace " "
          Identifier
            Ident "auth"
          Whitespace " "
          LBrace "{"
          ModelDeclaration
            Ident "model"
            Whitespace " "
            Identifier
              Ident "User"
            LBrace "{"
            RBrace "}"
          GenericBlockDeclaration
            Ident "enum"
            Whitespace " "
            Identifier
              Ident "Role"
            LBrace "{"
            RBrace "}"
          GenericBlockDeclaration
            Ident "extend"
            Whitespace " "
            Identifier
              Ident "Something"
            LBrace "{"
            RBrace "}"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('reproduces a document with mixed declarations', () => {
    const source = 'model User {}\nenum Role {}';
    const result = parse(source, 'test.psl');

    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        ModelDeclaration
          Ident "model"
          Whitespace " "
          Identifier
            Ident "User"
          Whitespace " "
          LBrace "{"
          RBrace "}"
        Newline "\\n"
        GenericBlockDeclaration
          Ident "enum"
          Whitespace " "
          Identifier
            Ident "Role"
          Whitespace " "
          LBrace "{"
          RBrace "}""
    `);
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it('preserves leading and trailing trivia losslessly', () => {
    const source = '\n// header\nmodel User {}\n';
    const result = parse(source, 'test.psl');
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
  });
});

describe('parse() representative multi-construct schema', () => {
  const source = [
    'datasource db {',
    '  provider = "postgresql"',
    '  url = env("DATABASE_URL")',
    '}',
    '',
    'types {',
    '  UserId = Int @id',
    '}',
    '',
    'model User {',
    '  id UserId @id',
    '  name String?',
    '  roles Role[]',
    '  posts auth.Post[]',
    '  vec Vector(1536)',
    '  org supabase:auth.Org',
    '  @@index([id, name])',
    '  @@map("users")',
    '}',
    '',
    'enum Role {',
    '  @@type("pg/text@1")',
    '  Admin = "admin"',
    '  User = "user"',
    '}',
    '',
    'namespace auth {',
    '  model Post {',
    '    id Int @id',
    '    tags String[] @extension.Array',
    '  }',
    '  enum Visibility {',
    '    @@type("pg/text@1")',
    '    Public = "public"',
    '  }',
    '}',
    '',
    'type Address {',
    '  street String',
    '  @@map("addresses")',
    '}',
  ].join('\n');

  it('parses every construct with zero diagnostics and round-trips', () => {
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([]);
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('exposes the top-level declarations in order', () => {
    const result = parse(source, 'test.psl');
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(6);
    expect(decls[0]).toBeInstanceOf(GenericBlockDeclarationAst);
    expect(decls[1]).toBeInstanceOf(TypesBlockAst);
    expect(decls[2]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[3]).toBeInstanceOf(GenericBlockDeclarationAst);
    expect(decls[4]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(decls[5]).toBeInstanceOf(CompositeTypeDeclarationAst);
  });

  it('exposes the namespace members', () => {
    const result = parse(source, 'test.psl');
    const ns = Array.from(result.document.declarations()).find(
      (d): d is NamespaceDeclarationAst => d instanceof NamespaceDeclarationAst,
    );
    const members = Array.from(ns!.declarations());
    expect(members).toHaveLength(2);
    expect(members[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(members[1]).toBeInstanceOf(GenericBlockDeclarationAst);
  });
});

describe('parse() round-trips lossless schemas', () => {
  it('parses an object-literal constructor argument into a queryable ObjectLiteralExpr node', () => {
    const source = 'model M {\n  id Json @default({ a: 1, nested: { b: 2 } })\n}';
    const result = parse(source, 'test.psl');
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    const model = decls[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    if (!(model instanceof ModelDeclarationAst)) return;
    const [field] = Array.from(model.fields());
    expect(field).toBeInstanceOf(FieldDeclarationAst);
    const [attr] = Array.from(field!.attributes());
    expect(attr).toBeInstanceOf(FieldAttributeAst);
    const argList = attr!.argList();
    expect(argList).toBeInstanceOf(AttributeArgListAst);
    const [arg] = Array.from(argList!.args());
    const obj = arg!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (!(obj instanceof ObjectLiteralExprAst)) return;
    const fields = Array.from(obj.fields());
    expect(fields.map((f) => f.key()?.token()?.text)).toEqual(['a', 'nested']);
    expect(fields[1]!.value()).toBeInstanceOf(ObjectLiteralExprAst);
  });

  it('round-trips a schema with CRLF newlines', () => {
    const source = 'model User {\r\n  id Int @id\r\n}\r\nenum Role {\r\n  ADMIN\r\n}\r\n';
    const result = parse(source, 'test.psl');
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[1]).toBeInstanceOf(GenericBlockDeclarationAst);
  });

  it('round-trips unicode identifiers losslessly', () => {
    const source = 'model 用户 {\n  имя String\n  café Int\n}';
    const result = parse(source, 'test.psl');
    expect(greenText(result.document.syntax.green)).toBe(source);
    expect(result.diagnostics).toEqual([]);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    const model = decls[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    if (!(model instanceof ModelDeclarationAst)) return;
    expect(model.name()?.token()?.text).toBe('用户');
    const fields = Array.from(model.fields());
    expect(fields.map((f) => f.name()?.token()?.text)).toEqual(['имя', 'café']);
  });
});

// F04 (review finding, fixed). A missing `:` inside an object literal must not
// swallow the next field's key as this field's value: the field loop re-enters
// on a following field-start (not just a comma) and the missing-colon branch
// returns key-only when a real key (`<ident> :`) follows. So `{ a b: 1 }`
// recovers exactly like `{ a, b: 1 }` — one diagnostic, two fields, the object
// stays terminated, and the enclosing block is intact.
describe('parse() object-literal missing-colon recovery', () => {
  it('recovers a following field after a missing colon without corrupting the enclosing block', () => {
    const source = 'datasource db {\n  x = { a b: 1 }\n}';
    const result = parse(source, 'test.psl');
    expect(greenText(result.document.syntax.green)).toBe(source); // round-trip holds
    // Two problems: the missing colon on `a`, and the missing comma before `b`.
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'PSL_INVALID_OBJECT_LITERAL',
      'PSL_INVALID_OBJECT_LITERAL',
    ]);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      'Expected ":" after "a"',
      'Expected "," between object-literal fields',
    ]);
    const [missingColon, missingComma] = result.diagnostics;
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), missingColon!.range),
    ).toMatchInlineSnapshot(`
      "
      datasource db {
        x = { a b: 1 }
              ~
      }
      "
    `);
    // The missing-comma `~` sits just after the `a` field (zero-width gap).
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), missingComma!.range),
    ).toMatchInlineSnapshot(`
      "
      datasource db {
        x = { a b: 1 }
               ~
      }
      "
    `);

    // The enclosing datasource block stays intact: one declaration, a block.
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(GenericBlockDeclarationAst);

    // The object literal has two fields (`a` key-only, `b` = 1) and a closing brace.
    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        GenericBlockDeclaration
          Ident "datasource"
          Whitespace " "
          Identifier
            Ident "db"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          KeyValuePair
            Identifier
              Ident "x"
            Whitespace " "
            Equals "="
            Whitespace " "
            ObjectLiteralExpr
              LBrace "{"
              Whitespace " "
              ObjectField
                Identifier
                  Ident "a"
              Whitespace " "
              ObjectField
                Identifier
                  Ident "b"
                Colon ":"
                Whitespace " "
                NumberLiteralExpr
                  NumberLiteral "1"
              Whitespace " "
              RBrace "}"
          Newline "\\n"
          RBrace "}""
    `);
  });

  it('flags a missing comma between two well-formed fields and parses both', () => {
    const source = 'datasource db {\n  x = { a: 1 b: 2 }\n}';
    const result = parse(source, 'test.psl');
    expect(greenText(result.document.syntax.green)).toBe(source); // round-trip holds
    // One diagnostic: the missing comma between `a: 1` and `b: 2`.
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_OBJECT_LITERAL']);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic!.message).toBe('Expected "," between object-literal fields');
    // The `~` sits just after the `a: 1` field (zero-width gap before `b`).
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic!.range),
    ).toMatchInlineSnapshot(`
      "
      datasource db {
        x = { a: 1 b: 2 }
                  ~
      }
      "
    `);

    // Both fields parse as proper key/value pairs.
    const decls = Array.from(result.document.declarations());
    const block = decls[0];
    expect(block).toBeInstanceOf(GenericBlockDeclarationAst);
    if (!(block instanceof GenericBlockDeclarationAst)) return;
    const pair = Array.from(block.entries())[0];
    expect(pair).toBeInstanceOf(KeyValuePairAst);
    if (!(pair instanceof KeyValuePairAst)) return;
    const obj = pair.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (!(obj instanceof ObjectLiteralExprAst)) return;
    const fields = Array.from(obj.fields());
    expect(fields).toHaveLength(2);
    expect(fields.map((f) => f.key()?.token()?.text)).toEqual(['a', 'b']);
    const values = fields.map((f) => f.value());
    expect(values[0]).toBeInstanceOf(NumberLiteralExprAst);
    expect(values[1]).toBeInstanceOf(NumberLiteralExprAst);
    expect((values[0] as NumberLiteralExprAst).value()).toBe(1);
    expect((values[1] as NumberLiteralExprAst).value()).toBe(2);
  });

  it('recovers cleanly when a comma delimits the malformed field (contrast)', () => {
    const source = 'datasource db {\n  x = { a, b: 1 }\n}';
    const result = parse(source, 'test.psl');
    expect(greenText(result.document.syntax.green)).toBe(source);
    // With the fix, `{ a b: 1 }` and `{ a, b: 1 }` recover to near-identical trees
    // (the comma is the only token difference): one diagnostic, `b: 1` a proper field.
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_OBJECT_LITERAL']);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic!.message).toBe('Expected ":" after "a"');
    expect(
      highlight(result.sources.sourceFileFor(result.document.syntax), diagnostic!.range),
    ).toMatchInlineSnapshot(`
      "
      datasource db {
        x = { a, b: 1 }
              ~
      }
      "
    `);
  });

  it('accepts a string-literal key inside a block', () => {
    const source = 'datasource db {\n  x = { a: 1, "k": 2 }\n}';
    const result = parse(source, 'test.psl');
    expect(greenText(result.document.syntax.green)).toBe(source); // round-trip holds
    // String-literal keys are accepted; no diagnostic, no cascade into the block.
    expect(result.diagnostics).toEqual([]);

    // The enclosing datasource block stays intact: one declaration, a block.
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBeInstanceOf(GenericBlockDeclarationAst);
  });
});

describe('parse() treats declaration keywords as contextual, not reserved', () => {
  it('parses `model` as a model name', () => {
    const source = 'model model {\n  id Int\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([]);
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(1);
    const model = decls[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    if (!(model instanceof ModelDeclarationAst)) return;
    expect(model.name()?.token()?.text).toBe('model');
  });

  it('parses `model` as a field name', () => {
    const source = 'model User {\n  model String\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([]);
    expect(greenText(result.document.syntax.green)).toBe(source);
    const model = Array.from(result.document.declarations())[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    if (!(model instanceof ModelDeclarationAst)) return;
    const fields = Array.from(model.fields());
    expect(fields.map((f) => f.name()?.token()?.text)).toEqual(['model']);
  });

  it('parses `model` and `enum` as bare enum-block members', () => {
    const source = 'enum Role {\n  model\n  enum\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toEqual([]);
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(GenericBlockDeclarationAst);
    if (!(decl instanceof GenericBlockDeclarationAst)) return;
    const entries = Array.from(decl.entries());
    expect(entries.map((e) => e.key()?.token()?.text)).toEqual(['model', 'enum']);
  });
});

function codes(source: string): readonly string[] {
  return parse(source, 'test.psl').diagnostics.map((d) => d.code);
}

describe('parse() declaration-level diagnostics', () => {
  it('flags an unterminated block but still returns a tree', () => {
    const source = 'model User {\n  id Int';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_UNTERMINATED_BLOCK');
    expect(result.document).toBeInstanceOf(DocumentAst);
    expect(greenText(result.document.syntax.green)).toBe(source);
    const model = Array.from(result.document.declarations())[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
  });

  it('flags a malformed custom declaration and keeps parsing later declarations', () => {
    const source = 'oops\nmodel User {}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_DECLARATION');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(GenericBlockDeclarationAst);
    expect(decls[1]).toBeInstanceOf(ModelDeclarationAst);
  });

  it('flags a reserved namespace name and keeps parsing', () => {
    const source = 'namespace __unspecified__ {\n}\nmodel User {}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_NAMESPACE_BLOCK');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decls = Array.from(result.document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(NamespaceDeclarationAst);
    expect(decls[1]).toBeInstanceOf(ModelDeclarationAst);
  });

  it('flags a recursive namespace block', () => {
    const source = 'namespace outer {\nnamespace inner {\n}\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_NAMESPACE_BLOCK');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('flags a types block nested inside a namespace', () => {
    const source = 'namespace outer {\ntypes {\n}\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_NAMESPACE_BLOCK');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });

  it('flags a malformed model member and keeps parsing the valid field', () => {
    const source = 'model M {\n  123 bad\n  id Int\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_MODEL_MEMBER');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const model = Array.from(result.document.declarations())[0];
    expect(model).toBeInstanceOf(ModelDeclarationAst);
    if (model instanceof ModelDeclarationAst) {
      const fields = Array.from(model.fields());
      expect(fields).toHaveLength(1);
      expect(fields[0]!.name()?.token()?.text).toBe('id');
    }
  });

  it('flags a malformed enum-block member and keeps parsing the valid bare member', () => {
    // `enum` routes through the generic-block grammar, so a malformed member is
    // an extension-block-member diagnostic and the valid `OK` is a bare entry.
    const source = 'enum E {\n  123\n  OK\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_EXTENSION_BLOCK_MEMBER');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(GenericBlockDeclarationAst);
    if (decl instanceof GenericBlockDeclarationAst) {
      const entries = Array.from(decl.entries());
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key()?.token()?.text).toBe('OK');
    }
  });

  it('flags a malformed types-block member and keeps parsing the valid named type', () => {
    const source = 'types {\n  123\n  Ok = Int\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_TYPES_MEMBER');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(TypesBlockAst);
    if (decl instanceof TypesBlockAst) {
      const named = Array.from(decl.declarations());
      expect(named).toHaveLength(1);
      expect(named[0]!.name()?.token()?.text).toBe('Ok');
    }
  });

  it('parses two top-level types blocks without a uniqueness diagnostic', () => {
    const source = 'types {\n}\ntypes {\n}';
    expect(codes(source)).not.toContain('PSL_INVALID_TYPES_MEMBER');
    const decls = Array.from(parse(source, 'test.psl').document.declarations());
    expect(decls).toHaveLength(2);
    expect(decls.every((d) => d instanceof TypesBlockAst)).toBe(true);
    expect(greenText(greenRoot(source))).toBe(source);
  });

  it('flags a malformed generic-block entry and keeps parsing the valid entry', () => {
    const source = 'datasource db {\n  123\n  provider = "x"\n}';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_EXTENSION_BLOCK_MEMBER');
    expect(greenText(result.document.syntax.green)).toBe(source);
    const decl = Array.from(result.document.declarations())[0];
    expect(decl).toBeInstanceOf(GenericBlockDeclarationAst);
    if (decl instanceof GenericBlockDeclarationAst) {
      const entries = Array.from(decl.entries());
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key()?.token()?.text).toBe('provider');
    }
  });

  it('never throws on adversarial input', () => {
    for (const source of ['', '{', '}', '@@@', 'model', 'type', 'namespace {', '== =']) {
      expect(() => parse(source, 'test.psl')).not.toThrow();
    }
  });
});

/**
 * The ordered-alternative dispatch relies on every alternative being a no-op on
 * non-match: it must return `undefined` having consumed and mutated nothing, so
 * a rejected alternative leaves the forward-only cursor intact for the next one.
 * We assert this observationally with the existing cursor API — after the
 * rejection, draining the remaining stream must reproduce the whole source
 * byte-for-byte (nothing dropped) and no diagnostic may have been emitted.
 */
function expectNoOpReject(source: string, run: (cursor: Cursor) => GreenNode | undefined): void {
  const cursor = new Cursor('test.psl', source);
  expect(run(cursor)).toBeUndefined();
  expect(cursor.diagnostics).toEqual([]);
  cursor.startNode('Document');
  while (cursor.peekKind() !== 'Eof') {
    cursor.bump();
  }
  cursor.flushTrivia();
  expect(greenText(cursor.finishNode())).toBe(source);
}

describe('ordered-alternative parsers are no-ops on non-match', () => {
  it('parseModel rejects a non-model keyword without consuming', () => {
    expectNoOpReject('enum Color {', parseModel);
  });

  it('parseNamespace rejects a non-namespace keyword without consuming', () => {
    expectNoOpReject('model User {', parseNamespace);
  });

  it('parseCompositeType rejects a non-type keyword without consuming', () => {
    expectNoOpReject('model User {', parseCompositeType);
  });

  it('parseTypesBlock rejects a non-types keyword without consuming', () => {
    expectNoOpReject('model User {', parseTypesBlock);
  });

  it('parseGenericBlock rejects a reserved keyword so it falls through to recovery', () => {
    expectNoOpReject('model {', parseGenericBlock);
  });

  it('parseBlockAttribute rejects a single-at attribute, preserving the @@-vs-@ split', () => {
    expectNoOpReject('@id', parseBlockAttribute);
  });

  it('parseField rejects a leading double-at member without consuming', () => {
    expectNoOpReject('@@map', parseField);
  });

  it('parseNamedType rejects a non-identifier member without consuming', () => {
    expectNoOpReject('@@index', parseNamedType);
  });

  it('parseKeyValue rejects a non-identifier entry without consuming', () => {
    expectNoOpReject('42', parseKeyValue);
  });
});

describe('Cursor.mark lookahead', () => {
  it('mark(0) spans the next significant token, skipping leading trivia', () => {
    const cursor = new Cursor('test.psl', '  namespace Foo {');
    expect(cursor.mark()).toEqual({ offset: 2, length: 'namespace'.length });
  });

  it('mark(1) spans the significant token after the next, trivia included in the offset', () => {
    const cursor = new Cursor('test.psl', 'namespace Foo {');
    expect(cursor.mark(1)).toEqual({ offset: 'namespace '.length, length: 'Foo'.length });
  });
});

function onlyTypeConstructorArgs(source: string): readonly ExpressionAst[] {
  const result = parse(source, 'test.psl');
  expect(result.diagnostics).toHaveLength(0);
  expect(greenText(result.document.syntax.green)).toBe(source);
  const typesBlock = Array.from(result.document.declarations()).find(
    (decl): decl is TypesBlockAst => decl instanceof TypesBlockAst,
  );
  const named = Array.from(typesBlock?.declarations() ?? [])[0];
  const argList = named?.typeAnnotation()?.argList();
  if (!argList) throw new Error('expected a type constructor call');
  return Array.from(argList.args(), (arg) => arg.value()).filter(
    (v): v is ExpressionAst => v !== undefined,
  );
}

describe('parse() accepts single-quoted string literals', () => {
  it('tokenizes a single-quoted positional argument and unquotes it via value()', () => {
    const args = onlyTypeConstructorArgs("types {\n  T = sql.Enum('Tag', ['a'])\n}\n");
    const first = args[0];
    expect(first).toBeInstanceOf(StringLiteralExprAst);
    expect(StringLiteralExprAst.cast((first as StringLiteralExprAst).syntax)?.value()).toBe('Tag');
  });

  it('tokenizes a single-quoted value inside an object-literal argument', () => {
    const args = onlyTypeConstructorArgs("types {\n  T = sql.String({ label: 'short' })\n}\n");
    const object = args[0];
    expect(object).toBeInstanceOf(ObjectLiteralExprAst);
    const field = Array.from((object as ObjectLiteralExprAst).fields())[0];
    const value = field?.value();
    expect(value).toBeInstanceOf(StringLiteralExprAst);
    expect((value as StringLiteralExprAst).value()).toBe('short');
    // The raw arg text round-trips the single quotes, matching the legacy reader.
    expect(printSyntax((object as ExpressionAst).syntax)).toBe("{ label: 'short' }");
  });

  it('unquotes both quote styles and decodes escaped single quotes', () => {
    const args = onlyTypeConstructorArgs('types {\n  T = sql.Enum(\'a\\\'b\', "c\\"d")\n}\n');
    expect((args[0] as StringLiteralExprAst).value()).toBe("a'b");
    expect((args[1] as StringLiteralExprAst).value()).toBe('c"d');
  });

  it('still diagnoses an unterminated single-quoted literal', () => {
    const source = "model M {\n  id Int @default('oops";
    const result = parse(source, 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_UNTERMINATED_STRING');
    expect(greenText(result.document.syntax.green)).toBe(source);
  });
});

describe('parse() accepts double-quoted object-literal keys', () => {
  it('accepts a string-literal key with no diagnostic and exposes the unquoted name', () => {
    const args = onlyTypeConstructorArgs('types {\n  T = sql.String({ "length": 35 })\n}\n');
    const object = args[0] as ObjectLiteralExprAst;
    const field = Array.from(object.fields())[0];
    expect(field?.keyName()).toBe('length');
    expect((field?.value() as NumberLiteralExprAst | undefined)?.value()).toBe(35);
    expect(printSyntax(object.syntax)).toBe('{ "length": 35 }');
  });

  it('accepts a mix of identifier and string-literal keys', () => {
    const args = onlyTypeConstructorArgs(
      'types {\n  T = sql.String({ "length": 35, label: "short" })\n}\n',
    );
    const object = args[0] as ObjectLiteralExprAst;
    const keys = Array.from(object.fields(), (f) => f.keyName());
    expect(keys).toEqual(['length', 'label']);
  });
});

describe('parse() accepts qualified default-function calls', () => {
  it('parses ns.fn() in default-value position as one qualified FunctionCall', () => {
    const source = 'model M {\n  id Int @default(temporal.updatedAt())\n}\n';
    const result = parse(source, 'test.psl');
    expect(result.diagnostics).toHaveLength(0);
    expect(greenText(result.document.syntax.green)).toBe(source);

    const calls: FunctionCallAst[] = [];
    const visit = (node: SyntaxNode): void => {
      const call = FunctionCallAst.cast(node);
      if (call) calls.push(call);
      for (const child of node.childNodes()) visit(child);
    };
    visit(result.document.syntax);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path()).toEqual(['temporal', 'updatedAt']);
    // The raw text the downstream resolver reads is the full qualified call —
    // never split into a bare `temporal` plus a trailing parse error.
    expect(printSyntax((calls[0] as ExpressionAst).syntax)).toBe('temporal.updatedAt()');
  });
});
