import type {
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '@internal/framework-components/authoring';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { leafDiagnostic } from '../src/attribute-spec/combinators/diagnostic';
import { str } from '../src/attribute-spec/combinators/str';
import { validateExtensionBlockFromSymbol } from '../src/extension-block';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import {
  CompositeTypeDeclarationAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
} from '../src/syntax/ast/declarations';

const emptyCodecLookup: CodecLookup = {
  get: (): Codec | undefined => undefined,
  targetTypesFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

function build(source: string, pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {}) {
  const { document, sourceFile } = parse(source);
  return buildSymbolTable({ document, sourceFile, pslBlockDescriptors });
}

describe('buildSymbolTable() — AC1 fault tolerance', () => {
  it('never throws on malformed input and returns its own duplicate diagnostics', () => {
    const source = [
      'model User {',
      '  id Int',
      '}',
      'model User {',
      '  id Int',
      '}',
      'types {',
      '  Email = Mystery',
      '}',
      'model Dangling {',
      '  id Int',
    ].join('\n');

    const result = build(source);

    expect(result.diagnostics.every((d) => d.code === 'PSL_DUPLICATE_DECLARATION')).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(Object.keys(result.table.topLevel.models)).toEqual(['User', 'Dangling']);
    expect(result.table.topLevel.namedTypes['Email']?.kind).toBe('namedType');
  });
});

describe('buildSymbolTable() — AC2 top-level kinds', () => {
  it('classifies each top-level declaration by kind', () => {
    const source = [
      'model User {',
      '  id Int',
      '}',
      'type Address {',
      '  street String',
      '}',
      'policy Strict {',
      '  on = read',
      '}',
      'types {',
      '  Email = String',
      '  UserId = User',
      '}',
    ].join('\n');

    const result = build(source);
    const { topLevel } = result.table;

    expect(topLevel.models['User']?.kind).toBe('model');
    expect(topLevel.models['User']?.node).toBeInstanceOf(ModelDeclarationAst);
    expect(topLevel.compositeTypes['Address']?.kind).toBe('compositeType');
    expect(topLevel.compositeTypes['Address']?.node).toBeInstanceOf(CompositeTypeDeclarationAst);
    expect(topLevel.blocks['Strict']?.kind).toBe('block');
    expect(topLevel.blocks['Strict']?.keyword).toBe('policy');
    expect(topLevel.blocks['Strict']?.node).toBeInstanceOf(GenericBlockDeclarationAst);

    expect(topLevel.namedTypes['Email']?.kind).toBe('namedType');
    expect(topLevel.namedTypes['Email']?.node).toBeInstanceOf(NamedTypeDeclarationAst);
    expect(topLevel.namedTypes['UserId']?.kind).toBe('namedType');
    expect(result.diagnostics).toEqual([]);
  });
});

describe('buildSymbolTable() — AC3 namespace nesting', () => {
  it('nests namespace members under the namespace, not at top level', () => {
    const source = ['namespace Foo {', '  model A {', '    id Int', '  }', '}'].join('\n');

    const result = build(source);
    const { topLevel } = result.table;

    expect(topLevel.namespaces['Foo']?.kind).toBe('namespace');
    expect(topLevel.namespaces['Foo']?.node).toBeInstanceOf(NamespaceDeclarationAst);
    expect(topLevel.namespaces['Foo']?.models['A']?.kind).toBe('model');
    expect(topLevel.models['A']).toBeUndefined();
  });
});

describe('buildSymbolTable() — namespace reopening', () => {
  const policy: AuthoringPslBlockDescriptor = {
    kind: 'pslBlock',
    keyword: 'policy',
    discriminator: 'fixture-policy',
    name: { required: true },
    parameters: {
      target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
    },
  };
  const descriptors = { policy };
  const wrap = (body: string, name = 'blog') => `namespace ${name} {\n${body}\n}`;
  const members = [
    'model Article {\n  id Int @id\n  address Address?\n}',
    'type Address {\n  street String\n}',
    'policy ReadArticles {\n  target = Article\n}',
    'policy WriteArticles {\n  target = Article\n}',
  ];

  function collect(source: string) {
    const parsed = parse(source);
    expect(parsed.diagnostics).toEqual([]);
    return {
      ...parsed,
      ...buildSymbolTable({ ...parsed, pslBlockDescriptors: descriptors }),
    };
  }

  function semantics(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(semantics);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== 'node' && key !== 'span')
          .map(([key, child]) => [key, semantics(child)]),
      );
    }
    return value;
  }

  it('collects consolidated, split and reversed blocks with original declaration provenance', () => {
    const consolidated = collect(wrap(members.join('\n')));
    expect(consolidated.diagnostics).toEqual([]);
    for (const ordered of [members, [...members].reverse()]) {
      const source = [
        wrap(ordered[0] ?? ''),
        wrap('model Other {\n id Int\n}', 'elsewhere'),
        ...ordered.slice(1).map((member) => wrap(member)),
        wrap(''),
        wrap('model CaseDistinct {\n id Int\n}', 'Blog'),
      ].join('\n');
      const result = collect(source);
      expect(result.diagnostics).toEqual([]);
      const namespace = result.table.topLevel.namespaces['blog'];
      expect(semantics(namespace)).toEqual(
        semantics(consolidated.table.topLevel.namespaces['blog']),
      );
      expect(Object.keys(result.table.topLevel.namespaces)).toEqual(['blog', 'elsewhere', 'Blog']);
      const nodes = [...result.document.declarations()]
        .filter((node) => node instanceof NamespaceDeclarationAst)
        .filter((node) => node.name()?.name() === 'blog');
      expect(namespace?.node.syntax.green).toBe(nodes[0]?.syntax.green);
      expect(namespace?.node.syntax.offset).toBe(nodes[0]?.syntax.offset);
      for (const node of nodes) {
        for (const member of node.declarations()) {
          const name = member.name()?.name() ?? '';
          const symbol =
            namespace?.models[name] ?? namespace?.compositeTypes[name] ?? namespace?.blocks[name];
          expect(symbol?.node.syntax.green).toBe(member.syntax.green);
          expect(symbol?.node.syntax.offset).toBe(member.syntax.offset);
          expect(symbol?.span).toEqual({
            start: {
              offset: member.syntax.offset,
              line: result.sourceFile.positionAt(member.syntax.offset).line + 1,
              column: result.sourceFile.positionAt(member.syntax.offset).character + 1,
            },
            end: {
              offset: member.syntax.offset + member.syntax.green.textLength,
              line:
                result.sourceFile.positionAt(member.syntax.offset + member.syntax.green.textLength)
                  .line + 1,
              column:
                result.sourceFile.positionAt(member.syntax.offset + member.syntax.green.textLength)
                  .character + 1,
            },
          });
        }
      }
    }
  });

  it.each(['model-first', 'block-first', 'other-namespace'])(
    'resolves same-namespace references: %s',
    (order) => {
      const model = wrap(members[0] ?? '', order === 'other-namespace' ? 'elsewhere' : 'blog');
      const blockSource = wrap(members[2] ?? '');
      const result = collect(
        (order === 'model-first' ? [model, blockSource] : [blockSource, model]).join('\n'),
      );
      expect(result.diagnostics).toEqual([]);
      const block = result.table.topLevel.namespaces['blog']?.blocks['ReadArticles'];
      expect(block).toBeDefined();
      if (block === undefined) throw new Error('Missing policy block');
      const diagnostics = validateExtensionBlockFromSymbol({
        block,
        descriptor: policy,
        symbolTable: result.table,
        sourceFile: result.sourceFile,
        sourceId: 'schema.prisma',
        codecLookup: emptyCodecLookup,
      });
      if (order === 'other-namespace') {
        expect(diagnostics).toEqual([
          expect.objectContaining({ code: 'PSL_EXTENSION_UNRESOLVED_REF' }),
        ]);
      } else {
        expect(diagnostics).toEqual([]);
      }
    },
  );

  const kinds = ['model', 'type', 'policy'] as const;
  const declaration = (kind: (typeof kinds)[number], body: string) =>
    `${kind} Shared {\n  ${kind === 'policy' ? `target = ${body}` : `${body} Int`}\n}`;

  it.each(
    kinds.flatMap((first) =>
      kinds.flatMap((later) => ['first', 'other'].map((body) => ({ first, later, body }))),
    ),
  )('keeps the whole first $first against later $later ($body)', ({ first, later, body }) => {
    const initial = wrap(declaration(first, 'first'));
    const source = `${initial}\n${wrap(declaration(later, body))}`;
    const result = collect(source);
    const offset = source.lastIndexOf('Shared');
    expect(result.diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "Shared"',
        range: {
          start: result.sourceFile.positionAt(offset),
          end: result.sourceFile.positionAt(offset + 'Shared'.length),
        },
      },
    ]);
    expect(semantics(result.table)).toEqual(semantics(collect(initial).table));
  });

  it.each(
    ['Shared', '__proto__'].flatMap((name) =>
      ['model', 'type', 'policy', 'binding'].flatMap((kind) =>
        [true, false].map((namespaceFirst) => ({ name, kind, namespaceFirst })),
      ),
    ),
  )(
    'preserves top-level $kind $name collision (namespace first: $namespaceFirst)',
    ({ name, kind, namespaceFirst }) => {
      const namespace = wrap('model Inside {\n id Int\n}', name);
      const other = kind === 'binding' ? `types {\n ${name} = String\n}` : `${kind} ${name} {\n}`;
      const first = namespaceFirst ? namespace : other;
      const source = `${first}\n${namespaceFirst ? other : namespace}`;
      const result = collect(source);
      const offset = source.lastIndexOf(name);
      expect(result.diagnostics).toEqual([
        {
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${name}"`,
          range: {
            start: result.sourceFile.positionAt(offset),
            end: result.sourceFile.positionAt(offset + name.length),
          },
        },
      ]);
      expect(semantics(result.table)).toEqual(semantics(collect(first).table));
      expect(Object.keys(result.table.topLevel.namespaces)).toEqual(namespaceFirst ? [name] : []);
    },
  );

  it.each(['consolidated', 'split', 'reversed'])(
    'collects __proto__ as one enumerable namespace: %s',
    (form) => {
      const first = 'model A {\n id Int\n}';
      const second = 'model B {\n id Int\n}';
      const consolidated = collect(wrap(`${first}\n${second}`, '__proto__'));
      const source =
        form === 'consolidated'
          ? wrap(`${first}\n${second}`, '__proto__')
          : (form === 'split' ? [first, second] : [second, first])
              .map((member) => wrap(member, '__proto__'))
              .join('\n');
      const result = collect(source);
      expect(result.diagnostics).toEqual([]);
      expect(Object.keys(result.table.topLevel.namespaces)).toEqual(['__proto__']);
      expect(
        Object.keys(Object.values(result.table.topLevel.namespaces)[0]?.models ?? {}).sort(),
      ).toEqual(['A', 'B']);
      expect(semantics(result.table)).toEqual(semantics(consolidated.table));
    },
  );

  it('retains duplicate detection for names inherited by object dictionaries', () => {
    const result = collect(wrap('model __proto__ {\n}\nmodel __proto__ {\n}'));
    expect(result.diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "__proto__"',
        range: { start: { line: 3, character: 6 }, end: { line: 3, character: 15 } },
      },
    ]);
  });

  it('retains field and parameter errors in later distinct members', () => {
    const result = collect(
      [
        wrap(members[0] ?? ''),
        wrap('model Later {\n value String\n value Int\n}'),
        wrap('type LaterType {\n value String\n value Int\n}'),
        wrap('policy LaterPolicy {\n target = Article\n target = Other\n}'),
      ].join('\n'),
    );
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'PSL_DUPLICATE_DECLARATION',
      'PSL_DUPLICATE_DECLARATION',
      'PSL_EXTENSION_DUPLICATE_PARAMETER',
    ]);
    const namespace = result.table.topLevel.namespaces['blog'];
    expect(namespace?.models['Later']?.fields['value']?.typeName).toBe('String');
    expect(namespace?.compositeTypes['LaterType']?.fields['value']?.typeName).toBe('String');
    expect(namespace?.blocks['LaterPolicy']?.block.parameters['target']).toMatchObject({
      kind: 'ref',
      identifier: 'Article',
    });
  });
});

