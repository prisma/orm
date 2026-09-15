/**
 * The `prisma7` grammar reads two Prisma 7 constructs so the Prisma 7
 * interpreter can walk them with spans: attributes on enum members, and field
 * lines inside `view` blocks. The default grammar reads neither.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import type { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { GenericBlockDeclarationAst } from '../src/syntax/ast/declarations';
import { StringLiteralExprAst } from '../src/syntax/ast/expressions';
import type { GreenElement } from '../src/syntax/green';
import { printTree } from './support';

const prisma7 = { grammar: 'prisma7' } as const;

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function onlyGenericBlock(source: string): GenericBlockDeclarationAst {
  const result = parse(source, prisma7);
  expect(result.diagnostics).toEqual([]);
  expect(greenText(result.document.syntax.green)).toBe(source);
  const [declaration] = Array.from(result.document.declarations());
  expect(declaration).toBeInstanceOf(GenericBlockDeclarationAst);
  if (!(declaration instanceof GenericBlockDeclarationAst)) throw new Error('unreachable');
  return declaration;
}

function attributeArgs(attribute: FieldAttributeAst) {
  return Array.from(attribute.argList()?.args() ?? [], (arg) => ({
    name: arg.name()?.token()?.text,
    value: StringLiteralExprAst.cast(arg.value()?.syntax ?? attribute.syntax)?.value(),
  }));
}

describe('enum member attributes', () => {
  describe('given the prisma7 grammar', () => {
    it('parses positional and named attribute arguments on members with spans', () => {
      const source = 'enum Role {\n  USER @map("user")\n  ADMIN @map(name: "admin") @deprecated\n}';
      const block = onlyGenericBlock(source);
      const [user, admin] = Array.from(block.entries());

      expect(user?.key()?.token()?.text).toBe('USER');
      expect(user?.value()).toBeUndefined();
      const userAttributes = Array.from(user?.attributes() ?? []);
      expect(userAttributes).toHaveLength(1);
      expect(userAttributes[0]?.name()?.path()).toEqual(['map']);
      expect(attributeArgs(userAttributes[0]!)).toEqual([{ name: undefined, value: 'user' }]);
      expect(userAttributes[0]?.syntax.offset).toBe(source.indexOf('@map("user")'));
      expect(userAttributes[0]?.syntax.textLength).toBe('@map("user")'.length);

      const adminAttributes = Array.from(admin?.attributes() ?? []);
      expect(adminAttributes.map((attribute) => attribute.name()?.path())).toEqual([
        ['map'],
        ['deprecated'],
      ]);
      expect(attributeArgs(adminAttributes[0]!)).toEqual([{ name: 'name', value: 'admin' }]);
      expect(adminAttributes[1]?.argList()).toBeUndefined();
    });

    it('parses a member attribute list as FieldAttribute children of the KeyValuePair', () => {
      const result = parse('enum Role {\n  USER @map("user")\n}', prisma7);
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
                Ident "USER"
              Whitespace " "
              FieldAttribute
                At "@"
                QualifiedName
                  Identifier
                    Ident "map"
                AttributeArgList
                  LParen "("
                  AttributeArg
                    StringLiteralExpr
                      StringLiteral "\\"user\\""
                  RParen ")"
            Newline "\\n"
            RBrace "}""
      `);
    });

    it('keeps the invalid-member diagnostic for an entry attribute outside an enum block', () => {
      const result = parse('datasource db {\n  provider = "postgresql" @map("x")\n}', prisma7);
      expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_EXTENSION_BLOCK_MEMBER']);
      const [block] = Array.from(result.document.declarations());
      expect(block).toBeInstanceOf(GenericBlockDeclarationAst);
      if (!(block instanceof GenericBlockDeclarationAst)) throw new Error('unreachable');
      for (const entry of block.entries()) {
        expect(Array.from(entry.attributes())).toEqual([]);
      }
    });

    it('parses a bare enum block into the same tree as the default grammar', () => {
      const source = 'enum Role {\n  ADMIN\n  USER\n}';
      const block = onlyGenericBlock(source);
      for (const entry of block.entries()) {
        expect(Array.from(entry.attributes())).toEqual([]);
      }
      expect(printTree(parse(source, prisma7).document.syntax.green)).toBe(
        printTree(parse(source).document.syntax.green),
      );
    });
  });

  describe('given the default grammar', () => {
    it('reports an attribute after an enum member as an invalid block entry at the attribute', () => {
      const result = parse('enum Role {\n  USER @map("user")\n}');
      expect(result.diagnostics).toEqual([
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
          message: 'Invalid block entry',
          range: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } },
        },
      ]);
    });

    it('reports an attribute after an enum member value as an invalid block entry', () => {
      const result = parse('enum Role {\n  Admin = "admin" @map("ADMIN")\n}');
      expect(result.diagnostics).toEqual([
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
          message: 'Invalid block entry',
          range: { start: { line: 1, character: 18 }, end: { line: 1, character: 19 } },
        },
      ]);
    });

    it('reports an attribute after an enum member inside a namespace block as an invalid block entry', () => {
      const result = parse('namespace auth {\n  enum Role {\n    USER @map("user")\n  }\n}');
      expect(result.diagnostics).toEqual([
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
          message: 'Invalid block entry',
          range: { start: { line: 2, character: 9 }, end: { line: 2, character: 10 } },
        },
      ]);
    });
  });
});

describe('view blocks', () => {
  const source =
    'view ActiveUsers {\n  id    Int    @unique\n  email String @db.VarChar(255)\n  posts Post[]\n\n  @@map("active_users")\n}';

  describe('given the prisma7 grammar', () => {
    it('parses a view with the model body grammar and keeps the view keyword', () => {
      const block = onlyGenericBlock(source);
      expect(block.keyword()?.text).toBe('view');
      expect(block.name()?.token()?.text).toBe('ActiveUsers');
      const fields = Array.from(block.fields());
      expect(fields.map((field) => field.name()?.token()?.text)).toEqual(['id', 'email', 'posts']);
      expect(fields[0]?.typeAnnotation()?.syntax.offset).toBe(source.indexOf('Int'));
      expect(Array.from(fields[1]!.attributes()).map((a) => a.name()?.path())).toEqual([
        ['db', 'VarChar'],
      ]);
      expect(Array.from(block.attributes()).map((a) => a.name()?.path())).toEqual([['map']]);
      expect(Array.from(block.entries())).toEqual([]);
    });

    it('parses a view body as FieldDeclaration children', () => {
      const result = parse('view ActiveUsers {\n  id Int @unique\n}', prisma7);
      expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
        "Document
          GenericBlockDeclaration
            Ident "view"
            Whitespace " "
            Identifier
              Ident "ActiveUsers"
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
                    Ident "unique"
            Newline "\\n"
            RBrace "}""
      `);
    });

    it('reports a malformed view member with the model-member diagnostic', () => {
      const result = parse('view ActiveUsers {\n  123\n  id Int\n}', prisma7);
      expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_MODEL_MEMBER']);
    });
  });

  describe('given the default grammar', () => {
    it('reports an attribute on a view field line as an invalid block entry', () => {
      const result = parse('view ActiveUsers {\n  id Int @unique\n}');
      expect(result.diagnostics).toEqual([
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
          message: 'Invalid block entry',
          range: { start: { line: 1, character: 9 }, end: { line: 1, character: 10 } },
        },
      ]);
    });

    it('reads the words of a plain view field line as bare entries', () => {
      const result = parse('view ActiveUsers {\n  id Int\n}');
      expect(result.diagnostics).toEqual([]);
      const [block] = Array.from(result.document.declarations());
      expect(block).toBeInstanceOf(GenericBlockDeclarationAst);
      if (!(block instanceof GenericBlockDeclarationAst)) throw new Error('unreachable');
      expect({
        entries: Array.from(block.entries(), (entry) => entry.key()?.token()?.text),
        fields: Array.from(block.fields()),
      }).toEqual({ entries: ['id', 'Int'], fields: [] });
    });
  });
});
