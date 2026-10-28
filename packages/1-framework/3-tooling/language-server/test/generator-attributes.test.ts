import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  AuthoringAttributeSpecContributions,
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import {
  assembleGeneratorFunctions,
  type GeneratorFunctionContribution,
  type GeneratorFunctionRegistry,
  type MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/components';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable, EMPTY_DATA_TYPES } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';
import { providePslHover } from '../src/hover';
import { testBinder } from './helpers/binder';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function importFromPackageRoot<T>(relativePath: string): Promise<T> {
  return (await import(pathToFileURL(resolve(packageRoot, relativePath)).href)) as T;
}

interface Stack {
  readonly authoringContributions: ReturnType<typeof assembleAuthoringContributions>;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly generatorFunctions: GeneratorFunctionRegistry;
}

const types: AuthoringTypeNamespace = {
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1' } },
  Time: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'fixture/int', name: 'precision', optional: true }],
    output: { codecId: 'pg/time-temporal@1', typeParams: { precision: { kind: 'arg', index: 0 } } },
  },
};

async function actualPostgresStack(): Promise<Stack> {
  const [attributes, blocks, family, postgres] = await Promise.all([
    importFromPackageRoot<{ sqlAttributeSpecs: AuthoringAttributeSpecContributions }>(
      '../../../2-sql-family/2-authoring/contract-psl/src/sql-attribute-specs.ts',
    ),
    importFromPackageRoot<{
      sqlFamilyPslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
      sqlFamilyEntityTypes: AuthoringEntityTypeNamespace;
    }>('../../../2-sql-family/9-family/src/core/authoring-entity-types.ts'),
    importFromPackageRoot<{
      sqlFamilyGeneratorFunctions: readonly GeneratorFunctionContribution[];
      sqlFamilyGeneratorDescriptors: readonly MutationDefaultGeneratorDescriptor[];
    }>('../../../2-sql-family/9-family/src/core/generator-functions.ts'),
    importFromPackageRoot<{
      postgresGeneratorFunctions: readonly GeneratorFunctionContribution[];
      postgresGeneratorDescriptors: readonly MutationDefaultGeneratorDescriptor[];
    }>('../../../3-targets/postgres/1-target/src/core/generator-functions.ts'),
  ]);
  return {
    authoringContributions: assembleAuthoringContributions([
      {
        id: 'actual-family',
        authoring: {
          attributeSpecs: attributes.sqlAttributeSpecs,
          pslBlockDescriptors: blocks.sqlFamilyPslBlockDescriptors,
          entityTypes: blocks.sqlFamilyEntityTypes,
          type: types,
        },
      },
    ]),
    pslBlockDescriptors: blocks.sqlFamilyPslBlockDescriptors,
    generatorFunctions: assembleGeneratorFunctions([
      {
        id: 'sql',
        generatorFunctions: family.sqlFamilyGeneratorFunctions,
        controlMutationDefaults: { generatorDescriptors: family.sqlFamilyGeneratorDescriptors },
      },
      {
        id: 'postgres',
        generatorFunctions: postgres.postgresGeneratorFunctions,
        controlMutationDefaults: { generatorDescriptors: postgres.postgresGeneratorDescriptors },
      },
    ]),
  };
}

function prepare(markedSource: string, stack: Stack) {
  const offset = markedSource.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const source = markedSource.slice(0, offset) + markedSource.slice(offset + 1);
  const { document, sources } = parse(source, 'language-server-test.psl');
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    defaultNamespaceId: 'public',
  });
  const controlMutationDefaults = { defaultFunctionRegistry: new Map(), generatorDescriptors: [] };
  const binder = testBinder({ ...stack, controlMutationDefaults, sources, symbolTable });
  return { document, sourceFile, symbolTable, binder, offset, controlMutationDefaults };
}

function complete(markedSource: string, stack: Stack, clientSupportsSnippets = false) {
  const { document, sourceFile, symbolTable, binder, offset, controlMutationDefaults } = prepare(
    markedSource,
    stack,
  );
  return providePslCompletionItems({
    context: classifyPslCompletionContext({
      document,
      sourceFile,
      position: sourceFile.positionAt(offset),
    }),
    sourceFile,
    candidates: {
      binder,
      scalarTypes: [],
      pslBlockDescriptors: stack.pslBlockDescriptors,
      symbolTable,
      authoringContributions: stack.authoringContributions,
      controlMutationDefaults,
      generatorFunctions: stack.generatorFunctions,
    },
    clientSupportsSnippets,
  });
}

describe('generator attributes in the language server', {
  timeout: timeouts.coldTransformImport,
}, () => {
  it('offer the functions bound to the field codec inside @onCreate(', async () => {
    const stack = await actualPostgresStack();
    expect({
      text: complete('model Post {\n  id String @onCreate(|)\n}', stack).map((item) => item.label),
      time: complete('model Post {\n  seenAt Time(3) @onUpdate(|)\n}', stack).map(
        (item) => item.label,
      ),
    }).toEqual({ text: ['cuid', 'ksuid', 'nanoid', 'ulid', 'uuid'], time: ['now'] });
  });

  it('offer the arguments of a generator function and write it as a snippet', async () => {
    const stack = await actualPostgresStack();
    const snippetItem = complete('model Post {\n  id String @onCreate(|)\n}', stack, true).find(
      (item) => item.label === 'cuid',
    );
    expect({
      uuidArguments: complete('model Post {\n  id String @onCreate(uuid(|))\n}', stack).map(
        (item) => item.label,
      ),
      cuidSnippet: snippetItem?.textEdit?.newText,
    }).toEqual({ uuidArguments: ['4', '7'], cuidSnippet: 'cuid($' + '{1:version})' });
  });

  it('show the signature of a generator function on hover', async () => {
    const stack = await actualPostgresStack();
    const { document, sourceFile, binder, offset } = prepare(
      'model Post {\n  id String @onCreate(uu|id(7))\n}',
      stack,
    );
    expect(
      providePslHover({
        document,
        sourceFile,
        position: sourceFile.positionAt(offset),
        binder,
        pslBlockDescriptors: stack.pslBlockDescriptors,
        dataTypes: EMPTY_DATA_TYPES,
      })?.contents,
    ).toEqual({
      kind: 'markdown',
      value: '```prisma\nuuid((4 | 7)?)\n```\n\nGenerates a UUID when a value is not supplied.',
    });
  });
});
