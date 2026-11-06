import type {
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createBinder, typeReferenceNode } from '../src/binder';
import { parse } from '../src/parse';
import { PslSources, type Range } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import { binderContext } from './support';

const scalar: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/scalar@1' },
};

const contributedTypes: AuthoringTypeNamespace = {
  String: scalar,
  Int: scalar,
  Float: scalar,
  DateTime: scalar,
};

function build(...texts: string[]) {
  const parsed = texts.map((text, index) => parse(text, `${index}.psl`));
  const sources = new PslSources(
    parsed.map(
      ({ document, sources }) => [document.syntax, sources.sourceFileFor(document.syntax)] as const,
    ),
  );
  const table = buildSymbolTable({
    documents: parsed.map(({ document }) => document),
    sources,
    defaultNamespaceId: 'public',
  });
  const bound = createBinder({
    sources,
    symbolTable: table.symbolTable,
    context: binderContext({ contributedTypes }),
  });
  return {
    binder: bound.binder,
    symbolTable: table.symbolTable,
    diagnostics: [...table.diagnostics, ...bound.diagnostics],
    parseDiagnostics: parsed.flatMap(({ diagnostics }) => diagnostics),
  };
}

function rangeOf(source: string, snippet: string, occurrence = 0): Range {
  let offset = -1;
  for (let found = 0; found <= occurrence; found++) offset = source.indexOf(snippet, offset + 1);
  if (offset < 0) throw new Error(`"${snippet}" is not in the source`);
  const before = source.slice(0, offset).split('\n');
  const line = before.length - 1;
  const character = before[line]?.length ?? 0;
  return {
    start: { line, character },
    end: { line, character: character + snippet.length },
  };
}

function lines(...parts: string[]): string {
  return parts.join('\n');
}

