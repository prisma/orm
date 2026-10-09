import { describe, expect, it } from 'vitest';
import { type ParseResult, parse } from '../src/parse';
import {
  CompositeTypeDeclarationAst,
  GenericBlockDeclarationAst,
  MixinDeclarationAst,
  MixinInclusionAst,
  ModelDeclarationAst,
  NamespaceDeclarationAst,
} from '../src/syntax/ast/declarations';
import { filterChildren, printSyntax } from '../src/syntax/ast-helpers';
import { type SyntaxNode, SyntaxNode as SyntaxNodeClass } from '../src/syntax/red';
import { printTree } from './support';

const prisma7 = { grammar: 'prisma-7' } as const;

function parseLossless(source: string, options: Parameters<typeof parse>[2] = {}): ParseResult {
  const result = parse(source, 'test.psl', options);
  expect(printSyntax(result.document.syntax)).toBe(source);
  return result;
}

function messages(result: ParseResult): string[] {
  return result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
}

function diagnosedText(result: ParseResult, source: string): string[] {
  const lines = source.split('\n');
  return result.diagnostics.map(({ range }) => {
    expect(range.start.line).toBe(range.end.line);
    return (lines[range.start.line] ?? '').slice(range.start.character, range.end.character);
  });
}

function onlyMixin(result: ParseResult): MixinDeclarationAst {
  const declarations = Array.from(result.document.declarations());
  expect(declarations).toHaveLength(1);
  const [declaration] = declarations;
  if (!(declaration instanceof MixinDeclarationAst)) {
    throw new Error(`expected a mixin declaration, got ${declaration?.syntax.kind}`);
  }
  return declaration;
}

function descendantKinds(node: SyntaxNode): string[] {
  return Array.from(node.childNodes()).flatMap((child) => [child.kind, ...descendantKinds(child)]);
}

function inclusionPaths(
  holder: { inclusions(): Iterable<MixinInclusionAst> } | undefined,
): (readonly string[] | undefined)[] {
  return Array.from(holder?.inclusions() ?? [], (inclusion) => inclusion.name()?.path());
}

