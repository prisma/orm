import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { PslSources, type Range } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';

function build(...texts: string[]) {
  const parsed = texts.map((text, index) => parse(text, `${index}.psl`));
  const sources = new PslSources(
    parsed.map(
      ({ document, sources }) => [document.syntax, sources.sourceFileFor(document.syntax)] as const,
    ),
  );
  const result = buildSymbolTable({ documents: parsed.map(({ document }) => document), sources });
  return {
    ...result,
    topLevel: result.symbolTable.topLevel,
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

describe('buildSymbolTable() given mixin declarations', () => {
  it('collects a mixin of each keyword into the mixins record, with fields or entries', () => {
    const { topLevel, diagnostics } = build(
      lines(
        'model mixin Timestamps {',
        '  createdAt DateTime @default(now())',
        '  @@index([createdAt])',
        '}',
        'type mixin Geo {',
        '  lat Float',
        '}',
        'enum mixin BaseRoles {',
        '  ADMIN @map("admin")',
        '  USER',
        '}',
        'policy mixin OwnerRead {',
        '  roles = [authenticated]',
        '  @@map("owner")',
        '}',
      ),
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(topLevel.mixins)).toEqual(['Timestamps', 'Geo', 'BaseRoles', 'OwnerRead']);
    expect(
      Object.values(topLevel.mixins).map((mixin) => ({
        kind: mixin.kind,
        name: mixin.name,
        keyword: mixin.keyword,
        fields: Object.keys(mixin.fields),
        entries: mixin.entries.map((entry) => entry.key()?.name()),
        attributes: mixin.attributes.map((attribute) => attribute.name),
      })),
    ).toEqual([
      {
        kind: 'mixin',
        name: 'Timestamps',
        keyword: 'model',
        fields: ['createdAt'],
        entries: [],
        attributes: ['index'],
      },
      { kind: 'mixin', name: 'Geo', keyword: 'type', fields: ['lat'], entries: [], attributes: [] },
      {
        kind: 'mixin',
        name: 'BaseRoles',
        keyword: 'enum',
        fields: [],
        entries: ['ADMIN', 'USER'],
        attributes: [],
      },
      {
        kind: 'mixin',
        name: 'OwnerRead',
        keyword: 'policy',
        fields: [],
        entries: ['roles'],
        attributes: ['map'],
      },
    ]);
    expect(Object.keys(topLevel.models)).toEqual([]);
    expect(Object.keys(topLevel.compositeTypes)).toEqual([]);
    expect(Object.keys(topLevel.blocks)).toEqual([]);
  });

  it('keeps the node and the span of a mixin and resolves its fields like model fields', () => {
    const source = 'model mixin Timestamps {\n  createdAt DateTime? @default(now())\n}';
    const mixin = build(source).topLevel.mixins['Timestamps'];

    expect(mixin?.node.name()?.name()).toBe('Timestamps');
    expect(mixin?.span).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: source.length, line: 3, column: 2 },
    });
    expect(mixin?.fields['createdAt']).toMatchObject({
      kind: 'field',
      name: 'createdAt',
      typeName: 'DateTime',
      optional: true,
    });
    expect(mixin?.fields['createdAt']?.attributes.map((attribute) => attribute.name)).toEqual([
      'default',
    ]);
  });

  it('collects a mixin declared in a namespace into that namespace', () => {
    const { topLevel, diagnostics } = build(
      'namespace auth {\n  model mixin Timestamps {\n    createdAt DateTime\n  }\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(topLevel.mixins)).toEqual([]);
    expect(Object.keys(topLevel.namespaces['auth']?.mixins ?? {})).toEqual(['Timestamps']);
    expect(Object.keys(topLevel.namespaces['auth']?.models ?? {})).toEqual([]);
  });

  it('names the mixin as the owner of a field with an invalid qualified type', () => {
    const source = 'model mixin Owned {\n  owner a.b.c.User\n}';
    const { diagnostics } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_INVALID_QUALIFIED_TYPE',
        message:
          'Field "Owned.owner" has an invalid qualified type "a.b.c.User"; use at most one namespace qualifier (e.g. "ns.TypeName")',
        filename: '0.psl',
        range: rangeOf(source, 'a.b.c.User'),
      },
    ]);
  });

  it('reports a field declared twice in a mixin at the later field', () => {
    const source = 'model mixin T {\n  a Int\n  a String\n}';
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "a"',
        filename: '0.psl',
        range: rangeOf(source, 'a', 1),
      },
    ]);
    expect(topLevel.mixins['T']?.fields['a']?.typeName).toBe('Int');
  });

  it.each([
    ['a model', 'model User {\n}\nmodel mixin User {\n}', 'models'],
    ['a composite type', 'type User {\n}\nenum mixin User {\n}', 'compositeTypes'],
    ['a block', 'enum User {\n}\nmodel mixin User {\n}', 'blocks'],
    ['another mixin', 'model mixin User {\n}\nenum mixin User {\n}', 'mixins'],
  ] as const)(
    'reports a mixin that shares its name with %s declared first',
    (_kind, source, record) => {
      const { diagnostics, topLevel } = build(source);

      expect(diagnostics).toEqual([
        {
          code: 'PSL_DUPLICATE_DECLARATION',
          message: 'Duplicate declaration of "User"',
          filename: '0.psl',
          range: rangeOf(source, 'User', 1),
        },
      ]);
      expect(Object.keys(topLevel[record])).toEqual(['User']);
      expect(topLevel.mixins['User']?.keyword).toBe(record === 'mixins' ? 'model' : undefined);
    },
  );

  it('reports a declaration that shares its name with a mixin declared first', () => {
    const source = 'model mixin User {\n}\nmodel User {\n}';
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "User"',
        filename: '0.psl',
        range: rangeOf(source, 'User', 1),
      },
    ]);
    expect(Object.keys(topLevel.mixins)).toEqual(['User']);
    expect(Object.keys(topLevel.models)).toEqual([]);
  });

  it('checks a mixin name against the models, types, blocks and mixins of its namespace', () => {
    const source = lines(
      'namespace a {',
      '  model User {',
      '  }',
      '  model mixin User {',
      '  }',
      '  enum mixin Roles {',
      '  }',
      '  enum Roles {',
      '  }',
      '}',
      'namespace b {',
      '  model mixin User {',
      '  }',
      '}',
      'model mixin User {',
      '}',
    );
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "User"',
        filename: '0.psl',
        range: rangeOf(source, 'User', 1),
      },
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "Roles"',
        filename: '0.psl',
        range: rangeOf(source, 'Roles', 1),
      },
    ]);
    expect(Object.keys(topLevel.namespaces['a']?.mixins ?? {})).toEqual(['Roles']);
    expect(Object.keys(topLevel.namespaces['a']?.blocks ?? {})).toEqual([]);
    expect(Object.keys(topLevel.namespaces['b']?.mixins ?? {})).toEqual(['User']);
    expect(Object.keys(topLevel.mixins)).toEqual(['User']);
  });
});

