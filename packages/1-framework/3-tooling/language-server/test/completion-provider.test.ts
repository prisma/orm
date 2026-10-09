import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  DataTypeAuthoringEntry,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';

import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
  type ControlMutationDefaultRegistry,
} from '@internal/framework-components/control';
import {
  type AttributeSpecNamespace,
  type BlockSpecContext,
  blockAttribute,
  buildSymbolTable,
  entityRef,
  type FieldAttributeSpecContext,
  fieldAttribute,
  identifier,
  int,
  jsonValue,
  mapBlock,
  modelAttribute,
  oneOf,
  optional,
  str,
  structBlock,
} from '@internal/psl-parser';
import { parse, type SourceFile } from '@internal/psl-parser/syntax';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  type CompletionItem,
  CompletionItemKind,
  CompletionItemTag,
  InsertTextFormat,
} from 'vscode-languageserver';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';
import { testBinder } from './helpers/binder';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime'] as const;
const nameSnippetPlaceholder = '$' + '{1:Name}';
const emptySnippetPlaceholder1 = '$' + '{1:}';
const sqlExpressionSnippet = 'sql`$' + '{1:expression}`';
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const markerAttribute = fieldAttribute('marker', {
  documentation: 'Attaches a named marker to a target.',
  positional: [{ key: 'target', type: str(), documentation: 'The marker target.' }],
  named: {
    name: { type: str(), documentation: 'The marker name.' },
    priority: { type: optional(int()), documentation: 'The marker priority.' },
  },
});
const orderFixtureAttribute = fieldAttribute('orderFixture', {
  documentation: 'Accepts named values in declaration order rather than alphabetical order.',
  named: {
    zebra: { type: int(), documentation: 'The first declared value.' },
    alpha: { type: int(), documentation: 'The second declared value.' },
    middle: { type: int(), documentation: 'The third declared value.' },
  },
});
const rlsAttribute = modelAttribute('rls', {
  documentation: 'Configures row-level security for this model.',
  named: {
    enabled: { type: optional(str()), documentation: 'The security enablement setting.' },
    mode: { type: str(), documentation: 'The security mode.' },
  },
});
const auditAttribute = blockAttribute('audit', {
  documentation: 'Configures auditing for this block.',
  named: {
    reason: { type: optional(str()), documentation: 'The reason for auditing.' },
    level: { type: int(), documentation: 'The audit level.' },
  },
});

const attributeContributions = assembleAuthoringContributions([
  {
    id: 'fixture-family',
    authoring: {
      attributeSpecs: {
        field: {
          marker: () => markerAttribute,
          orderFixture: () => orderFixtureAttribute,
          ownerAware: (ctx: FieldAttributeSpecContext) =>
            fieldAttribute('ownerAware', {
              documentation: 'Selects a key based on the declaring model’s fields.',
              named: {
                [Object.hasOwn(ctx.model.fields, 'scopedOnly') ? 'scopedKey' : 'topKey']: {
                  type: str(),
                  documentation: 'The value for the owner-specific key.',
                },
              },
            }),
        },
        model: {},
      },
    },
  },
  {
    id: 'fixture-target',
    authoring: {
      modelAttributes: {
        security: {
          rls: {
            kind: 'modelAttribute',
            attribute: 'rls',
            spec: () => rlsAttribute,
            lower: () => undefined,
          },
        },
      },
    },
  },
]);
const controlMutationDefaults = assembleControlMutationDefaults([]);
const policySpec = () =>
  structBlock({
    parameters: {
      on: { type: optional(entityRef({ kind: 'model' })), documentation: '' },
      where: { type: optional(str()), documentation: 'The policy predicate.' },
      mode: {
        type: optional(
          oneOf(
            identifier('permissive', { documentation: 'Combined with OR.' }),
            identifier('restrictive', { documentation: 'Combined with AND.' }),
          ),
        ),
        documentation: '',
      },
      using: { type: optional(str()), documentation: '' },
    },
  });

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    documentation: 'Defines a security policy.',
    discriminator: 'fixture-policy',
    name: { required: true },
    spec: policySpec,
    attributes: { audit: () => auditAttribute },
  },
  inventory: {
    kind: 'pslBlock',
    keyword: 'inventory',
    documentation: 'An arbitrary-key block.',
    discriminator: 'fixture-inventory',
    name: { required: true },
    spec: () =>
      mapBlock({
        value: { type: jsonValue(), documentation: 'The entry value.' },
        allowBare: true,
      }),
  },
  access: {
    audit: {
      kind: 'pslBlock',
      keyword: 'audit',
      discriminator: 'fixture-audit',
      name: { required: true },
      spec: () =>
        structBlock({
          parameters: {
            on: { type: optional(entityRef({ kind: 'model' })), documentation: '' },
          },
        }),
    },
  },
};

const candidateSource = [
  'types {',
  '  Email = String',
  '  UserId = User',
  '}',
  'model User {',
  '  id Int',
  '  topOnly String',
  '}',
  'type Address {',
  '  street String',
  '}',
  'policy Audit {',
  '  on = read',
  '}',
  'namespace auth {',
  '  model Account {',
  '    id Int',
  '  }',
  '  model User {',
  '    id Int',
  '    scopedOnly String',
  '  }',
  '  type Profile {',
  '    displayName String',
  '  }',
  '  policy ScopedAudit {',
  '    on = read',
  '  }',
  '}',
].join('\n');

function complete(
  markedFieldSource: string,
  options: {
    readonly clientSupportsSnippets?: boolean;
    readonly clientSupportsTriggerParameterHintsCommand?: boolean;
  } = {},
) {
  return completeWithSource({
    markedSource: `${candidateSource}\n${markedFieldSource}`,
    pslBlockDescriptors,
    authoringContributions: attributeContributions,
    controlMutationDefaults,
    clientSupportsSnippets: options.clientSupportsSnippets === true,
    clientSupportsTriggerParameterHintsCommand:
      options.clientSupportsTriggerParameterHintsCommand === true,
  });
}

