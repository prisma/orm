import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { CompletionItemKind, CompletionItemTag } from 'vscode-languageserver';
import {
  complete,
  completeWithSource,
  completionItemByLabel,
  controlMutationDefaults,
  importFromPackageRoot,
} from './helpers/completion-provider';

describe('providePslCompletionItems', () => {
  it('returns bare model field type completion candidates without custom ranking', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  author |', '}'].join('\n'),
    );

    expect(items.map(({ label, detail }) => [label, detail]).sort()).toEqual([
      ['Address', 'Composite type'],
      ['Boolean', 'Configured scalar type'],
      ['DateTime', 'Configured scalar type'],
      ['Email', 'Scalar type'],
      ['Int', 'Configured scalar type'],
      ['Post', 'Model'],
      ['String', 'Configured scalar type'],
      ['User', 'Model'],
      ['UserId', 'Type alias'],
      ['auth', 'Namespace'],
      ['public', 'Namespace'],
    ]);
    for (const item of items) expect(item).not.toHaveProperty('sortText');
    expect(completionItemByLabel(items, 'Boolean').textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'Boolean',
    });
  });

  it('returns the full bare candidate set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  reviewer U|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label).sort()).toEqual([
      'Address',
      'Boolean',
      'DateTime',
      'Email',
      'Int',
      'Post',
      'String',
      'User',
      'UserId',
      'auth',
      'public',
    ]);
    expect(items.find((item) => item.label === 'User')).toMatchObject({
      filterText: 'User',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'U'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'User',
      },
    });
  });

  it('returns the full bare candidate set including the namespace qualifier with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  reviewer a|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label).sort()).toEqual([
      'Address',
      'Boolean',
      'DateTime',
      'Email',
      'Int',
      'Post',
      'String',
      'User',
      'UserId',
      'auth',
      'public',
    ]);
    expect(items.find((item) => item.label === 'auth')).toMatchObject({
      kind: CompletionItemKind.Module,
      detail: 'Namespace',
      filterText: 'auth',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'a'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'auth.',
      },
    });
  });

  it('returns namespace members after a namespace qualifier', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  owner auth.|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label).sort()).toEqual(['Account', 'Profile', 'User']);
    expect(completionItemByLabel(items, 'Account').textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'Account',
    });
  });

  it('returns the full namespace member set with replacement metadata for the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  owner auth.U|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label).sort()).toEqual(['Account', 'Profile', 'User']);
    for (const item of items) expect(item).not.toHaveProperty('sortText');
    expect(items.find((item) => item.label === 'User')).toMatchObject({
      filterText: 'User',
      detail: 'Model',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'U'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'User',
      },
    });
  });

  it('does not leak local namespace members into a foreign contract-space reference', () => {
    const { items } = complete(['model Post {', '  owner supabase:auth.P|', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('returns no completions for a contract-space-qualified position', () => {
    const { items } = complete(['model Post {', '  external supabase:|', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('uses registered scalar documentation for completion details', () => {
    const { items } = completeWithSource({
      markedSource: 'model Post { value | }',
      pslBlockDescriptors: {},
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'documented-scalars',
          authoring: {
            type: {
              String: {
                kind: 'typeConstructor',
                documentation: 'Variable-length Unicode text.',
                output: { codecId: 'fixture/text@1' },
              },
            },
          },
        },
      ]),
      controlMutationDefaults,
    });
    expect(completionItemByLabel(items, 'String').detail).toBe('Variable-length Unicode text.');
    expect(completionItemByLabel(items, 'Int').detail).toBe('Configured scalar type');
  });

  it(
    'offers no field preset of the real Postgres pack in type position',
    async () => {
      const { postgresTargetDescriptorMeta } = await importFromPackageRoot<{
        readonly postgresTargetDescriptorMeta: { readonly authoring: AuthoringContributions };
      }>('../../../3-targets/postgres/1-target/src/core/descriptor-meta.ts');
      const authoringContributions = assembleAuthoringContributions([
        { id: 'postgres', authoring: postgresTargetDescriptorMeta.authoring },
      ]);
      const labels = (markedSource: string) =>
        completeWithSource({
          markedSource,
          pslBlockDescriptors: {},
          clientSupportsSnippets: false,
          authoringContributions,
          controlMutationDefaults,
        }).items.map((item) => item.label);

      const topLevel = labels('model Post { value | }');
      const temporal = labels('model Post { value temporal.| }');
      expect({
        topLevel: ['text', 'json', 'uuidNative', 'id'].filter((name) => topLevel.includes(name)),
        temporal: ['createdAt', 'updatedAt', 'timestamp'].filter((name) => temporal.includes(name)),
        aliases: ['CreatedAt', 'UpdatedAt'].filter((name) => temporal.includes(name)),
      }).toEqual({ topLevel: [], temporal: [], aliases: ['CreatedAt', 'UpdatedAt'] });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'lists deprecated Mongo scalar names tagged deprecated, naming the replacement',
    async () => {
      const { mongoScalarAuthoringTypes } = await importFromPackageRoot<{
        readonly mongoScalarAuthoringTypes: AuthoringTypeNamespace;
      }>('../../../3-targets/mongo/2-adapter/src/exports/control.ts');
      const { items } = completeWithSource({
        markedSource: 'model Post { value | }',
        pslBlockDescriptors: {},
        scalarTypes: Object.keys(mongoScalarAuthoringTypes),
        authoringContributions: assembleAuthoringContributions([
          { id: 'mongo-scalars', authoring: { type: mongoScalarAuthoringTypes } },
        ]),
        controlMutationDefaults,
      });
      const scalars = items.filter((item) => item.kind === CompletionItemKind.Class);
      const current = ['Int32', 'Double', 'Bool', 'Date'];
      const deprecated = [
        ['Int', 'Int32'],
        ['Float', 'Double'],
        ['Boolean', 'Bool'],
        ['DateTime', 'Date'],
      ] as const;

      expect(
        scalars
          .filter((item) => item.tags?.includes(CompletionItemTag.Deprecated))
          .map((item) => item.label)
          .sort(),
      ).toEqual(deprecated.map(([name]) => name).sort());
      for (const name of current) {
        expect(completionItemByLabel(items, name)).not.toHaveProperty('tags');
      }
      for (const [name, replacement] of deprecated) {
        expect(completionItemByLabel(items, name)).toMatchObject({
          tags: [CompletionItemTag.Deprecated],
          detail: expect.stringContaining(`Deprecated: use ${replacement}`),
        });
      }
    },
    timeouts.coldTransformImport,
  );

  it('does not return generic block symbols as model field type candidates', () => {
    const { items } = complete(['model Post {', '  audit |', '}'].join('\n'));

    expect(items.map((item) => item.label)).not.toContain('Audit');
    expect(items.map((item) => item.label)).not.toContain('auth.ScopedAudit');
  });

  it('offers the same field type candidates in a document that holds a mixin and an inclusion', () => {
    const model = ['model Post {', '  author |', '}'].join('\n');
    const mixins = [
      'model mixin Timestamps {',
      '  createdAt DateTime',
      '}',
      'model Tagged {',
      '  id Int',
      '  +Timestamps',
      '}',
    ].join('\n');
    const plain = ['', '', '', 'model Tagged {', '  id Int', '', '}'].join('\n');

    expect(complete(`${mixins}\n${model}`).items).toEqual(complete(`${plain}\n${model}`).items);
  });

  it.each([
    ['in a mixin field type slot', 'model mixin Timestamps {\n  createdAt |\n}'],
    ['in a mixin header', 'model mixin |'],
    ['after the plus of an inclusion', 'model Post {\n  id Int\n  +|\n}'],
    ['inside the name of an inclusion', 'model Post {\n  +auth.Ti|\n}'],
    ['in an enum mixin body', 'enum mixin BaseRoles {\n  |\n}'],
  ])('completes without an error %s', (_case, markedSource) => {
    expect(() => complete(markedSource)).not.toThrow();
  });

  it('does not offer a mixin as a field type, by its name or as a namespace member', () => {
    const mixins = [
      'model mixin Timestamps {',
      '  createdAt DateTime',
      '}',
      'namespace shared {',
      '  model mixin Audited {',
      '    actor String',
      '  }',
      '  model Marker {',
      '    id Int',
      '  }',
      '}',
    ].join('\n');
    const unqualified = complete(`${mixins}\nmodel Post {\n  stamps |\n}`).items;
    const qualified = complete(`${mixins}\nmodel Post {\n  stamps shared.|\n}`).items;

    expect(unqualified.map((item) => item.label)).toContain('shared');
    expect(unqualified.map((item) => item.label)).not.toContain('Timestamps');
    expect(qualified.map((item) => item.label)).toEqual(['Marker']);
  });
});