describe('buildSymbolTable() — AC4 field nesting', () => {
  it('keys fields by name and back-references the FieldDeclarationAst', () => {
    const source = ['model User {', '  id Int', '  email String', '}'].join('\n');

    const result = build(source);
    const fields = result.table.topLevel.models['User']?.fields ?? {};

    expect(Object.keys(fields)).toEqual(['id', 'email']);
    expect(fields['email']?.kind).toBe('field');
    expect(fields['email']?.name).toBe('email');
    expect(fields['email']?.node).toBeInstanceOf(FieldDeclarationAst);
  });
});

describe('buildSymbolTable() — AC5 duplicate detection', () => {
  it('keeps the first top-level declaration and flags the later one', () => {
    const source = ['model User {', '  id Int', '}', 'model User {', '  other Int', '}'].join('\n');

    const result = build(source);

    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_DUPLICATE_DECLARATION']);
    const first = result.table.topLevel.models['User'];
    expect(Object.keys(first?.fields ?? {})).toEqual(['id']);
  });

  it('detects duplicates within a single namespace body', () => {
    const source = [
      'namespace Foo {',
      '  model User {',
      '    id Int',
      '  }',
      '  model User {',
      '    other Int',
      '  }',
      '}',
    ].join('\n');

    const result = build(source);

    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_DUPLICATE_DECLARATION']);
    const nested = result.table.topLevel.namespaces['Foo']?.models['User'];
    expect(Object.keys(nested?.fields ?? {})).toEqual(['id']);
  });

  it('collides regardless of kind: model User + type User', () => {
    const source = ['model User {', '  id Int', '}', 'type User {', '  street String', '}'].join(
      '\n',
    );

    const result = build(source);

    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_DUPLICATE_DECLARATION']);
    expect(result.table.topLevel.models['User']?.kind).toBe('model');
    expect(result.table.topLevel.compositeTypes['User']).toBeUndefined();
  });

  it('anchors the duplicate diagnostic on the later declaration name span', () => {
    const source = ['model User {', '}', 'model User {', '}'].join('\n');

    const result = build(source);
    const diagnostic = result.diagnostics[0];

    expect(diagnostic?.code).toBe('PSL_DUPLICATE_DECLARATION');
    expect(diagnostic?.range.start.line).toBe(2);
    expect(diagnostic?.range.start.character).toBe(6);
    expect(diagnostic?.range.end.character).toBe(10);
  });

  it('keeps the first model field and flags the later duplicate field', () => {
    const source = ['model User {', '  email String', '  email Int', '}'].join('\n');

    const result = build(source);

    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_DUPLICATE_DECLARATION']);
    expect(result.diagnostics[0]?.range.start.line).toBe(2);
    expect(result.diagnostics[0]?.range.start.character).toBe(2);
    expect(Object.keys(result.table.topLevel.models['User']?.fields ?? {})).toEqual(['email']);
    expect(result.table.topLevel.models['User']?.fields['email']?.typeName).toBe('String');
  });

  it('keeps the first composite field and flags the later duplicate field', () => {
    const source = ['type Address {', '  street String', '  street Int', '}'].join('\n');

    const result = build(source);

    expect(result.diagnostics.map((d) => d.code)).toEqual(['PSL_DUPLICATE_DECLARATION']);
    expect(Object.keys(result.table.topLevel.compositeTypes['Address']?.fields ?? {})).toEqual([
      'street',
    ]);
    expect(result.table.topLevel.compositeTypes['Address']?.fields['street']?.typeName).toBe(
      'String',
    );
  });
});

