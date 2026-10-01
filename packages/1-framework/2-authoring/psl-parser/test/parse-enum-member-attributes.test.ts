import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import type { FieldAttributeAst } from '../src/syntax/ast/attributes';
import { GenericBlockDeclarationAst } from '../src/syntax/ast/declarations';
import { StringLiteralExprAst } from '../src/syntax/ast/expressions';
import type { GreenElement } from '../src/syntax/green';
import { printTree } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

function onlyGenericBlock(source: string): GenericBlockDeclarationAst {
  const result = parse(source, 'test.psl');
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
    const result = parse('enum Role {\n  USER @map("user")\n}', 'test.psl');
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

  it('parses an attribute after an enum member value', () => {
    const block = onlyGenericBlock('enum Role {\n  Admin = "admin" @map("ADMIN")\n}');
    const [admin] = Array.from(block.entries());
    expect(Array.from(admin?.attributes() ?? [], (a) => a.name()?.path())).toEqual([['map']]);
  });

  it('parses a bare enum member with no attributes', () => {
    const block = onlyGenericBlock('enum Role {\n  ADMIN\n  USER\n}');
    expect(Array.from(block.entries(), (entry) => Array.from(entry.attributes()).length)).toEqual([
      0, 0,
    ]);
  });

  it('reports an attribute on an entry outside an enum block as an invalid block entry', () => {
    const result = parse('datasource db {\n  provider = "postgresql" @map("x")\n}', 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_EXTENSION_BLOCK_MEMBER']);
    const [block] = Array.from(result.document.declarations());
    expect(block).toBeInstanceOf(GenericBlockDeclarationAst);
    if (!(block instanceof GenericBlockDeclarationAst)) throw new Error('unreachable');
    for (const entry of block.entries()) {
      expect(Array.from(entry.attributes())).toEqual([]);
    }
  });
});
