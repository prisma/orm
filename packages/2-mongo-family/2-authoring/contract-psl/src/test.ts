import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
} from '@internal/config/config-types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { ControlStack } from '@internal/framework-components/control';
import type { Binder, SymbolTable } from '@internal/psl-parser';
import { buildSymbolTable, createBinder, mapPslDiagnostics } from '@internal/psl-parser';
import type { DocumentAst, PslSources } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import type { InterpretPslDocumentToMongoContractInput } from './interpreter';

/**
 * Derives the `ContractSourceContext` `bindPslSchema` (and
 * `createBinder`) need from a `ControlStack` a test assembled with
 * `createControlStack`. Mirrors the mapping `loadContractSourceWithStack`
 * applies in production, minus the parts only a running command has
 * (`resolvedInputs`, `reportWarning`).
 */
export function contractSourceContextFromControlStack(
  stack: ControlStack,
  overrides?: Partial<ContractSourceContext>,
): ContractSourceContext {
  return {
    composedExtensions: stack.extensions.map((extension) => extension.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [],
    capabilities: stack.capabilities,
    ...overrides,
  };
}

export type MongoContextInput = Pick<
  InterpretPslDocumentToMongoContractInput,
  | 'scalarTypeCodecIds'
  | 'controlMutationDefaults'
  | 'codecLookup'
  | 'authoringContributions'
  | 'reportWarning'
>;

export interface BoundPslSchema {
  readonly documents: readonly DocumentAst[];
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly binder: Binder;
  readonly context: ContractSourceContext;
  readonly seedDiagnostics: readonly ContractSourceDiagnostic[];
  readonly contextInput: MongoContextInput;
}

export function bindPslSchema(
  schema: string,
  options: { readonly context: ContractSourceContext; readonly sourceId?: string },
): BoundPslSchema {
  const { context } = options;
  const { document, sources } = parse(schema, options.sourceId ?? 'schema.prisma');
  const documents = [document];
  const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    documents,
    sources,
  });
  const { binder, diagnostics: binderDiagnostics } = createBinder({
    symbolTable,
    sources,
    context,
  });
  return {
    documents,
    sources,
    symbolTable,
    binder,
    context,
    seedDiagnostics: mapPslDiagnostics([...symbolTableDiagnostics, ...binderDiagnostics], sources),
    contextInput: {
      scalarTypeCodecIds: new Map(
        [...collectScalarTypeConstructors(context.authoringContributions.type)].map(
          ([name, output]) => [name, output.codecId],
        ),
      ),
      controlMutationDefaults: {
        ...context.controlMutationDefaults,
        dataTypeEntries: context.authoringContributions.dataTypes,
      },
      codecLookup: context.codecLookup,
      authoringContributions: context.authoringContributions,
      ...(context.reportWarning ? { reportWarning: context.reportWarning } : {}),
    },
  };
}