describe('buildSymbolTable() — pre-investigated edge cases', () => {
  it('collects a constructor binding as a namedType without classifying it', () => {
    const source = ['types {', '  Embedding = Vector(1536)', '}'].join('\n');

    const result = build(source);

    expect(result.table.topLevel.namedTypes['Embedding']?.kind).toBe('namedType');
    expect(result.table.topLevel.namedTypes['Embedding']?.isConstructor).toBe(true);
  });

  it('skips a nameless recovered declaration without diagnostic or throw', () => {
    const source = 'model {\n  id Int\n}';

    const result = build(source);

    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.table.topLevel.models)).toEqual([]);
  });
});

describe('buildSymbolTable() — resolved field shape', () => {
  it('splits a bare type onto typeName with no qualifiers', () => {
    const result = build(['model User {', '  name String', '}'].join('\n'));
    const field = result.table.topLevel.models['User']?.fields['name'];

    expect(field?.typeName).toBe('String');
    expect(field?.typeNamespaceId).toBeUndefined();
    expect(field?.typeContractSpaceId).toBeUndefined();
    expect(field?.optional).toBe(false);
    expect(field?.list).toBe(false);
    expect(field?.malformedType).toBeUndefined();
  });

  it('splits a dot-qualified type onto typeName + typeNamespaceId', () => {
    const result = build(['model Profile {', '  user auth.User', '}'].join('\n'));
    const field = result.table.topLevel.models['Profile']?.fields['user'];

    expect(field?.typeName).toBe('User');
    expect(field?.typeNamespaceId).toBe('auth');
    expect(field?.typeContractSpaceId).toBeUndefined();
  });

  it('splits a colon-qualified type onto typeName + typeNamespaceId + typeContractSpaceId', () => {
    const result = build(['model Profile {', '  user supabase:auth.User', '}'].join('\n'));
    const field = result.table.topLevel.models['Profile']?.fields['user'];

    expect(field?.typeName).toBe('User');
    expect(field?.typeNamespaceId).toBe('auth');
    expect(field?.typeContractSpaceId).toBe('supabase');
  });

  it('flags an over-qualified type with PSL_INVALID_QUALIFIED_TYPE and malformedType', () => {
    const result = build(['model Profile {', '  user a.b.c', '}'].join('\n'));
    const field = result.table.topLevel.models['Profile']?.fields['user'];

    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_QUALIFIED_TYPE');
    expect(field?.malformedType).toBe(true);
    expect(field?.typeName).toBe('c');
  });

  it('derives optional and list modifiers', () => {
    const result = build(['model User {', '  nickname String?', '  tags String[]', '}'].join('\n'));
    const fields = result.table.topLevel.models['User']?.fields ?? {};

    expect(fields['nickname']?.optional).toBe(true);
    expect(fields['nickname']?.list).toBe(false);
    expect(fields['tags']?.optional).toBe(false);
    expect(fields['tags']?.list).toBe(true);
  });

  it('resolves a constructor field type onto typeConstructor', () => {
    const result = build(['model Doc {', '  embedding Vector(1536)', '}'].join('\n'));
    const field = result.table.topLevel.models['Doc']?.fields['embedding'];

    expect(field?.typeConstructor?.path).toEqual(['Vector']);
    expect(field?.typeConstructor?.args.map((a) => a.value)).toEqual(['1536']);
  });

  it('renders field attributes with dotted names and verbatim arg values', () => {
    const result = build(
      [
        'model User {',
        '  id Int @id @extension.VarChar(255)',
        '  name String @map("full_name")',
        '}',
      ].join('\n'),
    );
    const id = result.table.topLevel.models['User']?.fields['id'];
    const name = result.table.topLevel.models['User']?.fields['name'];

    expect(id?.attributes.map((a) => a.name)).toEqual(['id', 'extension.VarChar']);
    const extensionAttr = id?.attributes.find((a) => a.name === 'extension.VarChar');
    expect(extensionAttr?.args.map((a) => ({ kind: a.kind, value: a.value }))).toEqual([
      { kind: 'positional', value: '255' },
    ]);
    const mapAttr = name?.attributes.find((a) => a.name === 'map');
    expect(mapAttr?.args[0]?.value).toBe('"full_name"');
  });

  it('renders function-call, array-literal, and object-literal arg values verbatim', () => {
    const result = build(
      [
        'model M {',
        '  id String @default(uuid(7))',
        '  @@index([firstName, lastName])',
        '  @@index([title], options: { tokenizer: "ngram" })',
        '}',
      ].join('\n'),
    );
    const model = result.table.topLevel.models['M'];

    const fnArg = model?.fields['id']?.attributes.find((a) => a.name === 'default')?.args[0];
    expect(fnArg?.value).toBe('uuid(7)');

    const arrayArg = model?.attributes[0]?.args[0];
    expect(arrayArg).toMatchObject({ kind: 'positional', value: '[firstName, lastName]' });

    const objectArg = model?.attributes[1]?.args.find((a) => a.name === 'options');
    expect(objectArg).toMatchObject({
      kind: 'named',
      name: 'options',
      value: '{ tokenizer: "ngram" }',
    });
  });

  it('renders named attribute args with their argument name', () => {
    const result = build(
      [
        'model Post {',
        '  authorId Int',
        '  author User @relation(fields: [authorId], references: [id])',
        '}',
      ].join('\n'),
    );
    const author = result.table.topLevel.models['Post']?.fields['author'];
    const relation = author?.attributes.find((a) => a.name === 'relation');

    expect(relation?.args).toEqual([
      expect.objectContaining({ kind: 'named', name: 'fields', value: '[authorId]' }),
      expect.objectContaining({ kind: 'named', name: 'references', value: '[id]' }),
    ]);
  });
});