interface CompletionTestStack {
  readonly attributeSpecs: AttributeSpecNamespace;
  readonly entityTypes: AuthoringEntityTypeNamespace;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

interface ActualSqlAttributeModule {
  readonly sqlAttributeSpecs: AttributeSpecNamespace;
}

interface ActualSqlBlockModule {
  readonly sqlFamilyEntityTypes: AuthoringEntityTypeNamespace;
  readonly sqlFamilyPslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

interface ActualPostgresDefaultsModule {
  createPostgresDefaultFunctionRegistry(): ControlMutationDefaultRegistry;
}

interface ActualPostgresDataTypesModule {
  postgresDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>>;
}

interface ActualSqliteDataTypesModule {
  sqliteDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>>;
}

interface ActualSqlExpressionModule {
  readonly sqlExpressionRegistration: {
    readonly authoring: {
      readonly dataTypes: Readonly<Record<string, DataTypeAuthoringEntry>>;
    };
  };
}

interface ActualMongoAttributeModule {
  readonly mongoAttributeSpecs: AttributeSpecNamespace;
}

interface ActualMongoBlockModule {
  readonly mongoFamilyEntityTypes: AuthoringEntityTypeNamespace;
  readonly mongoFamilyPslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

function completeWithSource(input: {
  readonly markedSource: string;
  readonly siblings?: readonly string[];
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly authoringContributions?: typeof attributeContributions;
  readonly controlMutationDefaults?: typeof controlMutationDefaults;
  readonly dataTypes?: DataTypeSupport;
  readonly clientSupportsSnippets?: boolean;
  readonly clientSupportsTriggerSuggestCommand?: boolean;
  readonly clientSupportsTriggerParameterHintsCommand?: boolean;
  readonly scalarTypes?: readonly string[];
}) {
  const cursorOffset = input.markedSource.indexOf('|');
  expect(cursorOffset).toBeGreaterThanOrEqual(0);
  const source = `${input.markedSource.slice(0, cursorOffset)}${input.markedSource.slice(cursorOffset + 1)}`;
  const parsed = parse(source, 'language-server-test.psl');
  const { document } = parsed;
  const others = (input.siblings ?? []).map((text, index) => parse(text, `sibling-${index}.psl`));
  const sources = parsed.sources.merge(...others.map((other) => other.sources));
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({
    documents: [...others.map((other) => other.document), document],
    sources,
  });
  const context = classifyPslCompletionContext({
    document,
    sourceFile,
    position: sourceFile.positionAt(cursorOffset),
  });

  return {
    items: providePslCompletionItems({
      context,
      sourceFile,
      candidates: {
        binder: testBinder({
          ...input,
          sources,
          symbolTable,
          scalarTypes: input.scalarTypes ?? scalarTypes,
        }),
        scalarTypes: input.scalarTypes ?? scalarTypes,
        pslBlockDescriptors: input.pslBlockDescriptors,
        symbolTable,
        ...(input.authoringContributions === undefined
          ? {}
          : { authoringContributions: input.authoringContributions }),
        ...(input.controlMutationDefaults === undefined
          ? {}
          : { controlMutationDefaults: input.controlMutationDefaults }),
        ...(input.dataTypes === undefined ? {} : { dataTypes: input.dataTypes }),
      },
      clientSupportsSnippets: input.clientSupportsSnippets === true,
      clientSupportsTriggerSuggestCommand: input.clientSupportsTriggerSuggestCommand === true,
      clientSupportsTriggerParameterHintsCommand:
        input.clientSupportsTriggerParameterHintsCommand === true,
    }),
    sourceFile,
    cursorOffset,
  };
}

async function actualSqlStack(): Promise<CompletionTestStack> {
  const [attributes, blocks] = await Promise.all([
    importFromPackageRoot<ActualSqlAttributeModule>(
      '../../../2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts',
    ),
    importFromPackageRoot<ActualSqlBlockModule>(
      '../../../2-sql/9-family/src/core/authoring-entity-types.ts',
    ),
  ]);
  return {
    attributeSpecs: attributes.sqlAttributeSpecs,
    entityTypes: blocks.sqlFamilyEntityTypes,
    pslBlockDescriptors: blocks.sqlFamilyPslBlockDescriptors,
  };
}

async function actualMongoStack(): Promise<CompletionTestStack> {
  const [attributes, blocks] = await Promise.all([
    importFromPackageRoot<ActualMongoAttributeModule>(
      '../../../2-mongo-family/2-authoring/contract-psl/src/mongo-attribute-specs.ts',
    ),
    importFromPackageRoot<ActualMongoBlockModule>(
      '../../../2-mongo-family/9-family/src/core/authoring-entity-types.ts',
    ),
  ]);
  return {
    attributeSpecs: attributes.mongoAttributeSpecs,
    entityTypes: blocks.mongoFamilyEntityTypes,
    pslBlockDescriptors: blocks.mongoFamilyPslBlockDescriptors,
  };
}

async function sqlExpressionDataTypes(): Promise<Readonly<Record<string, DataTypeAuthoringEntry>>> {
  const family = await importFromPackageRoot<ActualSqlExpressionModule>(
    '../../../2-sql/1-core/contract/src/exports/sql-expression.ts',
  );
  return family.sqlExpressionRegistration.authoring.dataTypes;
}

async function importFromPackageRoot<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(resolve(packageRoot, relativePath)).href)) as T;
}

function actualAuthoringContributions(stack: CompletionTestStack): typeof attributeContributions {
  return assembleAuthoringContributions([
    {
      id: 'actual-family',
      authoring: {
        attributeSpecs: stack.attributeSpecs,
        entityTypes: stack.entityTypes,
        pslBlockDescriptors: stack.pslBlockDescriptors,
      },
    },
  ]);
}

function completeWithActualStack(
  markedSource: string,
  stack: CompletionTestStack,
  options: {
    readonly clientSupportsSnippets?: boolean;
    readonly controlMutationDefaults?: typeof controlMutationDefaults;
    readonly dataTypes?: Readonly<Record<string, DataTypeAuthoringEntry>>;
  } = {},
) {
  return completeWithSource({
    markedSource,
    pslBlockDescriptors: stack.pslBlockDescriptors,
    authoringContributions: actualAuthoringContributions(stack),
    ...(options.dataTypes === undefined
      ? {}
      : { dataTypes: { entries: options.dataTypes, lookup: createDataTypeLookup([]) } }),
    controlMutationDefaults: options.controlMutationDefaults ?? controlMutationDefaults,
    clientSupportsSnippets: options.clientSupportsSnippets === true,
  });
}

