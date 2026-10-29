import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
  DataTypeAuthoringEntry,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup, dataType } from '@internal/framework-components/codec';
import {
  EMPTY_GENERATOR_FUNCTIONS,
  type GeneratorFunctionRegistry,
} from '@internal/framework-components/components';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
  type ControlMutationDefaultRegistry,
} from '@internal/framework-components/control';
import {
  type AttributeSpecNamespace,
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
import { expect } from 'vitest';
import type { CompletionItem } from 'vscode-languageserver';
import { classifyPslCompletionContext } from '../../src/completion-context';
import { providePslCompletionItems } from '../../src/completion-provider';
import { testBinder } from './binder';

export const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime'] as const;
export const nameSnippetPlaceholder = '$' + '{1:Name}';
export const emptySnippetPlaceholder1 = '$' + '{1:}';
export const sqlExpressionSnippet = 'sql`$' + '{1:expression}`';
export const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const markerAttribute = fieldAttribute('marker', {
  documentation: 'Attaches a named marker to a target.',
  positional: [{ key: 'target', type: str(), documentation: 'The marker target.' }],
  named: {
    name: { type: str(), documentation: 'The marker name.' },
    priority: { type: optional(int()), documentation: 'The marker priority.' },
  },
});
export const orderFixtureAttribute = fieldAttribute('orderFixture', {
  documentation: 'Accepts named values in declaration order rather than alphabetical order.',
  named: {
    zebra: { type: int(), documentation: 'The first declared value.' },
    alpha: { type: int(), documentation: 'The second declared value.' },
    middle: { type: int(), documentation: 'The third declared value.' },
  },
});
export const rlsAttribute = modelAttribute('rls', {
  documentation: 'Configures row-level security for this model.',
  named: {
    enabled: { type: optional(str()), documentation: 'The security enablement setting.' },
    mode: { type: str(), documentation: 'The security mode.' },
  },
});
export const auditAttribute = blockAttribute('audit', {
  documentation: 'Configures auditing for this block.',
  named: {
    reason: { type: optional(str()), documentation: 'The reason for auditing.' },
    level: { type: int(), documentation: 'The audit level.' },
  },
});

export const attributeContributions = assembleAuthoringContributions([
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
export const controlMutationDefaults = assembleControlMutationDefaults([]);
export const policySpec = () =>
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

export const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
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

export const candidateSource = [
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

export function complete(
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

export interface CompletionTestStack {
  readonly attributeSpecs: AttributeSpecNamespace;
  readonly entityTypes: AuthoringEntityTypeNamespace;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

export interface ActualSqlAttributeModule {
  readonly sqlAttributeSpecs: AttributeSpecNamespace;
}

export interface ActualSqlBlockModule {
  readonly sqlFamilyEntityTypes: AuthoringEntityTypeNamespace;
  readonly sqlFamilyPslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

export interface ActualPostgresDefaultsModule {
  createPostgresDefaultFunctionRegistry(): ControlMutationDefaultRegistry;
}

export interface ActualPostgresDataTypesModule {
  postgresDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>>;
}

export interface ActualSqliteDataTypesModule {
  sqliteDataTypeEntries(): Readonly<Record<string, DataTypeAuthoringEntry>>;
}

export interface ActualSqlExpressionModule {
  readonly sqlExpressionRegistration: {
    readonly authoring: {
      readonly dataTypes: Readonly<Record<string, DataTypeAuthoringEntry>>;
    };
  };
}

export interface ActualMongoAttributeModule {
  readonly mongoAttributeSpecs: AttributeSpecNamespace;
}

export interface ActualMongoBlockModule {
  readonly mongoFamilyEntityTypes: AuthoringEntityTypeNamespace;
  readonly mongoFamilyPslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

export function completeWithSource(input: {
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
  readonly generatorFunctions?: GeneratorFunctionRegistry;
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
    defaultNamespaceId: 'public',
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
        generatorFunctions: input.generatorFunctions ?? EMPTY_GENERATOR_FUNCTIONS,
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

export async function actualSqlStack(): Promise<CompletionTestStack> {
  const [attributes, blocks] = await Promise.all([
    importFromPackageRoot<ActualSqlAttributeModule>(
      '../../../2-sql-family/2-authoring/contract-psl/src/sql-attribute-specs.ts',
    ),
    importFromPackageRoot<ActualSqlBlockModule>(
      '../../../2-sql-family/9-family/src/core/authoring-entity-types.ts',
    ),
  ]);
  return {
    attributeSpecs: attributes.sqlAttributeSpecs,
    entityTypes: blocks.sqlFamilyEntityTypes,
    pslBlockDescriptors: blocks.sqlFamilyPslBlockDescriptors,
  };
}

export async function actualMongoStack(): Promise<CompletionTestStack> {
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

export const fixtureInt = dataType('fixture/int', { read: (json) => json });
export const fixtureExpression = dataType('fixture/expression', { read: (json) => json });
export const constructorArgumentDataTypes: DataTypeSupport = {
  entries: {
    [fixtureInt.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [fixtureInt.id],
        classify: (text) => ({ type: fixtureInt.id, value: Number(text) }),
      },
      print: String,
      documentation: 'A whole number.',
    },
    [fixtureExpression.id]: {
      written: { kind: 'tag', tag: 'sql', parse: (text) => text },
      print: String,
      documentation: 'A SQL expression.',
    },
  },
  lookup: createDataTypeLookup([fixtureInt, fixtureExpression]),
  dataTypeOfCodec: () => undefined,
};

export async function sqlExpressionDataTypes(): Promise<
  Readonly<Record<string, DataTypeAuthoringEntry>>
> {
  const family = await importFromPackageRoot<ActualSqlExpressionModule>(
    '../../../2-sql-family/1-core/contract/src/exports/sql-expression.ts',
  );
  return family.sqlExpressionRegistration.authoring.dataTypes;
}

export async function importFromPackageRoot<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(resolve(packageRoot, relativePath)).href)) as T;
}

export function actualAuthoringContributions(
  stack: CompletionTestStack,
): typeof attributeContributions {
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

export function completeWithActualStack(
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
      : {
          dataTypes: {
            entries: options.dataTypes,
            lookup: createDataTypeLookup([]),
            dataTypeOfCodec: () => undefined,
          },
        }),
    controlMutationDefaults: options.controlMutationDefaults ?? controlMutationDefaults,
    clientSupportsSnippets: options.clientSupportsSnippets === true,
  });
}

export function applyCompletionItem(input: {
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

export function completionItemByLabel(
  items: readonly CompletionItem[],
  label: string,
): CompletionItem {
  const item = items.find((candidate) => candidate.label === label);
  if (item === undefined) {
    throw new Error(`Expected completion item "${label}"`);
  }
  return item;
}