describe('buildSymbolTable() — resolved declaration spans', () => {
  it('carries each symbol span as the node span (relocated from the deleted view)', () => {
    const result = build(
      ['model User {', '  id Int', '}', 'type Address {', '  street String', '}'].join('\n'),
    );
    const { sourceFile } = parse(
      ['model User {', '  id Int', '}', 'type Address {', '  street String', '}'].join('\n'),
    );

    const model = result.table.topLevel.models['User'];
    const expectedModelStart = sourceFile.offsetAt({ line: 0, character: 0 });
    expect(model?.span.start.offset).toBe(expectedModelStart);
    expect(model?.span.start.line).toBe(1); // 1-based PslSpan
    expect(model?.span.start.column).toBe(1);

    const field = model?.fields['id'];
    expect(field?.span.start.line).toBe(2);
    expect(field?.span.start.column).toBe(3);

    const composite = result.table.topLevel.compositeTypes['Address'];
    expect(composite?.span.start.line).toBe(4);
    expect(composite?.span.start.column).toBe(1);
  });
});

describe('buildSymbolTable() — resolved model/composite attributes', () => {
  it('resolves model-level and composite-level attributes', () => {
    const result = build(
      [
        'model User {',
        '  id Int',
        '  @@map("users")',
        '}',
        'type Address {',
        '  street String',
        '  @@map("addr")',
        '}',
      ].join('\n'),
    );

    const model = result.table.topLevel.models['User'];
    expect(model?.attributes.map((a) => a.name)).toEqual(['map']);
    expect(model?.attributes[0]?.args[0]?.value).toBe('"users"');

    const composite = result.table.topLevel.compositeTypes['Address'];
    expect(composite?.attributes.map((a) => a.name)).toEqual(['map']);
    expect(composite?.attributes[0]?.args[0]?.value).toBe('"addr"');
  });
});