describe('createBinder() placing an inclusion in a model', () => {
  const mixin = lines(
    'model mixin Timestamps {',
    '  createdAt DateTime',
    '  updatedAt DateTime',
    '  @@index([createdAt])',
    '}',
  );

  it.each([
    [
      'first',
      ['  +Timestamps', '  id Int', '  name String', '  @@map("users")', '  @@unique([name])'],
      ['createdAt', 'updatedAt', 'id', 'name'],
      ['index', 'map', 'unique'],
    ],
    [
      'in the middle',
      ['  id Int', '  @@map("users")', '  +Timestamps', '  name String', '  @@unique([name])'],
      ['id', 'createdAt', 'updatedAt', 'name'],
      ['map', 'index', 'unique'],
    ],
    [
      'last',
      ['  id Int', '  name String', '  @@map("users")', '  @@unique([name])', '  +Timestamps'],
      ['id', 'name', 'createdAt', 'updatedAt'],
      ['map', 'unique', 'index'],
    ],
  ])(
    'places the fields and attributes of an inclusion written %s',
    (_position, body, fields, attributes) => {
      const { symbolTable, diagnostics } = build(lines(mixin, 'model User {', ...body, '}'));
      const user = symbolTable.defaultNamespace.models['User'];

      expect(diagnostics).toEqual([]);
      expect(Object.keys(user?.fields ?? {})).toEqual(fields);
      expect(user?.attributes.map((attribute) => attribute.name)).toEqual(attributes);
    },
  );

  it('shares the field symbols and resolved attributes of the mixin with every including model', () => {
    const { symbolTable } = build(
      lines(
        mixin,
        'model User {',
        '  id Int',
        '  +Timestamps',
        '}',
        'model Post {',
        '  +Timestamps',
        '}',
      ),
    );
    const timestamps = symbolTable.defaultNamespace.mixins['Timestamps'];
    const user = symbolTable.defaultNamespace.models['User'];
    const post = symbolTable.defaultNamespace.models['Post'];

    expect(user?.fields['createdAt']).toBe(timestamps?.fields['createdAt']);
    expect(post?.fields['createdAt']).toBe(timestamps?.fields['createdAt']);
    expect(user?.fields['updatedAt']).toBe(timestamps?.fields['updatedAt']);
    expect(user?.attributes[0]).toBe(timestamps?.attributes[0]);
    expect(post?.attributes[0]).toBe(timestamps?.attributes[0]);
    expect(Object.keys(timestamps?.fields ?? {})).toEqual(['createdAt', 'updatedAt']);
  });

  it('keeps the node and the own members of the including model as they were', () => {
    const { symbolTable } = build(
      lines(mixin, 'model User {', '  id Int @id', '  +Timestamps', '}'),
    );
    const user = symbolTable.defaultNamespace.models['User'];

    expect(user?.kind).toBe('model');
    expect(user?.node.name()?.name()).toBe('User');
    expect(user?.fields['id']?.node.syntax.parent).toBe(user?.node.syntax);
    expect(user?.fields['createdAt']?.node.syntax.parent).toBe(
      symbolTable.defaultNamespace.mixins['Timestamps']?.node.syntax,
    );
  });

  it('places several inclusions in the order they are written', () => {
    const { symbolTable, diagnostics } = build(
      lines(
        mixin,
        'model mixin Tenant {',
        '  tenantId Int',
        '}',
        'model User {',
        '  +Tenant',
        '  id Int',
        '  +Timestamps',
        '}',
      ),
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual([
      'tenantId',
      'id',
      'createdAt',
      'updatedAt',
    ]);
  });
});

describe('createBinder() placing an inclusion in other blocks', () => {
  it('places the fields and attributes of a type mixin in a composite type', () => {
    const { symbolTable, diagnostics } = build(
      lines(
        'type mixin Geo {',
        '  lat Float',
        '  lng Float',
        '  @@map("geo")',
        '}',
        'type Address {',
        '  street String',
        '  +Geo',
        '  city String',
        '}',
      ),
    );
    const address = symbolTable.defaultNamespace.compositeTypes['Address'];

    expect(diagnostics).toEqual([]);
    expect(Object.keys(address?.fields ?? {})).toEqual(['street', 'lat', 'lng', 'city']);
    expect(address?.attributes.map((attribute) => attribute.name)).toEqual(['map']);
    expect(address?.fields['lat']).toBe(symbolTable.defaultNamespace.mixins['Geo']?.fields['lat']);
  });

  it.each([
    ['first', ['  +BaseRoles', '  GUEST', '  OWNER'], ['ADMIN', 'USER', 'GUEST', 'OWNER']],
    ['in the middle', ['  GUEST', '  +BaseRoles', '  OWNER'], ['GUEST', 'ADMIN', 'USER', 'OWNER']],
    ['last', ['  GUEST', '  OWNER', '  +BaseRoles'], ['GUEST', 'OWNER', 'ADMIN', 'USER']],
  ])('places the members of an enum mixin included %s', (_position, body, members) => {
    const { symbolTable, diagnostics } = build(
      lines(
        'enum mixin BaseRoles {',
        '  ADMIN @map("admin")',
        '  USER',
        '}',
        'enum Role {',
        ...body,
        '}',
      ),
    );
    const role = symbolTable.defaultNamespace.blocks['Role'];
    const admin = role?.entries.find((entry) => entry.key()?.name() === 'ADMIN');

    expect(diagnostics).toEqual([]);
    expect(role?.entries.map((entry) => entry.key()?.name())).toEqual(members);
    expect(admin).toBe(symbolTable.defaultNamespace.mixins['BaseRoles']?.entries[0]);
    expect(Array.from(admin?.attributes() ?? [], (attribute) => attribute.name()?.path())).toEqual([
      ['map'],
    ]);
  });

  it('places the entries and attributes of a key = value mixin', () => {
    const { symbolTable, diagnostics } = build(
      lines(
        'policy_select mixin OwnerRead {',
        '  roles = [authenticated]',
        '  @@schema("auth")',
        '}',
        'policy_select ReadPosts {',
        '  @@map("read_posts")',
        '  +OwnerRead',
        '  using = "true"',
        '}',
      ),
    );
    const block = symbolTable.defaultNamespace.blocks['ReadPosts'];

    expect(diagnostics).toEqual([]);
    expect(block?.entries.map((entry) => entry.key()?.name())).toEqual(['roles', 'using']);
    expect(block?.attributes.map((attribute) => attribute.name)).toEqual(['map', 'schema']);
    expect(block?.entries[0]).toBe(symbolTable.defaultNamespace.mixins['OwnerRead']?.entries[0]);
    expect(block?.attributes[1]).toBe(
      symbolTable.defaultNamespace.mixins['OwnerRead']?.attributes[0],
    );
    expect(block?.keyword).toBe('policy_select');
  });

  it('passes a key repeated inside the mixin on, once per occurrence', () => {
    const { symbolTable, diagnostics } = build(
      'hooks mixin Shared {\n  on = "a"\n  on = "b"\n}\nhooks Lifecycle {\n  +Shared\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(
      symbolTable.defaultNamespace.blocks['Lifecycle']?.entries.map((entry) => entry.key()?.name()),
    ).toEqual(['on', 'on']);
  });

  it('keeps a key the block repeats after an inclusion that provided it', () => {
    const { symbolTable, diagnostics } = build(
      'hooks mixin Shared {\n  on = "a"\n}\nhooks Lifecycle {\n  +Shared\n  on = "b"\n  on = "c"\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(
      symbolTable.defaultNamespace.blocks['Lifecycle']?.entries.map((entry) => entry.key()?.name()),
    ).toEqual(['on', 'on', 'on']);
  });
});

describe('createBinder() looking up the name of an inclusion', () => {
  it('finds a mixin of the same namespace by its unqualified name', () => {
    const { symbolTable, diagnostics } = build(
      lines(
        'model mixin Timestamps {',
        '  topLevel DateTime',
        '}',
        'namespace auth {',
        '  model mixin Timestamps {',
        '    createdAt DateTime',
        '  }',
        '  model User {',
        '    +Timestamps',
        '  }',
        '}',
      ),
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.namespaces['auth']?.models['User']?.fields ?? {})).toEqual([
      'createdAt',
    ]);
  });

  it('finds a top-level mixin by its unqualified name from inside a namespace', () => {
    const { symbolTable, diagnostics } = build(
      lines(
        'model mixin Timestamps {',
        '  createdAt DateTime',
        '}',
        'namespace auth {',
        '  model User {',
        '    +Timestamps',
        '  }',
        '}',
      ),
    );

    expect(diagnostics).toEqual([]);
    expect(symbolTable.namespaces['auth']?.models['User']?.fields['createdAt']).toBe(
      symbolTable.defaultNamespace.mixins['Timestamps']?.fields['createdAt'],
    );
  });

  it.each([
    [
      'declared before the including model',
      [
        lines(
          'model mixin Timestamps {',
          '  createdAt DateTime',
          '}',
          'namespace app {',
          '  model Timestamps {',
          '    id Int',
          '  }',
          '  model User {',
          '    id Int',
          '    +Timestamps',
          '  }',
          '}',
        ),
      ],
    ],
    [
      'declared after the including model',
      [
        lines(
          'model mixin Timestamps {',
          '  createdAt DateTime',
          '}',
          'namespace app {',
          '  model User {',
          '    id Int',
          '    +Timestamps',
          '  }',
          '  enum Timestamps {',
          '  }',
          '}',
        ),
      ],
    ],
    [
      'declared in a later file',
      [
        lines(
          'model mixin Timestamps {',
          '  createdAt DateTime',
          '}',
          'namespace app {',
          '  model User {',
          '    id Int',
          '    +Timestamps',
          '  }',
          '}',
        ),
        lines('namespace app {', '  type Timestamps {', '  }', '}'),
      ],
    ],
  ])(
    'does not find a top-level mixin hidden by a declaration of its name in the namespace, %s',
    (_where, sources) => {
      const { symbolTable, diagnostics } = build(...sources);

      expect(diagnostics).toEqual([
        {
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: 'Cannot find mixin "Timestamps"',
          filename: '0.psl',
          range: rangeOf(sources[0] ?? '', '+Timestamps'),
        },
      ]);
      expect(Object.keys(symbolTable.namespaces['app']?.models['User']?.fields ?? {})).toEqual([
        'id',
      ]);
    },
  );

  it('reports a qualifier that is not a namespace as a mixin that cannot be found', () => {
    const source = lines('model Target {', '}', 'model User {', '  +Target.Timestamps', '}');

    expect(build(source).diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "Target.Timestamps"',
        filename: '0.psl',
        range: rangeOf(source, '+Target.Timestamps'),
      },
    ]);
  });

  it('finds a mixin of another namespace by its qualified name', () => {
    const { symbolTable, diagnostics } = build(
      lines(
        'namespace auth {',
        '  model mixin Timestamps {',
        '    createdAt DateTime',
        '  }',
        '  enum mixin BaseRoles {',
        '    ADMIN',
        '  }',
        '}',
        'namespace billing {',
        '  model Invoice {',
        '    +auth.Timestamps',
        '  }',
        '}',
        'model User {',
        '  +auth.Timestamps',
        '}',
        'enum Role {',
        '  +auth.BaseRoles',
        '}',
      ),
    );
    const timestamps = symbolTable.namespaces['auth']?.mixins['Timestamps'];

    expect(diagnostics).toEqual([]);
    expect(symbolTable.namespaces['billing']?.models['Invoice']?.fields['createdAt']).toBe(
      timestamps?.fields['createdAt'],
    );
    expect(symbolTable.defaultNamespace.models['User']?.fields['createdAt']).toBe(
      timestamps?.fields['createdAt'],
    );
    expect(
      symbolTable.defaultNamespace.blocks['Role']?.entries.map((entry) => entry.key()?.name()),
    ).toEqual(['ADMIN']);
  });

  it('does not find a mixin of another namespace by its unqualified name', () => {
    const source = lines(
      'namespace auth {',
      '  model mixin Timestamps {',
      '  }',
      '}',
      'namespace billing {',
      '  model Invoice {',
      '    +Timestamps',
      '  }',
      '}',
    );
    const { diagnostics } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "Timestamps"',
        filename: '0.psl',
        range: rangeOf(source, '+Timestamps'),
      },
    ]);
  });

  it('finds a mixin declared in a later document and one declared in an earlier document', () => {
    const { symbolTable, diagnostics } = build(
      'model User {\n  id Int\n  +Timestamps\n}',
      'model mixin Timestamps {\n  createdAt DateTime\n}',
      'model Post {\n  +Timestamps\n}\nnamespace app {\n  model Item {\n    +Timestamps\n  }\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual([
      'id',
      'createdAt',
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models['Post']?.fields ?? {})).toEqual([
      'createdAt',
    ]);
    expect(Object.keys(symbolTable.namespaces['app']?.models['Item']?.fields ?? {})).toEqual([
      'createdAt',
    ]);
  });

  it('finds a mixin through a namespace reopened in another document', () => {
    const { symbolTable, diagnostics } = build(
      'namespace auth {\n  model User {\n    +Timestamps\n  }\n}',
      'namespace auth {\n  model mixin Timestamps {\n    createdAt DateTime\n  }\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.namespaces['auth']?.models['User']?.fields ?? {})).toEqual([
      'createdAt',
    ]);
  });
});

