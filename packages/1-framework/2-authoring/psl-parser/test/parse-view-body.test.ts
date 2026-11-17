import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { GenericBlockDeclarationAst } from '../src/syntax/ast/declarations';
import type { GreenElement } from '../src/syntax/green';
import { printTree } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

const prisma7 = { grammar: 'prisma-7' } as const;

function onlyGenericBlock(
  source: string,
  options: Parameters<typeof parse>[2] = {},
): GenericBlockDeclarationAst {
  const result = parse(source, 'test.psl', options);
  expect(result.diagnostics).toEqual([]);
  expect(greenText(result.document.syntax.green)).toBe(source);
  const [declaration] = Array.from(result.document.declarations());
  expect(declaration).toBeInstanceOf(GenericBlockDeclarationAst);
  if (!(declaration instanceof GenericBlockDeclarationAst)) throw new Error('unreachable');
  return declaration;
}

describe('a view block body, in the prisma-7 grammar', () => {
  const source =
    'view ActiveUsers {\n  id    Int    @unique\n  email String @db.VarChar(255)\n  posts Post[]\n\n  @@map("active_users")\n}';

  it('parses as fields and block attributes, keeping the view a generic block', () => {
    const block = onlyGenericBlock(source, prisma7);
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

  it('parses each field line as a FieldDeclaration child', () => {
    const result = parse('view ActiveUsers {\n  id Int @unique\n}', 'test.psl', prisma7);
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

  it('reports a malformed member with the model-member diagnostic', () => {
    const result = parse('view ActiveUsers {\n  123\n  id Int\n}', 'test.psl', prisma7);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_MODEL_MEMBER']);
  });

  it('parses the same way inside a namespace block', () => {
    const result = parse(
      'namespace app {\n  view ActiveUsers {\n    id Int @unique\n  }\n}',
      'test.psl',
      prisma7,
    );
    expect(result.diagnostics).toEqual([]);
    expect(printTree(result.document.syntax.green)).toContain('FieldDeclaration');
  });
});

describe('a view block body, by default', () => {
  it('reads each line as entries, as in any block the parser does not know', () => {
    const block = onlyGenericBlock('view ActiveUsers {\n  id Int\n}');
    expect({
      entries: Array.from(block.entries(), (entry) => entry.key()?.token()?.text),
      fields: Array.from(block.fields()),
    }).toEqual({ entries: ['id', 'Int'], fields: [] });
  });

  it('reports a field attribute as an invalid block member', () => {
    const result = parse('view ActiveUsers {\n  id Int @unique\n}', 'test.psl');
    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_INVALID_EXTENSION_BLOCK_MEMBER']);
  });

  it('parses the same way when the grammar is prisma-8 explicitly', () => {
    const source = 'view ActiveUsers {\n  id Int @unique\n}';
    const explicit = parse(source, 'test.psl', { grammar: 'prisma-8' });
    const implicit = parse(source, 'test.psl');
    expect(printTree(explicit.document.syntax.green)).toBe(
      printTree(implicit.document.syntax.green),
    );
    expect(explicit.diagnostics).toEqual(implicit.diagnostics);
  });
});

describe('a generic block that is not a view or an enum', () => {
  it('reads two bare words on one line as two entries, not as a field', () => {
    const block = onlyGenericBlock('native_enum Level { low high }');
    expect({
      entries: Array.from(block.entries(), (entry) => entry.key()?.token()?.text),
      fields: Array.from(block.fields()),
    }).toEqual({ entries: ['low', 'high'], fields: [] });
  });
});