describe('buildSymbolTable() — resolved named-type binding shape', () => {
  it('resolves a scalar-backed binding with baseType and isConstructor=false', () => {
    const result = build(['types {', '  Email = String', '}'].join('\n'));
    const scalar = result.table.topLevel.namedTypes['Email'];

    expect(scalar?.isConstructor).toBe(false);
    expect(scalar?.baseType).toBe('String');
    expect(scalar?.typeConstructor).toBeUndefined();
  });

  it('resolves an alias binding to another declaration with baseType', () => {
    const result = build(
      ['model User {', '  id Int', '}', 'types {', '  UserId = User', '}'].join('\n'),
    );
    const alias = result.table.topLevel.namedTypes['UserId'];

    expect(alias?.isConstructor).toBe(false);
    expect(alias?.baseType).toBe('User');
  });

  it('resolves a constructor binding with isConstructor=true and no baseType', () => {
    const result = build(['types {', '  Embedding = Vector(1536)', '}'].join('\n'));
    const alias = result.table.topLevel.namedTypes['Embedding'];

    expect(alias?.isConstructor).toBe(true);
    expect(alias?.baseType).toBeUndefined();
    expect(alias?.typeConstructor?.path).toEqual(['Vector']);
    expect(alias?.typeConstructor?.args.map((a) => a.value)).toEqual(['1536']);
  });
});