describe('a mixin declaration', () => {
  it('parses a model mixin into its own node kind', () => {
    const result = parseLossless('model mixin Timestamps {\n  createdAt DateTime\n}');

    expect(result.diagnostics).toEqual([]);
    expect(printTree(result.document.syntax.green)).toMatchInlineSnapshot(`
      "Document
        MixinDeclaration
          Ident "model"
          Whitespace " "
          Ident "mixin"
          Whitespace " "
          Identifier
            Ident "Timestamps"
          Whitespace " "
          LBrace "{"
          Newline "\\n"
          Whitespace "  "
          FieldDeclaration
            Identifier
              Ident "createdAt"
            Whitespace " "
            TypeAnnotation
              QualifiedName
                Identifier
                  Ident "DateTime"
          Newline "\\n"
          RBrace "}""
    `);
  });

  it('exposes the header and the fields and attributes of a model mixin', () => {
    const source =
      'model mixin Timestamps {\n  createdAt DateTime @default(now())\n  @@index([createdAt])\n}';
    const mixin = onlyMixin(parseLossless(source));

    expect(mixin.keyword()?.text).toBe('model');
    expect(mixin.mixinKeyword()?.text).toBe('mixin');
    expect(mixin.mixinKeyword()?.offset).toBe(source.indexOf('mixin'));
    expect(mixin.name()?.name()).toBe('Timestamps');
    expect(mixin.lbrace()?.offset).toBe(source.indexOf('{'));
    expect(mixin.rbrace()?.offset).toBe(source.lastIndexOf('}'));
    expect(Array.from(mixin.fields(), (field) => field.name()?.name())).toEqual(['createdAt']);
    expect(Array.from(mixin.attributes(), (attribute) => attribute.name()?.path())).toEqual([
      ['index'],
    ]);
    expect(Array.from(mixin.entries())).toEqual([]);
    expect(Array.from(mixin.inclusions())).toEqual([]);
  });

  it('reads a type mixin body as fields', () => {
    const result = parseLossless('type mixin Geo {\n  lat Float\n  lng Float\n}');
    const mixin = onlyMixin(result);

    expect(result.diagnostics).toEqual([]);
    expect(mixin.keyword()?.text).toBe('type');
    expect(mixin.name()?.name()).toBe('Geo');
    expect(Array.from(mixin.fields(), (field) => field.name()?.name())).toEqual(['lat', 'lng']);
  });

  it('reads an enum mixin body as enum members that may carry attributes', () => {
    const result = parseLossless('enum mixin BaseRoles {\n  ADMIN @map("admin")\n  USER\n}');
    const mixin = onlyMixin(result);

    expect(result.diagnostics).toEqual([]);
    expect(mixin.keyword()?.text).toBe('enum');
    expect(mixin.name()?.name()).toBe('BaseRoles');
    expect(
      Array.from(mixin.entries(), (entry) => [
        entry.key()?.name(),
        Array.from(entry.attributes(), (attribute) => attribute.name()?.path()),
      ]),
    ).toEqual([
      ['ADMIN', [['map']]],
      ['USER', []],
    ]);
    expect(Array.from(mixin.fields())).toEqual([]);
  });

  it('reads the body of a mixin for any other keyword as entries and block attributes', () => {
    const result = parseLossless(
      'policy_select mixin OwnerRead {\n  roles = [authenticated]\n  @@map("owner")\n}',
    );
    const mixin = onlyMixin(result);

    expect(result.diagnostics).toEqual([]);
    expect(mixin.keyword()?.text).toBe('policy_select');
    expect(mixin.name()?.name()).toBe('OwnerRead');
    expect(Array.from(mixin.entries(), (entry) => entry.key()?.name())).toEqual(['roles']);
    expect(Array.from(mixin.attributes(), (attribute) => attribute.name()?.path())).toEqual([
      ['map'],
    ]);
  });

  it('rejects an attribute on a member of a mixin for a keyword other than enum', () => {
    const result = parseLossless('policy_select mixin OwnerRead {\n  roles @map("r")\n}');

    expect(messages(result)).toEqual(['PSL_INVALID_EXTENSION_BLOCK_MEMBER: Invalid block entry']);
  });

  it('parses a mixin for each keyword inside a namespace', () => {
    const result = parseLossless(
      [
        'namespace auth {',
        '  model mixin Timestamps {',
        '    createdAt DateTime',
        '  }',
        '  type mixin Geo {',
        '    lat Float',
        '  }',
        '  enum mixin BaseRoles {',
        '    ADMIN',
        '  }',
        '  policy_select mixin OwnerRead {',
        '    roles = [authenticated]',
        '  }',
        '}',
      ].join('\n'),
    );
    const [namespace] = Array.from(result.document.declarations());
    if (!(namespace instanceof NamespaceDeclarationAst)) throw new Error('expected a namespace');
    const members = Array.from(namespace.declarations());

    expect(result.diagnostics).toEqual([]);
    expect(members.every((member) => member instanceof MixinDeclarationAst)).toBe(true);
    expect(members.map((member) => [member.keyword()?.text, member.name()?.name()])).toEqual([
      ['model', 'Timestamps'],
      ['type', 'Geo'],
      ['enum', 'BaseRoles'],
      ['policy_select', 'OwnerRead'],
    ]);
  });

  it('is not cast to a model, composite type or generic block', () => {
    const result = parseLossless(
      'model mixin A {\n}\ntype mixin B {\n}\nenum mixin C {\n}\npolicy mixin D {\n}',
    );
    const nodes = Array.from(result.document.syntax.childNodes());

    expect(nodes.map((node) => node.kind)).toEqual([
      'MixinDeclaration',
      'MixinDeclaration',
      'MixinDeclaration',
      'MixinDeclaration',
    ]);
    expect(
      nodes.map(
        (node) =>
          ModelDeclarationAst.cast(node) ??
          CompositeTypeDeclarationAst.cast(node) ??
          GenericBlockDeclarationAst.cast(node),
      ),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(nodes.map((node) => MixinDeclarationAst.cast(node)?.name()?.name())).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
  });

  it('reads the doc comment above it', () => {
    const mixin = onlyMixin(
      parseLossless(
        '/// Creation and update times.\n/// Shared by all models.\nmodel mixin T {\n}',
      ),
    );

    expect(mixin.docComment()).toBe('Creation and update times.\nShared by all models.');
  });

  it('leaves a field named mixin or typed mixin alone', () => {
    const result = parseLossless('model User {\n  mixin Int\n  other mixin\n  mixin mixin\n}');
    const [model] = Array.from(result.document.declarations());
    if (!(model instanceof ModelDeclarationAst)) throw new Error('expected a model');

    expect(result.diagnostics).toEqual([]);
    expect(
      Array.from(model.fields(), (field) => [
        field.name()?.name(),
        field.typeAnnotation()?.name()?.path(),
      ]),
    ).toEqual([
      ['mixin', ['Int']],
      ['other', ['mixin']],
      ['mixin', ['mixin']],
    ]);
  });

  it('leaves an entry key and an attribute argument spelled mixin alone', () => {
    const result = parseLossless(
      'policy P {\n  mixin = mixin\n}\nmodel M {\n  id Int @default(mixin)\n  @@index([mixin], map: mixin)\n}',
    );

    expect(result.diagnostics).toEqual([]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinDeclaration');
  });
});

describe('a mixin inclusion', () => {
  it('parses a plus and a qualified name as one member node', () => {
    const result = parseLossless('model User {\n  +auth.Timestamps\n}');

    expect(result.diagnostics).toEqual([]);
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
          MixinInclusion
            Plus "+"
            QualifiedName
              Identifier
                Ident "auth"
              Dot "."
              Identifier
                Ident "Timestamps"
          Newline "\\n"
          RBrace "}""
    `);
  });

  it('exposes the plus token and the name', () => {
    const source = 'model User {\n  +auth.Timestamps\n}';
    const [model] = Array.from(parseLossless(source).document.declarations());
    if (!(model instanceof ModelDeclarationAst)) throw new Error('expected a model');
    const [inclusion] = Array.from(model.inclusions());

    expect(inclusion?.plus()?.offset).toBe(source.indexOf('+'));
    expect(inclusion?.name()?.path()).toEqual(['auth', 'Timestamps']);
    expect(inclusion?.name()?.namespace()?.name()).toBe('auth');
    expect(inclusion?.name()?.identifier()?.name()).toBe('Timestamps');
  });

  it('is a member of a model, between fields and block attributes', () => {
    const result = parseLossless(
      'model User {\n  id Int @id\n  +Timestamps\n  +auth.Audited\n  name String\n  @@map("users")\n}',
    );
    const [model] = Array.from(result.document.declarations());
    if (!(model instanceof ModelDeclarationAst)) throw new Error('expected a model');

    expect(result.diagnostics).toEqual([]);
    expect(inclusionPaths(model)).toEqual([['Timestamps'], ['auth', 'Audited']]);
    expect(Array.from(model.fields(), (field) => field.name()?.name())).toEqual(['id', 'name']);
    expect(Array.from(model.attributes(), (attribute) => attribute.name()?.path())).toEqual([
      ['map'],
    ]);
    expect(Array.from(model.members(), (member) => member.syntax.kind)).toEqual([
      'FieldDeclaration',
      'FieldDeclaration',
      'ModelAttribute',
    ]);
  });

  it('is a member of a composite type', () => {
    const result = parseLossless('type Address {\n  +Geo\n  +shared.Postal\n  street String\n}');
    const [composite] = Array.from(result.document.declarations());
    if (!(composite instanceof CompositeTypeDeclarationAst)) throw new Error('expected a type');

    expect(result.diagnostics).toEqual([]);
    expect(inclusionPaths(composite)).toEqual([['Geo'], ['shared', 'Postal']]);
    expect(Array.from(composite.fields(), (field) => field.name()?.name())).toEqual(['street']);
  });

  it('is a member of an enum block', () => {
    const result = parseLossless('enum Role {\n  +BaseRoles\n  +auth.StaffRoles\n  GUEST\n}');
    const [block] = Array.from(result.document.declarations());
    if (!(block instanceof GenericBlockDeclarationAst)) throw new Error('expected a block');

    expect(result.diagnostics).toEqual([]);
    expect(inclusionPaths(block)).toEqual([['BaseRoles'], ['auth', 'StaffRoles']]);
    expect(Array.from(block.entries(), (entry) => entry.key()?.name())).toEqual(['GUEST']);
    expect(Array.from(block.members(), (member) => member.syntax.kind)).toEqual(['KeyValuePair']);
  });

  it('is a member of a key = value block', () => {
    const result = parseLossless(
      'policy_select ReadPosts {\n  +OwnerRead\n  +auth.StaffRead\n  using = "true"\n}',
    );
    const [block] = Array.from(result.document.declarations());
    if (!(block instanceof GenericBlockDeclarationAst)) throw new Error('expected a block');

    expect(result.diagnostics).toEqual([]);
    expect(inclusionPaths(block)).toEqual([['OwnerRead'], ['auth', 'StaffRead']]);
    expect(Array.from(block.entries(), (entry) => entry.key()?.name())).toEqual(['using']);
  });

  it('is a member of a model, an enum and a key = value mixin body', () => {
    const result = parseLossless(
      [
        'model mixin A {',
        '  +Base',
        '  +ns.Other',
        '  id Int',
        '}',
        'enum mixin B {',
        '  +Base',
        '  +ns.Other',
        '  X',
        '}',
        'policy mixin C {',
        '  +Base',
        '  +ns.Other',
        '  k = 1',
        '}',
      ].join('\n'),
    );
    const mixins = Array.from(filterChildren(result.document.syntax, MixinDeclarationAst.cast));

    expect(result.diagnostics).toEqual([]);
    expect(mixins.map(inclusionPaths)).toEqual([
      [['Base'], ['ns', 'Other']],
      [['Base'], ['ns', 'Other']],
      [['Base'], ['ns', 'Other']],
    ]);
  });

  it('is read wherever a member may start, on the same line as other members', () => {
    const only = parseLossless('model User { +Timestamps }');
    const afterField = parseLossless('model User { id Int +Timestamps name String }');
    const inEntryBlock = parseLossless('policy P { k = 1 +Shared j = 2 }');
    const inEnum = parseLossless('enum Role { ADMIN +auth.BaseRoles USER }');

    for (const result of [only, afterField, inEntryBlock, inEnum]) {
      expect(result.diagnostics).toEqual([]);
    }
    expect(
      [only, afterField, inEntryBlock, inEnum].map((result) =>
        Array.from(result.document.syntax.descendants())
          .filter((element): element is SyntaxNode => element instanceof SyntaxNodeClass)
          .flatMap((node) => MixinInclusionAst.cast(node)?.name()?.path() ?? [])
          .join('.'),
      ),
    ).toEqual(['Timestamps', 'Timestamps', 'Shared', 'auth.BaseRoles']);
    const [model] = Array.from(afterField.document.declarations());
    if (!(model instanceof ModelDeclarationAst)) throw new Error('expected a model');
    expect(Array.from(model.fields(), (field) => field.name()?.name())).toEqual(['id', 'name']);
  });

  it('is read after a comment line and after indentation', () => {
    const result = parseLossless('model User {\n  // shared columns\n\t  +Timestamps\n}');
    const [model] = Array.from(result.document.declarations());
    if (!(model instanceof ModelDeclarationAst)) throw new Error('expected a model');

    expect(result.diagnostics).toEqual([]);
    expect(inclusionPaths(model)).toEqual([['Timestamps']]);
  });

  it('is not a member of a types block or a namespace', () => {
    const typesBlock = parseLossless('types {\n  +Shared\n}');
    const namespace = parseLossless('namespace app {\n  +Shared\n}');

    expect(messages(typesBlock)).toEqual([
      'PSL_INVALID_TYPES_MEMBER: Invalid types declaration "+"',
    ]);
    expect(messages(namespace)).toEqual([
      'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK: Unsupported top-level declaration "+"',
    ]);
    expect(descendantKinds(typesBlock.document.syntax)).not.toContain('MixinInclusion');
    expect(descendantKinds(namespace.document.syntax)).not.toContain('MixinInclusion');
  });
});

describe('the reserved word mixin in a block header', () => {
  it('rejects mixin as a block keyword', () => {
    const source = 'mixin X {\n  a = 1\n}';
    const result = parseLossless(source);

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: A mixin starts with the keyword of the block it is for, for example "model mixin X"',
    ]);
    expect(diagnosedText(result, source)).toEqual(['mixin']);
    expect(Array.from(result.document.syntax.childNodes(), (node) => node.kind)).toEqual([
      'GenericBlockDeclaration',
    ]);
  });

  it.each([
    ['model', 'model mixin {\n  id Int\n}'],
    ['type', 'type mixin {\n  lat Float\n}'],
    ['enum', 'enum mixin {\n  ADMIN\n}'],
    ['policy_select', 'policy_select mixin {\n  roles = [a]\n}'],
  ])('rejects mixin as the name of a %s block', (keyword, source) => {
    const result = parseLossless(source);
    const mixin = onlyMixin(result);

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: Expected a mixin name after "mixin"',
    ]);
    expect(diagnosedText(result, source)).toEqual(['mixin']);
    expect(mixin.keyword()?.text).toBe(keyword);
    expect(mixin.name()).toBeUndefined();
    expect(mixin.rbrace()).toBeDefined();
  });

  it.each([
    ['namespace', 'namespace mixin X {\n  model A {\n    id Int\n  }\n}'],
    ['types', 'types mixin X {\n  Email = String\n}'],
  ])('rejects a mixin for %s', (keyword, source) => {
    const result = parseLossless(source);
    const mixin = onlyMixin(result);

    expect(messages(result)).toEqual([
      `PSL_INVALID_DECLARATION: A mixin cannot be declared for "${keyword}"`,
    ]);
    expect(diagnosedText(result, source)).toEqual([keyword]);
    expect(mixin.name()?.name()).toBe('X');
    expect(mixin.rbrace()).toBeDefined();
  });

  it('reports only the keyword diagnostic for mixin as a keyword with no body', () => {
    const result = parseLossless('mixin X');

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: A mixin starts with the keyword of the block it is for, for example "model mixin X"',
    ]);
  });

  it('reports only the keyword diagnostic for a mixin whose block keyword is mixin', () => {
    const source = 'mixin mixin X {\n  a = 1\n}';
    const result = parseLossless(source);

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: A mixin starts with the keyword of the block it is for, for example "model mixin X"',
    ]);
    expect(result.diagnostics[0]?.range.start).toEqual({ line: 0, character: 0 });
    expect(Array.from(onlyMixin(result).entries(), (entry) => entry.key()?.name())).toEqual(['a']);
  });

  it('rejects a namespace named mixin', () => {
    const source = 'namespace mixin {\n  model A {\n    id Int\n  }\n}';
    const result = parseLossless(source);

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: A mixin cannot be declared for "namespace"',
    ]);
    expect(Array.from(result.document.declarations(), (d) => d.syntax.kind)).toEqual([
      'MixinDeclaration',
    ]);
  });

  it('reports only the mixin diagnostic for a namespace mixin inside a namespace', () => {
    const result = parseLossless('namespace app {\n  namespace mixin X {\n  }\n}');

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: A mixin cannot be declared for "namespace"',
    ]);
  });
});

describe('malformed mixin input', () => {
  it('reads a signed number in an attribute argument', () => {
    const result = parseLossless(
      'model User {\n  id Int @default(+1)\n  ratio Float @default(+1.5)\n}',
    );

    expect(result.diagnostics).toEqual([]);
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinInclusion');
  });

  it.each([
    ['a brace', 'model User {\n  + {\n  id Int\n}', ['id']],
    ['an attribute', 'model User {\n  +@id\n  id Int\n}', ['id']],
    ['the end of the body', 'model User {\n  id Int\n  +\n}', ['id']],
    ['the closing brace on the same line', 'model User {\n  id Int\n  + }', ['id']],
    ['a name on the next line', 'model User {\n  +\n  id Int\n}', ['id']],
  ])('reports an inclusion with no name before %s', (_case, source, fields) => {
    const result = parseLossless(source);
    const [model] = Array.from(result.document.declarations());
    if (!(model instanceof ModelDeclarationAst)) throw new Error('expected a model');
    const inclusions = Array.from(model.inclusions());

    expect(messages(result)).toEqual(['PSL_INVALID_MODEL_MEMBER: Expected a mixin name after "+"']);
    expect(diagnosedText(result, source)).toEqual(['+']);
    expect(inclusions).toHaveLength(1);
    expect(inclusions[0]?.plus()?.text).toBe('+');
    expect(inclusions[0]?.name()).toBeUndefined();
    expect(Array.from(model.fields(), (field) => field.name()?.name())).toEqual(fields);
    expect(model.rbrace()).toBeDefined();
  });

  it('reports an inclusion with no name in an enum and in a key = value block', () => {
    const result = parseLossless('enum Role {\n  +\n  ADMIN\n}\npolicy P {\n  + = 1\n  k = 2\n}');
    const blocks = Array.from(
      filterChildren(result.document.syntax, GenericBlockDeclarationAst.cast),
    );

    expect(messages(result)).toEqual([
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER: Expected a mixin name after "+"',
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER: Expected a mixin name after "+"',
    ]);
    expect(
      blocks.map((block) => Array.from(block.entries(), (entry) => entry.key()?.name())),
    ).toEqual([['ADMIN'], ['k']]);
  });

  it('reports a missing mixin name at the end of the file', () => {
    const source = 'model mixin';
    const result = parseLossless(source);

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: Expected a mixin name after "mixin"',
    ]);
    expect(diagnosedText(result, source)).toEqual(['mixin']);
    expect(onlyMixin(result).name()).toBeUndefined();
  });

  it('reports a missing opening brace after the mixin name', () => {
    const result = parseLossless('model mixin X');
    const mixin = onlyMixin(result);

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: Expected "{" to open the "model mixin" block',
    ]);
    expect(result.diagnostics[0]?.range).toEqual({
      start: { line: 0, character: 13 },
      end: { line: 0, character: 13 },
    });
    expect(mixin.name()?.name()).toBe('X');
    expect(mixin.lbrace()).toBeUndefined();
  });

  it('does not take the next declaration for the name of an unfinished header', () => {
    const result = parseLossless('enum mixin\nmodel User {\n  id Int\n}');
    const kinds = Array.from(result.document.syntax.childNodes(), (node) => node.kind);

    expect(messages(result)).toEqual([
      'PSL_INVALID_DECLARATION: Expected a mixin name after "mixin"',
    ]);
    expect(kinds).toEqual(['MixinDeclaration', 'ModelDeclaration']);
  });

  it('reports an unterminated mixin body', () => {
    const result = parseLossless('model mixin X {\n  id Int\n');

    expect(messages(result)).toEqual(['PSL_UNTERMINATED_BLOCK: Unterminated block declaration']);
    expect(Array.from(onlyMixin(result).fields(), (field) => field.name()?.name())).toEqual(['id']);
  });
});

describe('the prisma-7 grammar', () => {
  it('reads model mixin { } as a model named mixin', () => {
    const result = parseLossless('model mixin {\n  id Int\n}', prisma7);
    const models = Array.from(filterChildren(result.document.syntax, ModelDeclarationAst.cast));

    expect(result.diagnostics).toEqual([]);
    expect(models.map((model) => model.name()?.name())).toEqual(['mixin']);
  });

  it('reads mixin X { } as a generic block', () => {
    const result = parseLossless('mixin X {\n  a = 1\n}', prisma7);
    const blocks = Array.from(
      filterChildren(result.document.syntax, GenericBlockDeclarationAst.cast),
    );

    expect(result.diagnostics).toEqual([]);
    expect(blocks.map((block) => [block.keyword()?.text, block.name()?.name()])).toEqual([
      ['mixin', 'X'],
    ]);
  });

  it('reads a namespace named mixin as a namespace', () => {
    const result = parseLossless('namespace mixin {\n  model A {\n    id Int\n  }\n}', prisma7);
    const [namespace] = Array.from(result.document.declarations());

    expect(result.diagnostics).toEqual([]);
    expect(namespace).toBeInstanceOf(NamespaceDeclarationAst);
  });

  it('reports model mixin X { as a model with a missing brace', () => {
    const result = parseLossless('model mixin X {\n  id Int\n}', prisma7);

    expect(messages(result)[0]).toBe(
      'PSL_INVALID_DECLARATION: Expected "{" to open the "model" block',
    );
    expect(descendantKinds(result.document.syntax)).not.toContain('MixinDeclaration');
  });

  it('reports a member that starts with a plus as an invalid member', () => {
    const model = parseLossless('model User {\n  +Timestamps\n  id Int\n}', prisma7);
    const enumBlock = parseLossless('enum Role {\n  +BaseRoles\n  ADMIN\n}', prisma7);

    expect(messages(model)).toEqual([
      'PSL_INVALID_MODEL_MEMBER: Invalid model member declaration "+"',
    ]);
    expect(messages(enumBlock)).toEqual([
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER: Invalid block entry',
    ]);
    expect(descendantKinds(model.document.syntax)).not.toContain('MixinInclusion');
    expect(descendantKinds(enumBlock.document.syntax)).not.toContain('MixinInclusion');
  });
});
