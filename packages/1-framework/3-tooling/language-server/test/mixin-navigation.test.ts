import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import { entityRef, jsonValue, mapBlock, structBlock } from '@internal/psl-parser';
import { PslSources } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import type { LocationLink, Range } from 'vscode-languageserver';
import { provideDefinition } from '../src/definition';
import { providePslHover } from '../src/hover';
import { provideReferences } from '../src/references';
import { providePrepareRename, provideRename } from '../src/rename';
import { cursorInput, type Files, type FixtureStack } from './helpers/reference-fixtures';

const mixinsFile = [
  'namespace auth {',
  '  /// Creation and update times.',
  '  model mixin Timestamps {',
  '    createdAt Int',
  '    updatedAt Int @map("updated_at")',
  '    editor    User',
  '',
  '    @@index([createdAt])',
  '  }',
  '',
  '  type mixin Geo {',
  '    lat Int',
  '  }',
  '',
  '  model User {',
  '    id Int @id',
  '    +Timestamps',
  '',
  '    @@index([updatedAt])',
  '  }',
  '}',
  '',
].join('\n');

const postFile = [
  'model Post {',
  '  id     Int @id',
  '  +auth.Timestamps',
  '  stamps auth.Timestamps',
  '',
  '  @@index([createdAt])',
  '}',
  '',
  'type Place {',
  '  +auth.Geo',
  '  name String',
  '}',
  '',
  'enum mixin BaseRoles {',
  '  ADMIN',
  '}',
  '',
  'enum Role {',
  '  +BaseRoles',
  '}',
  '',
  'policy_select mixin OwnerRead {',
  '  on = Post',
  '}',
  '',
].join('\n');

const files: Files = { 'mixins.prisma': mixinsFile, 'post.prisma': postFile };

const documentedBlocks: AuthoringPslBlockDescriptorNamespace = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    discriminator: 'navigation-enum',
    name: { required: true },
    documentation: 'A named set of values.',
    spec: () =>
      mapBlock({ value: { type: jsonValue(), documentation: 'fixture' }, allowBare: true }),
  },
  policy_select: {
    kind: 'pslBlock',
    keyword: 'policy_select',
    discriminator: 'navigation-policy',
    name: { required: true },
    documentation: 'A row-level security policy for reads.',
    spec: () =>
      structBlock({
        parameters: { on: { type: entityRef({ kind: 'model' }), documentation: 'fixture' } },
      }),
  },
};

const stack: FixtureStack = {
  authoringContributions: cursorInput(files, 'post.prisma', 'model Po|st').authoringContributions,
  pslBlockDescriptors: documentedBlocks,
};

function inputAt(name: string, marked: string) {
  return cursorInput(files, name, marked, stack);
}

function textOf(name: string, range: Range): string {
  const lines = (files[name] ?? '').split('\n');
  if (range.start.line === range.end.line) {
    return (lines[range.start.line] ?? '').slice(range.start.character, range.end.character);
  }
  return [
    (lines[range.start.line] ?? '').slice(range.start.character),
    ...lines.slice(range.start.line + 1, range.end.line),
    (lines[range.end.line] ?? '').slice(0, range.end.character),
  ].join('\n');
}

function marked(name: string, range: Range, replacement: string): string {
  const line = (files[name] ?? '').split('\n')[range.start.line] ?? '';
  const before = line.slice(0, range.start.character);
  const after = line.slice(range.end.character);
  return `${name}: ${`${before}${replacement}${after}`.trim()}`;
}

function linksAt(name: string, cursor: string) {
  const input = inputAt(name, cursor);
  const result = provideDefinition({
    ...input,
    sources: new PslSources(
      input.documents.map(({ document, sourceFile }) => [document.syntax, sourceFile] as const),
    ),
    linkSupport: true,
  });
  return (result ?? []).map((entry) => {
    const link = entry as LocationLink;
    return {
      uri: link.targetUri,
      target: textOf(link.targetUri, link.targetRange).split('\n')[0],
      name: textOf(link.targetUri, link.targetSelectionRange),
      origin: link.originSelectionRange && textOf(name, link.originSelectionRange),
    };
  });
}

function referencesAt(name: string, cursor: string, includeDeclaration = true): string[] {
  return provideReferences({ ...inputAt(name, cursor), includeDeclaration }).map(({ uri, range }) =>
    marked(uri, range, `<${textOf(uri, range)}>`),
  );
}

function hoverAt(name: string, cursor: string): string | undefined {
  const result = providePslHover(inputAt(name, cursor));
  if (result === null) return undefined;
  return typeof result.contents === 'object' && 'value' in result.contents
    ? result.contents.value
    : undefined;
}

function renameAt(name: string, cursor: string, newName: string): string[] | null {
  const edit = provideRename({ ...inputAt(name, cursor), newName });
  if (edit === null) return null;
  return Object.entries(edit.changes ?? {}).flatMap(([uri, edits]) =>
    edits.map(({ range, newText }) => marked(uri, range, newText)),
  );
}

const timestampsLink = (origin: string) => [
  { uri: 'mixins.prisma', target: 'model mixin Timestamps {', name: 'Timestamps', origin },
];