describe('buildSymbolTable() — resolved block (BlockSymbol.block)', () => {
  const ENUM_DESCRIPTORS: AuthoringPslBlockDescriptorNamespace = {
    enum: {
      kind: 'pslBlock',
      keyword: 'enum',
      discriminator: 'enum',
      name: { required: true },
      parameters: {},
      variadicParameters: true,
    },
  };

  const POLICY_DESCRIPTORS: AuthoringPslBlockDescriptorNamespace = {
    policy_select: {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'fixture-policy-select',
      name: { required: true },
      parameters: {
        target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
        as: { kind: 'option', values: ['permissive', 'restrictive'] },
        using: { kind: 'value', codecId: 'fixture/text@1', required: true },
      },
    },
  };

  it('resolves an enum block with the descriptor discriminator and bare/value members', () => {
    const result = build(
      ['enum Role {', '  Admin', '  User = "u"', '}'].join('\n'),
      ENUM_DESCRIPTORS,
    );
    const block = result.table.topLevel.blocks['Role']?.block;

    expect(block?.kind).toBe('enum');
    expect(block?.name).toBe('Role');
    expect(block?.parameters['Admin']).toMatchObject({ kind: 'bare' });
    expect(block?.parameters['User']).toMatchObject({ kind: 'value', raw: '"u"' });
  });

  it('resolves a descriptor-typed block classifying ref/option/value params', () => {
    const result = build(
      [
        'model Post {',
        '  id Int',
        '}',
        'policy_select ReadPosts {',
        '  target = Post',
        '  as     = permissive',
        '  using  = "true"',
        '}',
      ].join('\n'),
      POLICY_DESCRIPTORS,
    );
    const block = result.table.topLevel.blocks['ReadPosts']?.block;

    expect(block?.kind).toBe('fixture-policy-select');
    expect(block?.name).toBe('ReadPosts');
    expect(block?.parameters['target']).toMatchObject({ kind: 'ref', identifier: 'Post' });
    expect(block?.parameters['as']).toMatchObject({ kind: 'option', token: 'permissive' });
    expect(block?.parameters['using']).toMatchObject({ kind: 'value', raw: '"true"' });
  });

  it('resolves an unknown-keyword block descriptor-free (kind = keyword, value/bare members)', () => {
    const result = build(['mystery Thing {', '  on = read', '  flag', '}'].join('\n'));
    const block = result.table.topLevel.blocks['Thing']?.block;

    expect(block?.kind).toBe('mystery');
    expect(block?.name).toBe('Thing');
    expect(block?.parameters['on']).toMatchObject({ kind: 'value', raw: 'read' });
    expect(block?.parameters['flag']).toMatchObject({ kind: 'bare' });
  });

  it('flags a duplicate block member with PSL_EXTENSION_DUPLICATE_PARAMETER (first-wins)', () => {
    const result = build(['enum Role {', '  Admin', '  Admin', '}'].join('\n'), ENUM_DESCRIPTORS);
    const block = result.table.topLevel.blocks['Role']?.block;

    expect(result.diagnostics.map((d) => d.code)).toContain('PSL_EXTENSION_DUPLICATE_PARAMETER');
    expect(Object.keys(block?.parameters ?? {})).toEqual(['Admin']);
  });

  it('resolves namespace-nested blocks too', () => {
    const result = build(
      ['namespace ns {', '  enum Role {', '    Admin', '  }', '}'].join('\n'),
      ENUM_DESCRIPTORS,
    );
    const block = result.table.topLevel.namespaces['ns']?.blocks['Role']?.block;

    expect(block?.kind).toBe('enum');
    expect(block?.parameters['Admin']).toMatchObject({ kind: 'bare' });
  });

  it('reports non-array values for list parameters instead of accepting an empty list', () => {
    const result = build(['policy_select ReadPosts {', '  targets = Post', '}'].join('\n'), {
      policy_select: {
        kind: 'pslBlock',
        keyword: 'policy_select',
        discriminator: 'fixture-policy-select',
        name: { required: true },
        parameters: {
          targets: {
            kind: 'list',
            of: { kind: 'ref', refKind: 'model', scope: 'same-space' },
            required: true,
          },
        },
      },
    });
    const block = result.table.topLevel.blocks['ReadPosts']?.block;

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]),
    );
    expect(block?.parameters['targets']).toMatchObject({ kind: 'value', raw: 'Post' });
  });

  it('validates same-namespace refs against the block owner namespace', () => {
    const { document, sourceFile } = parse(
      [
        'model Post {',
        '  id Int',
        '}',
        'namespace blog {',
        '  model Article {',
        '    id Int',
        '  }',
        '  policy_select ReadArticles {',
        '    target = Article',
        '  }',
        '}',
      ].join('\n'),
    );
    const policySelectDescriptor: AuthoringPslBlockDescriptor = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'fixture-policy-select',
      name: { required: true },
      parameters: {
        target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
      },
    };
    const descriptors: AuthoringPslBlockDescriptorNamespace = {
      policy_select: policySelectDescriptor,
    };
    const result = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors: descriptors,
    });
    const block = result.table.topLevel.namespaces['blog']?.blocks['ReadArticles'];

    expect(block).toBeDefined();
    if (block === undefined) return;
    expect(
      validateExtensionBlockFromSymbol({
        block,
        descriptor: policySelectDescriptor,
        symbolTable: result.table,
        sourceFile,
        sourceId: 'schema.prisma',
        codecLookup: emptyCodecLookup,
      }),
    ).toEqual([]);
  });

  it('validates same-space refs against models from every namespace', () => {
    const { document, sourceFile } = parse(
      [
        'namespace blog {',
        '  model Article {',
        '    id Int',
        '  }',
        '}',
        'policy_anywhere ReadArticles {',
        '  target = Article',
        '}',
      ].join('\n'),
    );
    const policyAnywhereDescriptor: AuthoringPslBlockDescriptor = {
      kind: 'pslBlock',
      keyword: 'policy_anywhere',
      discriminator: 'fixture-policy-anywhere',
      name: { required: true },
      parameters: {
        target: { kind: 'ref', refKind: 'model', scope: 'same-space', required: true },
      },
    };
    const descriptors: AuthoringPslBlockDescriptorNamespace = {
      policy_anywhere: policyAnywhereDescriptor,
    };
    const result = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors: descriptors,
    });
    const block = result.table.topLevel.blocks['ReadArticles'];

    expect(block).toBeDefined();
    if (block === undefined) return;
    expect(
      validateExtensionBlockFromSymbol({
        block,
        descriptor: policyAnywhereDescriptor,
        symbolTable: result.table,
        sourceFile,
        sourceId: 'schema.prisma',
        codecLookup: emptyCodecLookup,
      }),
    ).toEqual([]);
  });
});

