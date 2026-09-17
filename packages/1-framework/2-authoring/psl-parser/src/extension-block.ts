import {
  type AuthoringPslBlockDescriptor,
  type AuthoringPslBlockDescriptorNamespace,
  isAuthoringPslBlockDescriptor,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  type PslModel,
  type PslSpan,
  UNSPECIFIED_PSL_NAMESPACE_ID,
  validateExtensionBlock,
} from '@internal/framework-components/psl-ast';
import { diagnosticFromSpan, diagnosticSource, type PslDiagnostic } from './diagnostic';
import type { PslSources } from './source-file';
import type { BlockSymbol, ModelSymbol, SymbolTable } from './symbol-table';

export function findBlockDescriptor(
  descriptors: AuthoringPslBlockDescriptorNamespace | undefined,
  keyword: string,
): AuthoringPslBlockDescriptor | undefined {
  if (descriptors === undefined) return undefined;
  for (const value of Object.values(descriptors)) {
    if (value === undefined) continue;
    if (isAuthoringPslBlockDescriptor(value)) {
      if (value.keyword === keyword) return value;
      continue;
    }
    const nested = findBlockDescriptor(value, keyword);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function validateExtensionBlockFromSymbol(input: {
  readonly block: BlockSymbol;
  readonly descriptor: AuthoringPslBlockDescriptor;
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly codecLookup: CodecLookup;
}): readonly PslDiagnostic[] {
  const refCtx = buildRefResolutionContext(input.symbolTable, input.block);
  return validateExtensionBlock(
    input.block.block,
    input.descriptor,
    input.sources.sourceFileFor(input.block.node.syntax).filename,
    input.codecLookup,
    refCtx,
  ).map((diagnostic) =>
    diagnosticFromSpan(diagnostic, diagnosticSource(input.sources, input.block.node.syntax)),
  );
}

const ZERO_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function buildRefResolutionContext(
  symbolTable: SymbolTable,
  block: BlockSymbol,
): {
  ownerNamespace: ReturnType<typeof makePslNamespace>;
  allNamespaces: readonly ReturnType<typeof makePslNamespace>[];
} {
  const unspecifiedNamespace = makeNamespace(
    UNSPECIFIED_PSL_NAMESPACE_ID,
    Object.values(symbolTable.topLevel.models),
  );
  const namedNamespaces = Object.values(symbolTable.topLevel.namespaces).map((namespace) =>
    makeNamespace(namespace.name, Object.values(namespace.models)),
  );
  const allNamespaces = [unspecifiedNamespace, ...namedNamespaces];
  const ownerNamespaceName = findOwnerNamespaceName(symbolTable, block);
  const ownerNamespace =
    allNamespaces.find((namespace) => namespace.name === ownerNamespaceName) ??
    unspecifiedNamespace;
  return { ownerNamespace, allNamespaces };
}

function makeNamespace(
  name: string,
  models: readonly ModelSymbol[],
): ReturnType<typeof makePslNamespace> {
  const modelStubs: PslModel[] = models.map((model) => ({
    kind: 'model',
    name: model.name,
    fields: [],
    attributes: [],
    span: ZERO_SPAN,
  }));
  return makePslNamespace({
    kind: 'namespace',
    name,
    entries: makePslNamespaceEntries(modelStubs, [], []),
    span: ZERO_SPAN,
  });
}

function findOwnerNamespaceName(symbolTable: SymbolTable, block: BlockSymbol): string {
  for (const namespace of Object.values(symbolTable.topLevel.namespaces)) {
    if (Object.values(namespace.blocks).some((candidate) => candidate === block)) {
      return namespace.name;
    }
  }
  return UNSPECIFIED_PSL_NAMESPACE_ID;
}