const timestampsReferences = [
  'mixins.prisma: model mixin <Timestamps> {',
  'mixins.prisma: +<Timestamps>',
  'post.prisma: +auth.<Timestamps>',
  'post.prisma: stamps auth.<Timestamps>',
];

const timestampsHover = '```prisma\nmodel mixin Timestamps\n```\n\nCreation and update times.';

describe('go-to-definition on a mixin', () => {
  it('goes from an unqualified inclusion to the name in the declaration, with the whole declaration as the target', () => {
    const input = inputAt('mixins.prisma', '+Time|stamps');
    const [link] = provideDefinition({
      ...input,
      sources: new PslSources(
        input.documents.map(({ document, sourceFile }) => [document.syntax, sourceFile] as const),
      ),
      linkSupport: true,
    }) as LocationLink[];

    expect(linksAt('mixins.prisma', '+Time|stamps')).toEqual(timestampsLink('Timestamps'));
    expect(textOf('mixins.prisma', link!.targetRange)).toBe(
      mixinsFile.slice(mixinsFile.indexOf('model mixin Timestamps'), mixinsFile.indexOf('  }') + 3),
    );
  });

  it('goes from a qualified inclusion in another file to the declaration', () => {
    expect(linksAt('post.prisma', '+auth.Time|stamps')).toEqual(timestampsLink('auth.Timestamps'));
  });

  it('goes from the name in the declaration to itself', () => {
    expect(linksAt('mixins.prisma', 'model mixin Time|stamps')).toEqual(
      timestampsLink('Timestamps'),
    );
  });

  it('goes from a field type that wrongly names the mixin to the declaration', () => {
    expect(linksAt('post.prisma', 'stamps auth.Time|stamps')).toEqual(
      timestampsLink('auth.Timestamps'),
    );
  });

  it('returns the name range alone without link support', () => {
    const input = inputAt('post.prisma', '+auth.Time|stamps');
    const result = provideDefinition({
      ...input,
      sources: new PslSources(
        input.documents.map(({ document, sourceFile }) => [document.syntax, sourceFile] as const),
      ),
      linkSupport: false,
    });

    expect(result).toEqual([
      {
        uri: 'mixins.prisma',
        range: { start: { line: 2, character: 14 }, end: { line: 2, character: 24 } },
      },
    ]);
  });

  it('goes from the qualifier of an inclusion to the namespace', () => {
    expect(linksAt('post.prisma', '+au|th.Timestamps')).toEqual([
      { uri: 'mixins.prisma', target: 'namespace auth {', name: 'auth', origin: 'auth' },
    ]);
  });

  it('goes from a field name in a mixin body to itself, and from a mixed-in field named in a model attribute to the mixin', () => {
    const createdAt = [
      { uri: 'mixins.prisma', target: 'createdAt Int', name: 'createdAt', origin: 'createdAt' },
    ];

    expect(linksAt('mixins.prisma', 'created|At Int')).toEqual(createdAt);
    expect(linksAt('post.prisma', '@@index([created|At])')).toEqual(createdAt);
  });
});

describe('find references on a mixin', () => {
  it.each([
    ['an unqualified inclusion', 'mixins.prisma', '+Time|stamps'],
    ['a qualified inclusion', 'post.prisma', '+auth.Time|stamps'],
    ['the name in the declaration', 'mixins.prisma', 'model mixin Time|stamps'],
    ['a field type that wrongly names it', 'post.prisma', 'stamps auth.Time|stamps'],
  ])(
    'lists the declaration and every inclusion across files, from %s',
    (_position, name, cursor) => {
      expect(referencesAt(name, cursor)).toEqual(timestampsReferences);
    },
  );

  it('leaves the declaration out when it is not asked for', () => {
    expect(referencesAt('post.prisma', '+auth.Time|stamps', false)).toEqual(
      timestampsReferences.slice(1),
    );
  });

  it('lists the inclusions of an enum mixin', () => {
    expect(referencesAt('post.prisma', '+Base|Roles')).toEqual([
      'post.prisma: enum mixin <BaseRoles> {',
      'post.prisma: +<BaseRoles>',
    ]);
  });

  it('lists the uses of a mixin field in the mixin and in the attributes of including models, across files', () => {
    const expected = [
      'mixins.prisma: <createdAt> Int',
      'mixins.prisma: @@index([<createdAt>])',
      'post.prisma: @@index([<createdAt>])',
    ];

    expect(referencesAt('mixins.prisma', 'created|At Int')).toEqual(expected);
    expect(referencesAt('post.prisma', '@@index([created|At])')).toEqual(expected);
  });
});