describe('buildSymbolTable() — N:1 keywords sharing one discriminator', () => {
  // A fake extension contributing two keywords, `shape_circle` and
  // `shape_square`, that both lower to the shared `shape` discriminator —
  // proving the parser dispatches by keyword while grouping by kind.
  const SHAPE_DESCRIPTORS: AuthoringPslBlockDescriptorNamespace = {
    shape_circle: {
      kind: 'pslBlock',
      keyword: 'shape_circle',
      discriminator: 'shape',
      name: { required: true },
      parameters: {},
    },
    shape_square: {
      kind: 'pslBlock',
      keyword: 'shape_square',
      discriminator: 'shape',
      name: { required: true },
      parameters: {},
    },
  };

  it('parses each keyword to its own block, both sharing kind "shape"', () => {
    const result = build(
      ['shape_circle Round {', '}', 'shape_square Boxy {', '}'].join('\n'),
      SHAPE_DESCRIPTORS,
    );

    expect(result.diagnostics).toEqual([]);
    const round = result.table.topLevel.blocks['Round'];
    const boxy = result.table.topLevel.blocks['Boxy'];

    expect(round?.keyword).toBe('shape_circle');
    expect(boxy?.keyword).toBe('shape_square');
    expect(round?.block.kind).toBe('shape');
    expect(boxy?.block.kind).toBe('shape');
    expect(round?.block.keyword).toBe('shape_circle');
    expect(boxy?.block.keyword).toBe('shape_square');
  });
});