describe('createBinder() reporting an inclusion', () => {
  it('reports a name that resolves to nothing, in the file of the inclusion', () => {
    const including = 'model User {\n  id Int\n  +Missing\n  +auth.Missing\n  +nowhere.Thing\n}';
    const { diagnostics, symbolTable } = build('namespace auth {\n}', including);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "Missing"',
        filename: '1.psl',
        range: rangeOf(including, '+Missing'),
      },
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "auth.Missing"',
        filename: '1.psl',
        range: rangeOf(including, '+auth.Missing'),
      },
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "nowhere.Thing"',
        filename: '1.psl',
        range: rangeOf(including, '+nowhere.Thing'),
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual(['id']);
  });

  it.each([
    ['a model', 'model Target {\n}', 'Target'],
    ['a composite type', 'type Target {\n}', 'Target'],
    ['a type alias', 'types {\n  Target = String\n}', 'Target'],
    ['an enum', 'enum Target {\n}', 'Target'],
    ['another block', 'policy Target {\n}', 'Target'],
    ['a namespace', 'namespace Target {\n}', 'Target'],
    ['a qualified model', 'namespace ns {\n  model Target {\n  }\n}', 'ns.Target'],
  ])('reports the name of %s as a mixin that cannot be found', (_kind, declaration, written) => {
    const source = `${declaration}\nmodel User {\n  +${written}\n  id Int\n}`;
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: `Cannot find mixin "${written}"`,
        filename: '0.psl',
        range: rangeOf(source, `+${written}`),
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual(['id']);
  });

  it('reports a name with a contract-space qualifier as a mixin that cannot be found', () => {
    const source = lines(
      'model mixin T {',
      '  a Int',
      '}',
      'namespace ns {',
      '  model mixin T {',
      '    b Int',
      '  }',
      '}',
      'model User {',
      '  +other:T',
      '  +other:ns.T',
      '}',
    );
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "other:T"',
        filename: '0.psl',
        range: rangeOf(source, '+other:T'),
      },
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "other:ns.T"',
        filename: '0.psl',
        range: rangeOf(source, '+other:ns.T'),
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual([]);
  });

  it.each([
    [
      'a model',
      'enum mixin M {\n  A\n}',
      'model B {\n  +M\n}',
      'PSL_INVALID_MODEL_MEMBER',
      'Mixin "M" is for "enum" blocks, not "model" blocks',
    ],
    [
      'a composite type',
      'model mixin M {\n  a Int\n}',
      'type B {\n  +M\n}',
      'PSL_INVALID_MODEL_MEMBER',
      'Mixin "M" is for "model" blocks, not "type" blocks',
    ],
    [
      'an enum',
      'policy mixin M {\n  a = 1\n}',
      'enum B {\n  +M\n}',
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
      'Mixin "M" is for "policy" blocks, not "enum" blocks',
    ],
    [
      'a key = value block',
      'type mixin M {\n  a Int\n}',
      'policy B {\n  +M\n}',
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
      'Mixin "M" is for "type" blocks, not "policy" blocks',
    ],
  ])('reports a mixin for another keyword included in %s', (_kind, mixin, block, code, message) => {
    const source = `${mixin}\n${block}`;
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      { code, message, filename: '0.psl', range: rangeOf(source, '+M') },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models['B']?.fields ?? {})).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.compositeTypes['B']?.fields ?? {})).toEqual([]);
    expect(symbolTable.defaultNamespace.blocks['B']?.entries ?? []).toEqual([]);
  });

  it('reports the second inclusion of the same mixin in a model, which contributes nothing', () => {
    const source = lines(
      'model mixin T {',
      '  a Int',
      '  @@index([a])',
      '}',
      'model User {',
      '  +T',
      '  id Int',
      '  +T',
      '}',
    );
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_INVALID_MODEL_MEMBER',
        message: 'Mixin "T" is already included in this block',
        filename: '0.psl',
        range: rangeOf(source, '+T', 1),
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual([
      'a',
      'id',
    ]);
    expect(
      symbolTable.defaultNamespace.models['User']?.attributes.map((attribute) => attribute.name),
    ).toEqual(['index']);
  });

  it('reports the second inclusion of the same mixin in an enum, by either spelling of its name', () => {
    const source = lines(
      'namespace auth {',
      '  enum mixin R {',
      '    ADMIN',
      '  }',
      '  enum Role {',
      '    +R',
      '    +auth.R',
      '  }',
      '}',
    );
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        message: 'Mixin "R" is already included in this block',
        filename: '0.psl',
        range: rangeOf(source, '+auth.R'),
      },
    ]);
    expect(
      symbolTable.namespaces['auth']?.blocks['Role']?.entries.map((entry) => entry.key()?.name()),
    ).toEqual(['ADMIN']);
  });

  it('reports a field the model already has when the inclusion is reached, and includes the rest', () => {
    const source = lines(
      'model mixin T {',
      '  createdAt DateTime',
      '  updatedAt DateTime',
      '  @@index([createdAt])',
      '}',
      'model User {',
      '  createdAt Int',
      '  +T',
      '}',
    );
    const { diagnostics, symbolTable } = build(source);
    const user = symbolTable.defaultNamespace.models['User'];

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Mixin "T" provides "createdAt", which "User" already has',
        filename: '0.psl',
        range: rangeOf(source, '+T'),
      },
    ]);
    expect(Object.keys(user?.fields ?? {})).toEqual(['createdAt', 'updatedAt']);
    expect(user?.fields['createdAt']?.typeName).toBe('Int');
    expect(user?.attributes.map((attribute) => attribute.name)).toEqual(['index']);
  });

  it('reports a field two mixins provide at the later inclusion', () => {
    const source =
      'model mixin A {\n  x Int\n}\nmodel mixin B {\n  x String\n  y Int\n}\nmodel User {\n  +A\n  +B\n}';
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Mixin "B" provides "x", which "User" already has',
        filename: '0.psl',
        range: rangeOf(source, '+B'),
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual([
      'x',
      'y',
    ]);
    expect(symbolTable.defaultNamespace.models['User']?.fields['x']).toBe(
      symbolTable.defaultNamespace.mixins['A']?.fields['x'],
    );
  });

  it('reports the model field that comes after the inclusion that provided its name', () => {
    const source =
      'model mixin T {\n  createdAt DateTime\n}\nmodel User {\n  +T\n  createdAt Int\n}';
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "createdAt"',
        filename: '0.psl',
        range: rangeOf(source, 'createdAt', 1),
      },
    ]);
    expect(symbolTable.defaultNamespace.models['User']?.fields['createdAt']).toBe(
      symbolTable.defaultNamespace.mixins['T']?.fields['createdAt'],
    );
  });

  it('reports a field the model declares twice once, with an inclusion in between', () => {
    const source = 'model mixin T {\n  b Int\n}\nmodel User {\n  a Int\n  +T\n  a String\n}';
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "a"',
        filename: '0.psl',
        range: rangeOf(source, 'a', 1),
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual([
      'a',
      'b',
    ]);
    expect(symbolTable.defaultNamespace.models['User']?.fields['a']?.typeName).toBe('Int');
  });

  it('reports an entry key the block already has when the inclusion is reached, and includes the rest', () => {
    const source = lines(
      'enum mixin R {',
      '  ADMIN',
      '  USER',
      '}',
      'enum Role {',
      '  ADMIN = "a"',
      '  +R',
      '}',
    );
    const { diagnostics, symbolTable } = build(source);
    const role = symbolTable.defaultNamespace.blocks['Role'];

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Mixin "R" provides "ADMIN", which "Role" already has',
        filename: '0.psl',
        range: rangeOf(source, '+R'),
      },
    ]);
    expect(role?.entries.map((entry) => entry.key()?.name())).toEqual(['ADMIN', 'USER']);
    expect(role?.entries[0]?.value()).toBeDefined();
  });

  it('reports an inclusion inside a mixin body, which contributes nothing', () => {
    const source = lines(
      'model mixin A {',
      '  a Int',
      '}',
      'model mixin B {',
      '  +A',
      '  b Int',
      '}',
      'enum mixin C {',
      '  +Missing',
      '}',
      'model User {',
      '  +B',
      '}',
    );
    const { diagnostics, symbolTable } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_INVALID_MODEL_MEMBER',
        message: 'A mixin cannot include another mixin',
        filename: '0.psl',
        range: rangeOf(source, '+A'),
      },
      {
        code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        message: 'A mixin cannot include another mixin',
        filename: '0.psl',
        range: rangeOf(source, '+Missing'),
      },
    ]);
    expect(Object.keys(symbolTable.defaultNamespace.mixins['B']?.fields ?? {})).toEqual(['b']);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual(['b']);
  });

  it('reports nothing here for an inclusion the parser left without a name', () => {
    const { diagnostics, parseDiagnostics, symbolTable } = build('model User {\n  +\n  id Int\n}');

    expect(parseDiagnostics).toHaveLength(1);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(symbolTable.defaultNamespace.models['User']?.fields ?? {})).toEqual(['id']);
  });

  it('reports diagnostics for inclusions in several blocks in the order of the blocks', () => {
    const source =
      'model A {\n  +X\n}\nnamespace n {\n  model B {\n    +Y\n  }\n}\nenum C {\n  +Z\n}';
    const { diagnostics } = build(source);

    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Cannot find mixin "X"',
      'Cannot find mixin "Z"',
      'Cannot find mixin "Y"',
    ]);
  });
});