describe('hover on a mixin', () => {
  it.each([
    ['an unqualified inclusion', 'mixins.prisma', '+Time|stamps'],
    ['a qualified inclusion', 'post.prisma', '+auth.Time|stamps'],
    ['the name in the declaration', 'mixins.prisma', 'model mixin Time|stamps'],
    ['a field type that wrongly names it', 'post.prisma', 'stamps auth.Time|stamps'],
  ])('shows the declaration line and the documentation, on %s', (_position, name, cursor) => {
    expect(hoverAt(name, cursor)).toBe(timestampsHover);
  });

  it('shows the declaration line alone for a mixin with no documentation', () => {
    expect(hoverAt('post.prisma', '+Base|Roles')).toBe('```prisma\nenum mixin BaseRoles\n```');
    expect(hoverAt('post.prisma', '+auth.G|eo')).toBe('```prisma\ntype mixin Geo\n```');
  });

  it('covers the hovered name with its range', () => {
    expect(providePslHover(inputAt('post.prisma', '+auth.Time|stamps'))?.range).toEqual({
      start: { line: 2, character: 8 },
      end: { line: 2, character: 18 },
    });
  });

  it('shows the documentation of the block descriptor on the keyword of an enum or key = value mixin', () => {
    expect(hoverAt('post.prisma', 'en|um mixin BaseRoles')).toBe('A named set of values.');
    expect(hoverAt('post.prisma', 'policy_|select mixin OwnerRead')).toBe(
      'A row-level security policy for reads.',
    );
  });

  it('shows nothing on the keyword of a model mixin and on the word mixin', () => {
    expect(hoverAt('mixins.prisma', 'mod|el mixin Timestamps')).toBeUndefined();
    expect(hoverAt('mixins.prisma', 'model mix|in Timestamps')).toBeUndefined();
  });

  it('shows the namespace on the qualifier of an inclusion', () => {
    expect(hoverAt('post.prisma', '+au|th.Timestamps')).toBe('```prisma\nnamespace auth\n```');
  });

  it('shows the field on a field name in a mixin body and on a mixed-in field named in a model attribute', () => {
    expect(hoverAt('mixins.prisma', 'created|At Int')).toBe('```prisma\ncreatedAt Int\n```');
    expect(hoverAt('post.prisma', '@@index([created|At])')).toBe('```prisma\ncreatedAt Int\n```');
  });
});

describe('rename of a mixin', () => {
  const renamed = [
    'mixins.prisma: model mixin Stamped {',
    'mixins.prisma: +Stamped',
    'post.prisma: +auth.Stamped',
    'post.prisma: stamps auth.Stamped',
  ];

  it.each([
    ['the name in the declaration', 'mixins.prisma', 'model mixin Time|stamps'],
    ['an unqualified inclusion', 'mixins.prisma', '+Time|stamps'],
    ['a qualified inclusion in another file', 'post.prisma', '+auth.Time|stamps'],
  ])(
    'edits the declaration and every reference and adds no map attribute, from %s',
    (_position, name, cursor) => {
      expect(renameAt(name, cursor, 'Stamped')).toEqual(renamed);
    },
  );

  it('prepares the name token of the declaration and of an inclusion', () => {
    const declaration = providePrepareRename(inputAt('mixins.prisma', 'model mixin Time|stamps'));
    const inclusion = providePrepareRename(inputAt('post.prisma', '+auth.Time|stamps'));

    expect(declaration).toEqual({
      range: { start: { line: 2, character: 14 }, end: { line: 2, character: 24 } },
      placeholder: 'Timestamps',
    });
    expect(inclusion).toEqual({
      range: { start: { line: 2, character: 8 }, end: { line: 2, character: 18 } },
      placeholder: 'Timestamps',
    });
  });

  it('renames an enum mixin and a key = value mixin by name only', () => {
    expect(renameAt('post.prisma', 'enum mixin Base|Roles', 'Shared')).toEqual([
      'post.prisma: enum mixin Shared {',
      'post.prisma: +Shared',
    ]);
    expect(renameAt('post.prisma', 'policy_select mixin Owner|Read', 'Mine')).toEqual([
      'post.prisma: policy_select mixin Mine {',
    ]);
  });
});

describe('rename of a field declared in a mixin', () => {
  const createdAtToMadeAt = [
    'mixins.prisma: madeAt Int',
    'mixins.prisma: @@index([madeAt])',
    'mixins.prisma: createdAt Int @map("createdAt")',
    'post.prisma: @@index([madeAt])',
  ];

  it('edits every reference, across files, and adds @map with the old name to the field in a model mixin', () => {
    expect(renameAt('mixins.prisma', 'created|At Int', 'madeAt')).toEqual(createdAtToMadeAt);
  });

  it('returns the same edit from an attribute of an including model in another file', () => {
    expect(renameAt('post.prisma', '@@index([created|At])', 'madeAt')).toEqual(createdAtToMadeAt);
  });

  it('adds no @map to a field that has one', () => {
    expect(renameAt('mixins.prisma', 'updated|At Int', 'changedAt')).toEqual([
      'mixins.prisma: changedAt Int @map("updated_at")',
      'mixins.prisma: @@index([changedAt])',
    ]);
  });

  it('adds no @map to a field whose type is a model', () => {
    expect(renameAt('mixins.prisma', 'edit|or    User', 'author')).toEqual([
      'mixins.prisma: author    User',
    ]);
  });

  it('adds no @map to a field of a type mixin', () => {
    expect(renameAt('mixins.prisma', 'la|t Int', 'latitude')).toEqual([
      'mixins.prisma: latitude Int',
    ]);
  });
});