describe('buildSymbolTable() — block attributes parsed through the kit', () => {
  const mapSpec = blockAttribute('map', {
    documentation: 'Maps the widget to its storage name.',
    positional: [{ key: 'name', type: str(), documentation: 'The nonempty storage name.' }],
    refine: (parsed, ctx, node) =>
      parsed.name === '' ? [leafDiagnostic(ctx, node, 'empty', 'PSL_FIXTURE_EMPTY_MAP')] : [],
  });
  const WIDGET_DESCRIPTORS: AuthoringPslBlockDescriptorNamespace = {
    widget: {
      kind: 'pslBlock',
      keyword: 'widget',
      discriminator: 'widget',
      name: { required: true },
      parameters: {},
      variadicParameters: true,
      attributes: { map: () => mapSpec },
    },
  };
  const BARE_DESCRIPTORS: AuthoringPslBlockDescriptorNamespace = {
    widget: {
      kind: 'pslBlock',
      keyword: 'widget',
      discriminator: 'widget',
      name: { required: true },
      parameters: {},
    },
  };

  it('attaches the parsed arguments and the attribute span as plain data', () => {
    const result = build(
      ['widget Gear {', '  teeth = 12', '  @@map("gear_wheel")', '}'].join('\n'),
      WIDGET_DESCRIPTORS,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.table.topLevel.blocks['Gear']?.block.attributes).toEqual({
      map: {
        args: { name: 'gear_wheel' },
        span: {
          start: { offset: 29, line: 3, column: 3 },
          end: { offset: 48, line: 3, column: 22 },
        },
      },
    });
  });

  it('diagnoses an attribute the descriptor does not declare, anchored on the attribute', () => {
    const result = build(['widget Gear {', '  @@schema("x")', '}'].join('\n'), WIDGET_DESCRIPTORS);

    expect(result.diagnostics).toEqual([
      {
        code: 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
        message: 'Unknown attribute "@@schema" in "widget" block "Gear"',
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 15 } },
      },
    ]);
    expect(result.table.topLevel.blocks['Gear']?.block.attributes).toEqual({});
  });

  it('treats every attribute as unknown when the descriptor declares none', () => {
    const result = build(['widget Gear {', '  @@map("x")', '}'].join('\n'), BARE_DESCRIPTORS);

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
    ]);
  });

  it('keeps the first occurrence of a duplicated attribute and diagnoses the rest', () => {
    const result = build(
      ['widget Gear {', '  @@map("first")', '  @@map("second")', '}'].join('\n'),
      WIDGET_DESCRIPTORS,
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE',
        message: 'Duplicate attribute "@@map" in "widget" block "Gear"; first occurrence wins',
        range: { start: { line: 2, character: 2 }, end: { line: 2, character: 17 } },
      }),
    ]);
    expect(result.table.topLevel.blocks['Gear']?.block.attributes['map']?.args).toEqual({
      name: 'first',
    });
  });

  it('surfaces a kit binding failure as a symbol-table diagnostic and omits the attribute', () => {
    const result = build(['widget Gear {', '  @@map()', '}'].join('\n'), WIDGET_DESCRIPTORS);

    expect(result.diagnostics).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "map" is missing required argument "name"',
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 9 } },
      },
    ]);
    expect(result.table.topLevel.blocks['Gear']?.block.attributes).toEqual({});
  });

  it('diagnoses a duplicate whose first occurrence failed to bind', () => {
    const result = build(
      ['widget Gear {', '  @@map()', '  @@map("second")', '}'].join('\n'),
      WIDGET_DESCRIPTORS,
    );

    expect(result.diagnostics).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "map" is missing required argument "name"',
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 9 } },
      },
      {
        code: 'PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE',
        message: 'Duplicate attribute "@@map" in "widget" block "Gear"; first occurrence wins',
        range: { start: { line: 2, character: 2 }, end: { line: 2, character: 17 } },
      },
    ]);
    expect(result.table.topLevel.blocks['Gear']?.block.attributes).toEqual({});
  });

  it('reports an undeclared attribute on every occurrence', () => {
    const result = build(
      ['widget Gear {', '  @@schema("a")', '  @@schema("b")', '}'].join('\n'),
      WIDGET_DESCRIPTORS,
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
      'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
    ]);
    expect(result.table.topLevel.blocks['Gear']?.block.attributes).toEqual({});
  });

  it('carries a refine diagnostic code contributed by the spec', () => {
    const result = build(['widget Gear {', '  @@map("")', '}'].join('\n'), WIDGET_DESCRIPTORS);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_FIXTURE_EMPTY_MAP', message: 'empty' }),
    ]);
  });

  it('parses nothing for a block whose keyword has no descriptor', () => {
    const result = build(['gizmo Gear {', '  @@map("x")', '}'].join('\n'), {});

    expect(result.diagnostics).toEqual([]);
    expect(result.table.topLevel.blocks['Gear']?.block.attributes).toEqual({});
  });
});