describe('createBinder() changing the symbols it is given', () => {
  it('shows the placed fields on a model symbol the binder resolved before placement', () => {
    const { binder, symbolTable } = build(
      lines(
        'model Post {',
        '  author User',
        '}',
        'model User {',
        '  id Int',
        '  +Timestamps',
        '}',
        'model mixin Timestamps {',
        '  createdAt DateTime',
        '}',
      ),
    );
    const author = symbolTable.defaultNamespace.models['Post']?.fields['author'];
    const type = author === undefined ? undefined : typeReferenceNode(author);
    const resolution = type === undefined ? undefined : binder.symbolForNode(type);
    const user = resolution?.kind === 'model' ? resolution.symbol : undefined;

    expect(user).toBe(symbolTable.defaultNamespace.models['User']);
    expect(Object.keys(user?.fields ?? {})).toEqual(['id', 'createdAt']);
    expect(
      binder.declaredSymbol(
        symbolTable.defaultNamespace.models['User']?.node.syntax ?? author!.node.syntax,
      ),
    ).toBe(user);
  });

  it('leaves a block with no inclusion as the same object with the same member records', () => {
    const source = lines(
      'model mixin Timestamps {',
      '  createdAt DateTime',
      '}',
      'model Post {',
      '  id Int',
      '  @@map("posts")',
      '}',
      'enum Role {',
      '  ADMIN',
      '  @@map("roles")',
      '}',
      'model User {',
      '  id Int',
      '  +Timestamps',
      '}',
    );
    const parsed = parse(source, '0.psl');
    const { symbolTable } = buildSymbolTable({
      documents: [parsed.document],
      sources: parsed.sources,
      defaultNamespaceId: 'public',
    });
    const post = symbolTable.defaultNamespace.models['Post'];
    const role = symbolTable.defaultNamespace.blocks['Role'];
    const before = {
      postFields: post?.fields,
      postFieldSymbols: Object.values(post?.fields ?? {}),
      postAttributes: post?.attributes,
      postAttributeValues: [...(post?.attributes ?? [])],
      roleEntries: role?.entries,
      roleEntryNodes: [...(role?.entries ?? [])],
      roleAttributes: role?.attributes,
    };

    createBinder({
      sources: parsed.sources,
      symbolTable,
      context: binderContext({ contributedTypes }),
    });

    expect(symbolTable.defaultNamespace.models['Post']).toBe(post);
    expect(symbolTable.defaultNamespace.blocks['Role']).toBe(role);
    expect(post?.fields).toBe(before.postFields);
    expect(Object.values(post?.fields ?? {})).toEqual(before.postFieldSymbols);
    expect(post?.attributes).toBe(before.postAttributes);
    expect([...(post?.attributes ?? [])]).toEqual(before.postAttributeValues);
    expect(role?.entries).toBe(before.roleEntries);
    expect([...(role?.entries ?? [])]).toEqual(before.roleEntryNodes);
    expect(role?.attributes).toBe(before.roleAttributes);
  });
});