describe('buildSymbolTable() replacing an inclusion in a model', () => {
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
      const { topLevel, diagnostics } = build(lines(mixin, 'model User {', ...body, '}'));
      const user = topLevel.models['User'];

      expect(diagnostics).toEqual([]);
      expect(Object.keys(user?.fields ?? {})).toEqual(fields);
      expect(user?.attributes.map((attribute) => attribute.name)).toEqual(attributes);
    },
  );

  it('shares the field symbols and resolved attributes of the mixin with every including model', () => {
    const { topLevel } = build(
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
    const timestamps = topLevel.mixins['Timestamps'];
    const user = topLevel.models['User'];
    const post = topLevel.models['Post'];

    expect(user?.fields['createdAt']).toBe(timestamps?.fields['createdAt']);
    expect(post?.fields['createdAt']).toBe(timestamps?.fields['createdAt']);
    expect(user?.fields['updatedAt']).toBe(timestamps?.fields['updatedAt']);
    expect(user?.attributes[0]).toBe(timestamps?.attributes[0]);
    expect(post?.attributes[0]).toBe(timestamps?.attributes[0]);
    expect(Object.keys(timestamps?.fields ?? {})).toEqual(['createdAt', 'updatedAt']);
  });

  it('keeps the node and the own members of the including model as they were', () => {
    const { topLevel } = build(lines(mixin, 'model User {', '  id Int @id', '  +Timestamps', '}'));
    const user = topLevel.models['User'];

    expect(user?.kind).toBe('model');
    expect(user?.node.name()?.name()).toBe('User');
    expect(user?.fields['id']?.node.syntax.parent).toBe(user?.node.syntax);
    expect(user?.fields['createdAt']?.node.syntax.parent).toBe(
      topLevel.mixins['Timestamps']?.node.syntax,
    );
  });

  it('places several inclusions in the order they are written', () => {
    const { topLevel, diagnostics } = build(
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
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual([
      'tenantId',
      'id',
      'createdAt',
      'updatedAt',
    ]);
  });
});