function applyCompletionItem(input: {
  readonly sourceFile: SourceFile;
  readonly item: CompletionItem;
}) {
  const edit = input.item.textEdit;
  if (edit === undefined || !('range' in edit)) {
    throw new Error('Expected a range text edit');
  }
  const start = input.sourceFile.offsetAt(edit.range.start);
  const end = input.sourceFile.offsetAt(edit.range.end);
  return `${input.sourceFile.text.slice(0, start)}${edit.newText}${input.sourceFile.text.slice(end)}`;
}

function completionItemByLabel(items: readonly CompletionItem[], label: string): CompletionItem {
  const item = items.find((candidate) => candidate.label === label);
  if (item === undefined) {
    throw new Error(`Expected completion item "${label}"`);
  }
  return item;
}

describe('providePslCompletionItems', () => {
  it('filters candidates after nearest-name shadowing and includes namespace locals', () => {
    const { items } = completeWithSource({
      pslBlockDescriptors,
      markedSource: `model Shared { id Int }
model ZRoot { id Int }
type ZAddress { value String }
namespace app {
  enum Shared { VALUE }
  model Int { id String }
  model Local { value | }
  type Address { value String }
}
namespace other { model Hidden { id Int } }`,
    });
    expect(items.map(({ label, detail }) => [label, detail]).sort()).toEqual([
      ['Address', 'Composite type'],
      ['Boolean', 'Configured scalar type'],
      ['DateTime', 'Configured scalar type'],
      ['Int', 'Model'],
      ['Local', 'Model'],
      ['String', 'Configured scalar type'],
      ['ZAddress', 'Composite type'],
      ['ZRoot', 'Model'],
      ['app', 'Namespace'],
      ['other', 'Namespace'],
    ]);
    expect(items.find(({ label }) => label === 'Int')?.kind).toBe(CompletionItemKind.Class);
  });

  it('enumerates only contributed members for a qualified completion', () => {
    const { items } = completeWithSource({
      markedSource: 'model Top { id Int }\nmodel Owner { value custom.| }',
      pslBlockDescriptors: {},
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'constructors',
          authoring: {
            type: {
              custom: {
                Value: {
                  kind: 'typeConstructor',
                  documentation: 'Custom value',
                  output: { codecId: 'value' },
                },
              },
            },
          },
        },
      ]),
    });
    expect(items.map(({ label, kind, detail }) => ({ label, kind, detail }))).toEqual([
      { label: 'Value', kind: CompletionItemKind.Class, detail: 'Custom value' },
    ]);
  });

  it.each([false, true])('inserts namespace dots with negotiated suggestions: %s', (supported) => {
    for (const qualifier of ['', 'custom.']) {
      const { items } = completeWithSource({
        markedSource: `namespace local {}\nmodel Owner { value ${qualifier}| }`,
        pslBlockDescriptors: {},
        clientSupportsSnippets: supported,
        clientSupportsTriggerSuggestCommand: supported,
        authoringContributions: assembleAuthoringContributions([
          { id: 'namespaces', authoring: { type: { custom: { nested: {} } } } },
        ]),
      });
      for (const label of qualifier === '' ? ['local', 'custom'] : ['nested']) {
        const item = completionItemByLabel(items, label);
        expect({
          label: item.label,
          kind: item.kind,
          filterText: item.filterText,
          newText: item.textEdit?.newText,
          format: item.insertTextFormat,
          command: item.command,
        }).toEqual({
          label,
          kind: CompletionItemKind.Module,
          filterText: label,
          newText: `${label}.`,
          format: undefined,
          command: supported
            ? { title: 'Suggest namespace members', command: 'editor.action.triggerSuggest' }
            : undefined,
        });
      }
    }
  });

  it.each([false, true])(
    'renders scalar and constructor presentations with snippets: %s',
    (snippets) => {
      const types: AuthoringTypeNamespace = {
        Scalar: {
          kind: 'typeConstructor',
          output: { codecId: 'fixture/value' },
        },
        Deprecated: {
          kind: 'typeConstructor',
          deprecated: { replacement: 'Scalar' },
          output: { codecId: 'fixture/value' },
        },
        Empty: {
          kind: 'typeConstructor',
          args: [],
          output: { codecId: 'fixture/value' },
        },
        Required: {
          kind: 'typeConstructor',
          args: [
            { name: 'size', kind: 'number' },
            { name: 'label', kind: 'string' },
            { name: 'scale', kind: 'number', optional: true },
          ],
          output: { codecId: 'fixture/value' },
        },
        Optional: {
          kind: 'typeConstructor',
          args: [{ name: 'size', kind: 'number', optional: true }],
          output: { codecId: 'fixture/value' },
        },
        Entity: {
          kind: 'typeConstructor',
          entityRefArg: { index: 0, entityKind: 'choice' },
          output: { codecId: 'fixture/value' },
        },
      };
      for (const qualifier of ['', 'custom.']) {
        const { items } = completeWithSource({
          markedSource: `model Owner { value ${qualifier}| }`,
          pslBlockDescriptors: {},
          scalarTypes: [],
          clientSupportsSnippets: snippets,
          authoringContributions: assembleAuthoringContributions([
            { id: 'constructors', authoring: { type: { ...types, custom: types } } },
          ]),
        });
        for (const [label, snippet] of [
          ['Scalar', 'Scalar'],
          ['Deprecated', 'Deprecated'],
          ['Empty', 'Empty()'],
          ['Required', 'Required($' + '{1:size}, "$' + '{2:label}")'],
          ['Optional', 'Optional($' + '{1:})'],
          ['Entity', 'Entity($' + '{1:choice})'],
        ] as const) {
          const item = completionItemByLabel(items, label);
          const callable = label !== 'Scalar' && label !== 'Deprecated';
          expect({
            label: item.label,
            kind: item.kind,
            newText: item.textEdit?.newText,
            format: item.insertTextFormat,
            command: item.command,
            tags: item.tags,
          }).toEqual({
            label,
            kind: callable ? CompletionItemKind.Function : CompletionItemKind.Class,
            newText: snippets ? snippet : callable ? `${label}()` : label,
            format: callable && snippets ? InsertTextFormat.Snippet : undefined,
            command: undefined,
            tags: label === 'Deprecated' ? [CompletionItemTag.Deprecated] : undefined,
          });
        }
      }
    },
  );

  it('does not complete a global namespace when its qualifier is shadowed locally', () => {
    const { items } = complete(`namespace remote { model Item { id Int } }
namespace app {
  model remote { id Int }
  model Owner { value remote.| }
}`);
    expect(items).toEqual([]);
  });

  it('returns document-level declaration keyword candidates with stable plain-text edits', () => {
    const { items, sourceFile, cursorOffset } = complete('|');

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'types',
      'namespace',
      'audit',
      'inventory',
      'policy',
    ]);
    expect(items.map((item) => item.detail)).toEqual([
      'Defines a data model.',
      'Defines a reusable composite type.',
      'Defines reusable named types.',
      'Groups declarations belonging to the same database schema or database.',
      'Generic block keyword',
      'An arbitrary-key block.',
      'Defines a security policy.',
    ]);
    expect(items[0]).toMatchObject({
      kind: CompletionItemKind.Keyword,
      filterText: 'model',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'model ',
      },
    });
    expect(items[0]?.insertTextFormat).toBeUndefined();
  });

  it('returns the full document-level declaration keyword set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete('mo|');

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'types',
      'namespace',
      'audit',
      'inventory',
      'policy',
    ]);
    expect(items[0]).toMatchObject({
      filterText: 'model',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'mo'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'model ',
      },
    });
  });

  it('returns namespace-body declaration keywords without document-only native keywords', () => {
    const { items } = complete(['namespace feature {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'audit',
      'inventory',
      'policy',
    ]);
    expect(items.map((item) => item.label)).not.toContain('types');
    expect(items.map((item) => item.label)).not.toContain('namespace');
  });

  it('returns the full namespace-body declaration keyword set with a replace range over the typed segment', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['namespace feature {', '  po|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'audit',
      'inventory',
      'policy',
    ]);
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      filterText: 'policy',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'po'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'policy ',
      },
    });
  });

  it('returns snippet declaration keyword edits only when the client supports snippets', () => {
    const { items } = complete('|', { clientSupportsSnippets: true });

    expect(items.find((item) => item.label === 'model')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `model ${nameSnippetPlaceholder} {\n  \${0:// Fields}\n}` },
    });
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        newText: `policy ${nameSnippetPlaceholder} {\n  \${0:// Block keys and attributes}\n}`,
      },
    });
  });

  it.each([true, false])(
    'inserts a body placeholder without pre-filled keys, snippets=%s',
    (snippets) => {
      const { items } = completeWithSource({
        markedSource: '|',
        clientSupportsSnippets: snippets,
        pslBlockDescriptors: {
          security: {
            policy: {
              kind: 'pslBlock',
              keyword: 'policy',
              discriminator: 'policy',
              name: { required: true },
              spec: policySpec,
              attributes: { audit: () => auditAttribute },
            },
          },
        },
      });
      const item = completionItemByLabel(items, 'policy');
      expect(item.textEdit?.newText).toBe(
        snippets
          ? [
              `policy ${nameSnippetPlaceholder} {`,
              '  $' + '{0:// Block keys and attributes}',
              '}',
            ].join('\n')
          : 'policy ',
      );
      expect(item.insertTextFormat).toBe(snippets ? InsertTextFormat.Snippet : undefined);
    },
  );

  it('returns registry-backed attribute name completions as function items', () => {
    const fieldItems = complete(['model Post {', '  id Int @|', '}'].join('\n')).items;
    expect(fieldItems.map((item) => item.label)).toEqual(['marker', 'orderFixture', 'ownerAware']);
    expect(fieldItems.find((item) => item.label === 'marker')?.detail).toBe(
      'Attaches a named marker to a target.',
    );
    expect(fieldItems.map((item) => item.kind)).toEqual([
      CompletionItemKind.Function,
      CompletionItemKind.Function,
      CompletionItemKind.Function,
    ]);

    const modelItems = complete(['model Post {', '  id Int', '  @@|', '}'].join('\n')).items;
    expect(modelItems.map((item) => item.label)).toEqual(['rls']);
    expect(modelItems.map((item) => item.kind)).toEqual([CompletionItemKind.Function]);

    const blockItems = complete(['policy Rule {', '  @@|', '}'].join('\n')).items;
    expect(blockItems.map((item) => item.label)).toEqual(['audit']);
    expect(blockItems.map((item) => item.kind)).toEqual([CompletionItemKind.Function]);
  });

  it('returns configured attribute names from the control stack without an interpretation context', () => {
    const { items } = completeWithSource({
      markedSource: [candidateSource, 'model Post {', '  id Int @|', '}'].join('\n'),
      pslBlockDescriptors,
      authoringContributions: attributeContributions,
      controlMutationDefaults,
    });

    expect(items.map((item) => item.label)).toEqual(['marker', 'orderFixture', 'ownerAware']);
  });

  it('resolves the attribute owner without enumerating declarations', () => {
    const markedSource = ['model User {', '  id Int @|', '}'].join('\n');
    const cursorOffset = markedSource.indexOf('|');
    const source = `${markedSource.slice(0, cursorOffset)}${markedSource.slice(cursorOffset + 1)}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const sourceFile = sources.sourceFileFor(document.syntax);
    const { symbolTable } = buildSymbolTable({ documents: [document], sources });
    const context = classifyPslCompletionContext({
      document,
      sourceFile,
      position: sourceFile.positionAt(cursorOffset),
    });
    let modelEnumerationCount = 0;
    const observedSymbolTable = {
      ...symbolTable,
      topLevel: {
        ...symbolTable.topLevel,
        models: new Proxy(symbolTable.topLevel.models, {
          ownKeys(target) {
            modelEnumerationCount += 1;
            return Reflect.ownKeys(target);
          },
        }),
      },
    };
    const factoryOwnerNames: string[] = [];
    const observedAuthoringContributions = assembleAuthoringContributions([
      {
        id: 'observed-family',
        authoring: {
          attributeSpecs: {
            field: {
              first: (ctx: FieldAttributeSpecContext) => {
                factoryOwnerNames.push(ctx.model.name);
                return fieldAttribute('first', {
                  documentation: 'Marks the first contributed field attribute.',
                });
              },
              second: (ctx: FieldAttributeSpecContext) => {
                factoryOwnerNames.push(ctx.model.name);
                return fieldAttribute('second', {
                  documentation: 'Marks the second contributed field attribute.',
                });
              },
            },
            model: {},
          },
        },
      },
    ]);

    const items = providePslCompletionItems({
      context,
      sourceFile,
      candidates: {
        scalarTypes,
        pslBlockDescriptors,
        symbolTable: observedSymbolTable,
        binder: testBinder({
          sources,
          symbolTable,
          scalarTypes,
          authoringContributions: attributeContributions,
          controlMutationDefaults,
          pslBlockDescriptors,
        }),
        authoringContributions: observedAuthoringContributions,
        controlMutationDefaults,
      },
      clientSupportsSnippets: true,
    });

    expect(items.map((item) => item.label)).toEqual(['first', 'second']);
    expect(factoryOwnerNames).toEqual(['User', 'User']);
    expect(modelEnumerationCount).toBe(0);
  });

  it('returns attribute named keys including optional keys while omitting supplied keys', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['model Post {', '  id Int @marker(name: "id", pr|)', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['priority']);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset - 'pr'.length),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'priority: ',
    });
  });

  it('preserves named-key declaration order while filtering supplied keys', () => {
    const { items } = complete(
      ['model Post {', '  id Int @orderFixture(alpha: 1, |)', '}'].join('\n'),
    );

    expect(items.map((item) => [item.label, item.kind])).toEqual([
      ['zebra', CompletionItemKind.Property],
      ['middle', CompletionItemKind.Property],
    ]);
  });

  it('uses the current declaration owner when model names collide across namespaces', () => {
    const { items } = complete(
      [
        'namespace feature {',
        '  model User {',
        '    scopedOnly String @ownerAware(|)',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['scopedKey']);
  });

  it('inserts required contributed attribute arguments as snippets for snippet clients', () => {
    const { items, sourceFile } = complete(
      ['model Post {', '  id Int @mar| // keep', '}'].join('\n'),
      {
        clientSupportsSnippets: true,
      },
    );
    const item = completionItemByLabel(items, 'marker');

    expect(item).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        newText: `marker("\${1:target}", name: "\${2:name}")`,
      },
    });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [
        candidateSource,
        'model Post {',
        `  id Int @marker("\${1:target}", name: "\${2:name}") // keep`,
        '}',
      ].join('\n'),
    );
  });

  it.each([false, true])('gates argument snippet hints on client support: %s', (supported) => {
    for (const [source, snippets, hints] of [
      ['model Post { id Int @mar| }', true, true],
      ['model Post { id Int @mar| }', false, false],
      ['model Post { id Int @mar|ker("x") }', true, false],
      ['|', true, false],
    ] as const) {
      const { items } = complete(source, {
        clientSupportsSnippets: snippets,
        clientSupportsTriggerParameterHintsCommand: supported,
      });
      const item = completionItemByLabel(items, source === '|' ? 'model' : 'marker');
      expect(item.command).toEqual(
        supported && hints
          ? { title: 'Show argument hints', command: 'editor.action.triggerParameterHints' }
          : undefined,
      );
    }
  });

  it('keeps plain contributed attribute completion free of snippet syntax', () => {
    const { items, sourceFile } = complete(
      ['model Post {', '  id Int @mar| // keep', '}'].join('\n'),
    );
    const item = completionItemByLabel(items, 'marker');

    expect(item.insertTextFormat).toBeUndefined();
    expect(item.textEdit).toMatchObject({ newText: 'marker' });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [candidateSource, 'model Post {', '  id Int @marker // keep', '}'].join('\n'),
    );
  });

  it('preserves existing attribute delimiters and suffixes instead of inserting required arguments again', () => {
    const { items, sourceFile } = complete(
      ['model Post {', '  id Int @mar|ker(name: "id") @unique', '}'].join('\n'),
      { clientSupportsSnippets: true },
    );
    const item = completionItemByLabel(items, 'marker');

    expect(item.insertTextFormat).toBeUndefined();
    expect(item.textEdit).toMatchObject({ newText: 'marker' });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [candidateSource, 'model Post {', '  id Int @marker(name: "id") @unique', '}'].join('\n'),
    );
  });

  it('uses the attribute AST to preserve an incomplete existing argument list', () => {
    const { items, sourceFile } = complete(['model Post {', '  id Int @mar|ker(', '}'].join('\n'), {
      clientSupportsSnippets: true,
    });
    const item = completionItemByLabel(items, 'marker');

    expect(item.insertTextFormat).toBeUndefined();
    expect(item.textEdit).toMatchObject({ newText: 'marker' });
    expect(applyCompletionItem({ sourceFile, item })).toEqual(
      [candidateSource, 'model Post {', '  id Int @marker(', '}'].join('\n'),
    );
  });

  it('uses actual SQL attribute specs for names and top-level named keys', async () => {
    const stack = await actualSqlStack();

    expect(
      completeWithActualStack(['model Post {', '  id Int @|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['default', 'id', 'map', 'noCheck', 'relation', 'unique']);
    expect(
      completeWithActualStack(
        ['model Post {', '  id Int', '  @@|', '}'].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual(['base', 'check', 'control', 'discriminator', 'id', 'index', 'map', 'unique']);
    expect(
      completeWithActualStack(['enum Role {', '  Admin', '  @@|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['type']);

    const { items, sourceFile, cursorOffset } = completeWithActualStack(
      ['model Post {', '  id Int', '  @@index(expression: sql`lower(name)`, ma|)', '}'].join('\n'),
      stack,
    );
    expect(items.map((item) => item.label)).toEqual([
      'where',
      'unique',
      'name',
      'map',
      'type',
      'options',
    ]);
    expect(items.find((item) => item.label === 'map')?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset - 'ma'.length),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'map: ',
    });

    expect(
      completeWithActualStack(
        ['model Post {', '  id Int @default(|)', '}'].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual(['true', 'false', 'null']);

    const mapCompletion = completeWithActualStack(
      ['model Post {', '  id Int @ma| // keep', '}'].join('\n'),
      stack,
      { clientSupportsSnippets: true },
    );
    const mapItem = completionItemByLabel(mapCompletion.items, 'map');
    expect(mapItem).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `map("\${1:name}")` },
    });
    expect(applyCompletionItem({ sourceFile: mapCompletion.sourceFile, item: mapItem })).toEqual(
      ['model Post {', `  id Int @map("\${1:name}") // keep`, '}'].join('\n'),
    );

    const checkCompletion = completeWithActualStack(
      ['model Post {', '  id Int', '  @@che| // keep', '}'].join('\n'),
      stack,
      { clientSupportsSnippets: true, dataTypes: await sqlExpressionDataTypes() },
    );
    const checkItem = completionItemByLabel(checkCompletion.items, 'check');
    expect(checkItem).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `check(expression: ${sqlExpressionSnippet})` },
    });
    expect(
      applyCompletionItem({ sourceFile: checkCompletion.sourceFile, item: checkItem }),
    ).toEqual(
      [
        'model Post {',
        '  id Int',
        `  @@check(expression: ${sqlExpressionSnippet}) // keep`,
        '}',
      ].join('\n'),
    );
  }, 5_000);

  it('offers a sql literal where @@index and @@check take SQL', async () => {
    const stack = await actualSqlStack();
    const dataTypes = await sqlExpressionDataTypes();
    const [entry] = Object.values(dataTypes);
    const valuesAt = (attribute: string) =>
      completeWithActualStack(
        ['model Post {', '  id Int', `  ${attribute}`, '}'].join('\n'),
        stack,
        {
          clientSupportsSnippets: true,
          dataTypes,
        },
      ).items.map((item) => ({
        label: item.label,
        detail: item.detail,
        newText: item.textEdit?.newText,
        insertTextFormat: item.insertTextFormat,
      }));
    const sqlItem = {
      label: 'sql',
      detail: entry?.documentation,
      newText: 'sql`$1`',
      insertTextFormat: InsertTextFormat.Snippet,
    };

    expect(valuesAt('@@index([id], where: |)')).toEqual([sqlItem]);
    expect(valuesAt('@@index(expression: |, map: "post_idx")')).toEqual([sqlItem]);
    expect(valuesAt('@@check(expression: |, name: "post_check")')).toEqual([sqlItem]);
  }, 5_000);

  it('completes model and field attributes when the source has no data types', async () => {
    const stack = await actualSqlStack();
    const labelsAt = (markedSource: string) =>
      completeWithActualStack(markedSource, stack).items.map((item) => item.label);

    expect(labelsAt(['model Post {', '  id Int', '  @@|', '}'].join('\n'))).toEqual([
      'base',
      'check',
      'control',
      'discriminator',
      'id',
      'index',
      'map',
      'unique',
    ]);
    expect(labelsAt(['model Post {', '  id Int @|', '}'].join('\n'))).toEqual([
      'default',
      'id',
      'map',
      'noCheck',
      'relation',
      'unique',
    ]);
    expect(
      labelsAt(['model Post {', '  id Int', '  @@check(expression: |)', '}'].join('\n')),
    ).toEqual([]);
  }, 5_000);

  it('uses actual Mongo attribute specs for names and dynamic factory keys', async () => {
    const stack = await actualMongoStack();

    expect(
      completeWithActualStack(['model Post {', '  id String @|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['id', 'map', 'relation', 'unique']);
    expect(
      completeWithActualStack(
        ['model Post {', '  id String', '  @@|', '}'].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual(['base', 'discriminator', 'index', 'map', 'textIndex', 'unique']);
    expect(
      completeWithActualStack(['enum Role {', '  Admin', '  @@|', '}'].join('\n'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['type']);

    expect(
      completeWithActualStack(
        [
          'namespace scoped {',
          '  model User {',
          '    id String',
          '    localOnly String',
          '    @@index(fields: [id], la|)',
          '  }',
          '}',
          'model User {',
          '  id String',
          '}',
        ].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual([
      'type',
      'sparse',
      'expireAfterSeconds',
      'filter',
      'include',
      'exclude',
      'default_language',
      'languageOverride',
      'collationLocale',
      'collationStrength',
      'collationCaseLevel',
      'collationCaseFirst',
      'collationNumericOrdering',
      'collationAlternate',
      'collationMaxVariable',
      'collationBackwards',
      'collationNormalization',
    ]);
    expect(
      completeWithActualStack(
        ['model Post {', '  author User @relation(name: "Author", f|)', '}'].join('\n'),
        stack,
      ).items.map((item) => item.label),
    ).toEqual(['fields', 'references']);

    const mapCompletion = completeWithActualStack(
      ['model Post {', '  id String @ma| // keep', '}'].join('\n'),
      stack,
      { clientSupportsSnippets: true },
    );
    const mapItem = completionItemByLabel(mapCompletion.items, 'map');
    expect(mapItem).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `map("\${1:name}")` },
    });
    expect(applyCompletionItem({ sourceFile: mapCompletion.sourceFile, item: mapItem })).toEqual(
      ['model Post {', `  id String @map("\${1:name}") // keep`, '}'].join('\n'),
    );
  }, 5_000);

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

  it('completes a generic block value from the block spec', () => {
    const { items } = complete(['policy Rule {', '  on = |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['User', 'auth']);
  });

  it('returns descriptor-backed generic block parameter completions', () => {
    const { items, sourceFile, cursorOffset } = complete(['policy Rule {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode', 'using']);
    expect(items.map((item) => item.detail)).toEqual([
      'Generic block parameter',
      'The policy predicate.',
      'Generic block parameter',
      'Generic block parameter',
    ]);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'on = ',
    });
  });

  it('returns the full descriptor-backed generic block parameter set excluding already-present sibling keys', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['policy Rule {', '  on = User', '  wh|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['where', 'mode', 'using']);
    expect(items.find((item) => item.label === 'where')).toMatchObject({
      filterText: 'where',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'wh'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'where = ',
      },
    });
  });

  it('uses generic block parameter documentation with a fallback for undocumented parameters', () => {
    const { items } = complete('policy Rule { | }');
    expect(completionItemByLabel(items, 'where').detail).toBe('The policy predicate.');
    expect(completionItemByLabel(items, 'on').detail).toBe('Generic block parameter');
  });

  it('still offers the in-progress key while excluding an already-present sibling key', () => {
    const { items } = complete(['policy Rule {', '  where = "x"', '  on|', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'mode', 'using']);
  });

  it('returns no generic block parameter completions without a matching descriptor', () => {
    const { items } = complete(['extension Rule {', '  |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('offers no key candidates for an arbitrary-key block spec', () => {
    const { items } = complete(['inventory Stock {', '  |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('keeps key completion available inside an invalid block', () => {
    const { items } = complete(
      ['policy Rule {', '  bogus = "not a declared key"', '  |', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode', 'using']);
  });

  it('calls the spec factory with the spec context and never invokes rule parsing', () => {
    const dataTypes: DataTypeSupport = { entries: {}, lookup: createDataTypeLookup([]) };
    const factoryContexts: BlockSpecContext[] = [];
    const throwingRule = {
      kind: 'str' as const,
      label: 'string',
      value: undefined,
      parse: () => {
        throw new Error('metadata inspection must not invoke rule parsing');
      },
    };
    const { items } = completeWithSource({
      markedSource: ['guard Rule {', '  |', '}'].join('\n'),
      pslBlockDescriptors: {
        guard: {
          kind: 'pslBlock',
          keyword: 'guard',
          discriminator: 'fixture-guard',
          name: { required: true },
          spec: (ctx: BlockSpecContext) => {
            factoryContexts.push(ctx);
            return structBlock({
              parameters: {
                shield: { type: throwingRule, documentation: 'The shield key.' },
              },
            });
          },
        },
      },
      dataTypes,
    });

    expect(items.map((item) => item.label)).toEqual(['shield']);
    expect(items[0]?.detail).toBe('The shield key.');
    expect(factoryContexts).toHaveLength(2);
    for (const ctx of factoryContexts) {
      expect(ctx).toEqual({ symbols: expect.any(Object), dataTypes: expect.any(Object) });
      expect(ctx.dataTypes).toBe(dataTypes);
    }
  });

  it.each(['|', '[|]', '{ nested: | }', '[{ nested: [|] }]'])(
    'completes recursive JSON values at %s',
    (value) => {
      const { items } = completeWithSource({
        markedSource: `model Post { value String @jsonFixture(${value}) }`,
        pslBlockDescriptors: {},
        authoringContributions: assembleAuthoringContributions([
          {
            id: 'json-fixture',
            authoring: {
              attributeSpecs: {
                field: {
                  jsonFixture: () =>
                    fieldAttribute('jsonFixture', {
                      documentation: '',
                      positional: [{ key: 'value', type: jsonValue(), documentation: '' }],
                    }),
                },
                model: {},
              },
            },
          },
        ]),
        controlMutationDefaults,
      });
      expect(items.map((item) => item.label)).toEqual(['true', 'false', 'null']);
    },
  );

  it('returns an empty list for unsupported classifier contexts', () => {
    const { items } = complete(['model Post {', '  // @|', '}'].join('\n'));

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

  it('completes a field preset as a call', () => {
    const { items } = completeWithSource({
      markedSource: 'model Post { value | }',
      pslBlockDescriptors: {},
      clientSupportsSnippets: false,
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'presets',
          authoring: {
            field: {
              stamp: {
                kind: 'fieldPreset',
                output: { codecId: 'fixture/timestamp@1' },
              },
            },
          },
        },
      ]),
      controlMutationDefaults,
    });
    const item = completionItemByLabel(items, 'stamp');
    expect({
      kind: item.kind,
      detail: item.detail,
      newText: item.textEdit === undefined ? undefined : item.textEdit.newText,
    }).toEqual({ kind: CompletionItemKind.Function, detail: 'Field preset', newText: 'stamp()' });
  });

  it(
    'lists deprecated Mongo scalar names tagged deprecated, naming the replacement',
    async () => {
      const { mongoScalarAuthoringTypes } = await importFromPackageRoot<{
        readonly mongoScalarAuthoringTypes: AuthoringTypeNamespace;
      }>('../../../3-mongo-target/2-mongo-adapter/src/exports/control.ts');
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

  it('uses actual SQL enum metadata and rejects an empty enum without invented values', async () => {
    const stack = await actualSqlStack();
    const names = (schema: string) =>
      completeWithActualStack(schema, stack).items.map((item) => item.label);
    expect(names('enum Mood { Happy Sad }\nmodel Post { mood Mood @default(|) }')).toEqual([
      'Happy',
      'Sad',
    ]);
    expect(names('enum Mood {}\nmodel Post { mood Mood @default(|) }')).toEqual([]);
    expect(
      names(
        'enum Mood { Top }\nnamespace scoped { enum Mood { Scoped }\nmodel Post { mood scoped.Mood @default(|) } }',
      ),
    ).toEqual(['Scoped']);
    const degraded = names('enum Mood { Happy Happy }\nmodel Post { mood Mood @default(|) }');
    expect(degraded).toEqual(['Happy']);
  }, 5_000);

  it('uses actual adapter default-function signatures through the SQL factory', async () => {
    const stack = await actualSqlStack();
    const defaults = await importFromPackageRoot<ActualPostgresDefaultsModule>(
      '../../../3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts',
    );
    const options = {
      controlMutationDefaults: {
        ...controlMutationDefaults,
        defaultFunctionRegistry: defaults.createPostgresDefaultFunctionRegistry(),
      },
    };
    const source = (args: string) => `model Post { value String @default(${args}) }`;
    const candidates = completeWithActualStack(source('|'), stack, options).items;
    expect(candidates.map((item) => item.label)).toEqual([
      'true',
      'false',
      'null',
      'autoincrement',
      'now',
      'uuid',
      'cuid',
      'ulid',
      'nanoid',
    ]);
    expect(
      completeWithActualStack(source('uuid(|)'), stack, options).items.map((item) => item.label),
    ).toEqual(['4', '7']);
    expect(
      completeWithActualStack(source('cuid(|)'), stack, options).items.map((item) => item.label),
    ).toEqual(['2']);
    expect(completeWithActualStack(source('nanoid(|)'), stack, options).items).toEqual([]);
    const snippetItems = completeWithActualStack(source('|'), stack, {
      ...options,
      clientSupportsSnippets: true,
    }).items;
    expect(completionItemByLabel(snippetItems, 'uuid').textEdit?.newText).toBe(
      `uuid(${emptySnippetPlaceholder1})`,
    );
    expect(completionItemByLabel(snippetItems, 'cuid').textEdit?.newText).toBe(
      'cuid($' + '{1:version})',
    );
  }, 5_000);

  it('offers each registered tag inside @default( with its own documentation', async () => {
    const stack = await actualSqlStack();
    const [postgres, sqlite, family] = await Promise.all([
      importFromPackageRoot<ActualPostgresDataTypesModule>(
        '../../../3-targets/3-targets/postgres/src/exports/data-types.ts',
      ),
      importFromPackageRoot<ActualSqliteDataTypesModule>(
        '../../../3-targets/3-targets/sqlite/src/exports/data-types.ts',
      ),
      importFromPackageRoot<ActualSqlExpressionModule>(
        '../../../2-sql/1-core/contract/src/exports/sql-expression.ts',
      ),
    ]);
    const withFamilyEntry = (
      targetEntries: Readonly<Record<string, DataTypeAuthoringEntry>>,
    ): Readonly<Record<string, DataTypeAuthoringEntry>> => ({
      ...family.sqlExpressionRegistration.authoring.dataTypes,
      ...targetEntries,
    });
    const complete = (
      dataTypes: Readonly<Record<string, DataTypeAuthoringEntry>>,
      clientSupportsSnippets: boolean,
    ) =>
      completeWithActualStack('model Post { value String @default(|) }', stack, {
        clientSupportsSnippets,
        controlMutationDefaults,
        dataTypes,
      }).items.map((item) => ({
        label: item.label,
        detail: item.detail,
        newText: item.textEdit?.newText,
        insertTextFormat: item.insertTextFormat,
      }));
    const postgresEntries = withFamilyEntry(postgres.postgresDataTypeEntries());
    const documentationOf = (
      entries: Readonly<Record<string, DataTypeAuthoringEntry>>,
      tag: string,
    ) =>
      Object.values(entries).find(
        (entry) => entry.written.kind === 'tag' && entry.written.tag === tag,
      )?.documentation;
    const value = (label: string) => ({
      label,
      detail: 'PSL argument value',
      newText: label,
      insertTextFormat: undefined,
    });
    const tag = (
      entries: Readonly<Record<string, DataTypeAuthoringEntry>>,
      label: string,
      snippet: boolean,
    ) => ({
      label,
      detail: documentationOf(entries, label),
      newText: snippet ? `${label}\`$1\`` : label,
      insertTextFormat: snippet ? InsertTextFormat.Snippet : undefined,
    });

    expect(complete(postgresEntries, true)).toEqual([
      value('true'),
      value('false'),
      value('null'),
      tag(postgresEntries, 'sql', true),
      tag(postgresEntries, 'json', true),
    ]);
    const sqliteEntries = withFamilyEntry(sqlite.sqliteDataTypeEntries());
    expect(complete(sqliteEntries, true)).toEqual([
      value('true'),
      value('false'),
      value('null'),
      tag(sqliteEntries, 'sql', true),
      tag(sqliteEntries, 'json', true),
    ]);
    expect(complete(postgresEntries, false)).toEqual([
      value('true'),
      value('false'),
      value('null'),
      tag(postgresEntries, 'sql', false),
      tag(postgresEntries, 'json', false),
    ]);

    // Each tag carries the text of the tag it names, not every registered tag's text.
    expect(documentationOf(postgresEntries, 'json')).not.toBe(
      documentationOf(postgresEntries, 'sql'),
    );
  }, 5_000);

  it('uses distinct local and referenced fields through actual SQL relation specs', async () => {
    const stack = await actualSqlStack();
    const schema = (args: string) =>
      `model Target { topOnly Int }\nnamespace remote { model Target { remoteOnly Int } }\nmodel Owner { ownOnly Int\n relation remote.Target @relation(${args}) }`;
    expect(
      completeWithActualStack(schema('fields: [|]'), stack).items.map((item) => item.label),
    ).toEqual(['ownOnly']);
    expect(
      completeWithActualStack(schema('references: [|]'), stack).items.map((item) => item.label),
    ).toEqual(['remoteOnly']);
    expect(
      completeWithActualStack(schema('onDelete: |'), stack).items.map((item) => item.label),
    ).toEqual(['NoAction', 'Restrict', 'Cascade', 'SetNull', 'SetDefault']);
  }, 5_000);

  it('uses actual Mongo sort functions and completes their positional arguments', async () => {
    const stack = await actualMongoStack();
    const schema = (args: string) => `model Post { title String\n slug String\n @@index(${args}) }`;
    const plain = completeWithActualStack(schema('[|]'), stack).items;
    expect(plain.map((item) => item.label)).toEqual(['title', 'slug', 'wildcard', 'sort']);
    const snippets = completeWithActualStack(schema('[|]'), stack, {
      clientSupportsSnippets: true,
    }).items;
    expect(snippets.map((item) => [item.label, item.textEdit?.newText])).toEqual([
      ['title', 'title'],
      ['slug', 'slug'],
      ['wildcard', `wildcard(${emptySnippetPlaceholder1})`],
      ['sort', 'sort($' + '{1:field}, $' + '{2:direction})'],
    ]);
    expect(
      completeWithActualStack(schema('[sort(|)]'), stack).items.map((item) => item.label),
    ).toEqual(['title', 'slug']);
    expect(
      completeWithActualStack(schema('[sort(title, |)]'), stack).items.map((item) => item.label),
    ).toEqual(['Asc', 'Desc']);
    expect(completeWithActualStack(schema('[wildcard(|)]'), stack).items).toEqual([]);
    expect(
      completeWithActualStack(schema('[title], type: |'), stack).items.map((item) => item.label),
    ).toEqual(['1', '-1', '"text"', '"2dsphere"', '"2d"', '"hashed"']);
  }, 5_000);

  it('scopes actual Mongo sort fields to the declaring namespace model', async () => {
    const stack = await actualMongoStack();
    const schema =
      'model Post { topOnly String }\nnamespace scoped { model Post { scopedOnly String\n @@index([|]) } }';
    expect(
      completeWithActualStack(schema, stack, { clientSupportsSnippets: true }).items.map((item) => [
        item.label,
        item.textEdit?.newText,
      ]),
    ).toEqual([
      ['scopedOnly', 'scopedOnly'],
      ['wildcard', `wildcard(${emptySnippetPlaceholder1})`],
      ['sort', 'sort($' + '{1:field}, $' + '{2:direction})'],
    ]);
    expect(
      completeWithActualStack(schema.replace('[|]', '[sort(|)]'), stack).items.map(
        (item) => item.label,
      ),
    ).toEqual(['scopedOnly']);
  }, 5_000);

  it('does not return generic block symbols as model field type candidates', () => {
    const { items } = complete(['model Post {', '  audit |', '}'].join('\n'));

    expect(items.map((item) => item.label)).not.toContain('Audit');
    expect(items.map((item) => item.label)).not.toContain('auth.ScopedAudit');
  });
});