describe('buildSymbolTable() replacing an inclusion in other blocks', () => {
  it('places the fields and attributes of a type mixin in a composite type', () => {
    const { topLevel, diagnostics } = build(
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
    const address = topLevel.compositeTypes['Address'];

    expect(diagnostics).toEqual([]);
    expect(Object.keys(address?.fields ?? {})).toEqual(['street', 'lat', 'lng', 'city']);
    expect(address?.attributes.map((attribute) => attribute.name)).toEqual(['map']);
    expect(address?.fields['lat']).toBe(topLevel.mixins['Geo']?.fields['lat']);
  });

  it.each([
    ['first', ['  +BaseRoles', '  GUEST', '  OWNER'], ['ADMIN', 'USER', 'GUEST', 'OWNER']],
    ['in the middle', ['  GUEST', '  +BaseRoles', '  OWNER'], ['GUEST', 'ADMIN', 'USER', 'OWNER']],
    ['last', ['  GUEST', '  OWNER', '  +BaseRoles'], ['GUEST', 'OWNER', 'ADMIN', 'USER']],
  ])('places the members of an enum mixin included %s', (_position, body, members) => {
    const { topLevel, diagnostics } = build(
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
    const role = topLevel.blocks['Role'];
    const admin = role?.entries.find((entry) => entry.key()?.name() === 'ADMIN');

    expect(diagnostics).toEqual([]);
    expect(role?.entries.map((entry) => entry.key()?.name())).toEqual(members);
    expect(admin).toBe(topLevel.mixins['BaseRoles']?.entries[0]);
    expect(Array.from(admin?.attributes() ?? [], (attribute) => attribute.name()?.path())).toEqual([
      ['map'],
    ]);
  });

  it('places the entries and attributes of a key = value mixin', () => {
    const { topLevel, diagnostics } = build(
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
    const block = topLevel.blocks['ReadPosts'];

    expect(diagnostics).toEqual([]);
    expect(block?.entries.map((entry) => entry.key()?.name())).toEqual(['roles', 'using']);
    expect(block?.attributes.map((attribute) => attribute.name)).toEqual(['map', 'schema']);
    expect(block?.entries[0]).toBe(topLevel.mixins['OwnerRead']?.entries[0]);
    expect(block?.attributes[1]).toBe(topLevel.mixins['OwnerRead']?.attributes[0]);
    expect(block?.keyword).toBe('policy_select');
  });

  it('passes a key repeated inside the mixin on, once per occurrence', () => {
    const { topLevel, diagnostics } = build(
      'hooks mixin Shared {\n  on = "a"\n  on = "b"\n}\nhooks Lifecycle {\n  +Shared\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(topLevel.blocks['Lifecycle']?.entries.map((entry) => entry.key()?.name())).toEqual([
      'on',
      'on',
    ]);
  });

  it('keeps a key the block repeats after an inclusion that provided it', () => {
    const { topLevel, diagnostics } = build(
      'hooks mixin Shared {\n  on = "a"\n}\nhooks Lifecycle {\n  +Shared\n  on = "b"\n  on = "c"\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(topLevel.blocks['Lifecycle']?.entries.map((entry) => entry.key()?.name())).toEqual([
      'on',
      'on',
      'on',
    ]);
  });
});

describe('buildSymbolTable() looking up the name of an inclusion', () => {
  it('finds a mixin of the same namespace by its unqualified name', () => {
    const { topLevel, diagnostics } = build(
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
    expect(Object.keys(topLevel.namespaces['auth']?.models['User']?.fields ?? {})).toEqual([
      'createdAt',
    ]);
  });

  it('finds a top-level mixin by its unqualified name from inside a namespace', () => {
    const { topLevel, diagnostics } = build(
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
    expect(topLevel.namespaces['auth']?.models['User']?.fields['createdAt']).toBe(
      topLevel.mixins['Timestamps']?.fields['createdAt'],
    );
  });

  it('finds a mixin of another namespace by its qualified name', () => {
    const { topLevel, diagnostics } = build(
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
    const timestamps = topLevel.namespaces['auth']?.mixins['Timestamps'];

    expect(diagnostics).toEqual([]);
    expect(topLevel.namespaces['billing']?.models['Invoice']?.fields['createdAt']).toBe(
      timestamps?.fields['createdAt'],
    );
    expect(topLevel.models['User']?.fields['createdAt']).toBe(timestamps?.fields['createdAt']);
    expect(topLevel.blocks['Role']?.entries.map((entry) => entry.key()?.name())).toEqual(['ADMIN']);
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
    const { topLevel, diagnostics } = build(
      'model User {\n  id Int\n  +Timestamps\n}',
      'model mixin Timestamps {\n  createdAt DateTime\n}',
      'model Post {\n  +Timestamps\n}\nnamespace app {\n  model Item {\n    +Timestamps\n  }\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['id', 'createdAt']);
    expect(Object.keys(topLevel.models['Post']?.fields ?? {})).toEqual(['createdAt']);
    expect(Object.keys(topLevel.namespaces['app']?.models['Item']?.fields ?? {})).toEqual([
      'createdAt',
    ]);
  });

  it('finds a mixin through a namespace reopened in another document', () => {
    const { topLevel, diagnostics } = build(
      'namespace auth {\n  model User {\n    +Timestamps\n  }\n}',
      'namespace auth {\n  model mixin Timestamps {\n    createdAt DateTime\n  }\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(Object.keys(topLevel.namespaces['auth']?.models['User']?.fields ?? {})).toEqual([
      'createdAt',
    ]);
  });
});

describe('buildSymbolTable() reporting an inclusion', () => {
  it('reports a name that resolves to nothing, in the file of the inclusion', () => {
    const including = 'model User {\n  id Int\n  +Missing\n  +auth.Missing\n  +nowhere.Thing\n}';
    const { diagnostics, topLevel } = build('namespace auth {\n}', including);

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
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['id']);
  });

  it.each([
    ['a model', 'model Target {\n}', '+Target', '"Target" is a model, not a mixin'],
    [
      'a composite type',
      'type Target {\n}',
      '+Target',
      '"Target" is a composite type, not a mixin',
    ],
    [
      'a named type',
      'types {\n  Target = String\n}',
      '+Target',
      '"Target" is a named type, not a mixin',
    ],
    ['an enum', 'enum Target {\n}', '+Target', '"Target" is an enum, not a mixin'],
    ['another block', 'policy Target {\n}', '+Target', '"Target" is a policy, not a mixin'],
    ['a namespace', 'namespace Target {\n}', '+Target', '"Target" is a namespace, not a mixin'],
    [
      'a qualified model',
      'namespace ns {\n  model Target {\n  }\n}',
      '+ns.Target',
      '"ns.Target" is a model, not a mixin',
    ],
  ])('reports a name that resolves to %s', (_kind, declaration, inclusion, message) => {
    const source = `${declaration}\nmodel User {\n  ${inclusion}\n  id Int\n}`;
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message,
        filename: '0.psl',
        range: rangeOf(source, inclusion),
      },
    ]);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['id']);
  });

  it('reports a name with a contract-space qualifier', () => {
    const source = 'model mixin T {\n  a Int\n}\nmodel User {\n  +other:T\n  +other:ns.T\n}';
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'A mixin cannot be included from another contract space',
        filename: '0.psl',
        range: rangeOf(source, '+other:T'),
      },
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'A mixin cannot be included from another contract space',
        filename: '0.psl',
        range: rangeOf(source, '+other:ns.T'),
      },
    ]);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual([]);
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
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      { code, message, filename: '0.psl', range: rangeOf(source, '+M') },
    ]);
    expect(Object.keys(topLevel.models['B']?.fields ?? {})).toEqual([]);
    expect(Object.keys(topLevel.compositeTypes['B']?.fields ?? {})).toEqual([]);
    expect(topLevel.blocks['B']?.entries ?? []).toEqual([]);
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
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_INVALID_MODEL_MEMBER',
        message: 'Mixin "T" is already included in this block',
        filename: '0.psl',
        range: rangeOf(source, '+T', 1),
      },
    ]);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['a', 'id']);
    expect(topLevel.models['User']?.attributes.map((attribute) => attribute.name)).toEqual([
      'index',
    ]);
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
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        message: 'Mixin "R" is already included in this block',
        filename: '0.psl',
        range: rangeOf(source, '+auth.R'),
      },
    ]);
    expect(
      topLevel.namespaces['auth']?.blocks['Role']?.entries.map((entry) => entry.key()?.name()),
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
    const { diagnostics, topLevel } = build(source);
    const user = topLevel.models['User'];

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
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Mixin "B" provides "x", which "User" already has',
        filename: '0.psl',
        range: rangeOf(source, '+B'),
      },
    ]);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['x', 'y']);
    expect(topLevel.models['User']?.fields['x']).toBe(topLevel.mixins['A']?.fields['x']);
  });

  it('reports the model field that comes after the inclusion that provided its name', () => {
    const source =
      'model mixin T {\n  createdAt DateTime\n}\nmodel User {\n  +T\n  createdAt Int\n}';
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "createdAt"',
        filename: '0.psl',
        range: rangeOf(source, 'createdAt', 1),
      },
    ]);
    expect(topLevel.models['User']?.fields['createdAt']).toBe(
      topLevel.mixins['T']?.fields['createdAt'],
    );
  });

  it('reports a field the model declares twice once, with an inclusion in between', () => {
    const source = 'model mixin T {\n  b Int\n}\nmodel User {\n  a Int\n  +T\n  a String\n}';
    const { diagnostics, topLevel } = build(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "a"',
        filename: '0.psl',
        range: rangeOf(source, 'a', 1),
      },
    ]);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['a', 'b']);
    expect(topLevel.models['User']?.fields['a']?.typeName).toBe('Int');
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
    const { diagnostics, topLevel } = build(source);
    const role = topLevel.blocks['Role'];

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
    const { diagnostics, topLevel } = build(source);

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
    expect(Object.keys(topLevel.mixins['B']?.fields ?? {})).toEqual(['b']);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['b']);
  });

  it('reports nothing here for an inclusion the parser left without a name', () => {
    const { diagnostics, parseDiagnostics, topLevel } = build('model User {\n  +\n  id Int\n}');

    expect(parseDiagnostics).toHaveLength(1);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['id']);
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

describe('buildSymbolTable() given a mixin written without its block keyword', () => {
  const declaration = ['mixin Timestamps {', '  createdAt DateTime', '}'];
  const model = ['model User {', '  id Int', '  +Timestamps', '}'];

  it('does not collect it, and reports an inclusion that names it as not found', () => {
    const source = lines(...declaration, ...model);
    const { topLevel, diagnostics } = build(source);

    expect(Object.keys(topLevel.blocks)).toEqual([]);
    expect(Object.keys(topLevel.mixins)).toEqual([]);
    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "Timestamps"',
        filename: '0.psl',
        range: rangeOf(source, '+Timestamps'),
      },
    ]);
    expect(Object.keys(topLevel.models['User']?.fields ?? {})).toEqual(['id']);
  });

  it('does not collect it in a namespace', () => {
    const indent = (source: readonly string[]) => source.map((line) => `  ${line}`);
    const source = lines('namespace app {', ...indent(declaration), ...indent(model), '}');
    const { topLevel, diagnostics } = build(source);
    const app = topLevel.namespaces['app'];

    expect(Object.keys(app?.blocks ?? {})).toEqual([]);
    expect(Object.keys(app?.mixins ?? {})).toEqual([]);
    expect(diagnostics.map(({ code, message, range }) => ({ code, message, range }))).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find mixin "Timestamps"',
        range: rangeOf(source, '+Timestamps'),
      },
    ]);
  });

  it('leaves it out of the duplicate-name check', () => {
    const before = build(lines(...declaration, 'model Timestamps {', '}'));
    const after = build(lines('model Timestamps {', '}', ...declaration));
    const inNamespace = build(
      lines('namespace app {', '  model Timestamps {', '  }', '  mixin Timestamps {', '  }', '}'),
    );

    expect(before.diagnostics).toEqual([]);
    expect(after.diagnostics).toEqual([]);
    expect(inNamespace.diagnostics).toEqual([]);
    expect(Object.keys(before.topLevel.models)).toEqual(['Timestamps']);
  });

  it('does not collect a mixin whose block keyword is the word mixin', () => {
    const { topLevel, diagnostics } = build(
      lines('mixin mixin T {', '}', 'model User {', '  +T', '}'),
    );

    expect(Object.keys(topLevel.mixins)).toEqual([]);
    expect(diagnostics.map(({ message }) => message)).toEqual(['Cannot find mixin "T"']);
  });

  it('collects the same source as a block in the prisma-7 grammar', () => {
    const { document, sources } = parse(lines(...declaration), 'legacy.psl', {
      grammar: 'prisma-7',
    });
    const { symbolTable, diagnostics } = buildSymbolTable({ documents: [document], sources });

    expect(diagnostics).toEqual([]);
    expect(symbolTable.topLevel.blocks['Timestamps']?.keyword).toBe('mixin');
  });
});
