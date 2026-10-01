import type {
  Binder,
  FieldSymbol,
  ModelSymbol,
  PslDiagnosticCollector,
  ResolvedAttribute,
  SymbolTable,
} from '@internal/psl-parser';
import { createPslDiagnosticCollector, diagnosticSource, nodePslSpan } from '@internal/psl-parser';
import type { ModelAttributeAst, PslSources } from '@internal/psl-parser/syntax';
import type { HintEntry } from '@internal/sql-contract-ts/contract-builder';
import {
  duplicateModelAttributeDiagnostic,
  getAttribute,
  storageName,
} from './psl-attribute-parsing';
import type { ModelNamespaceEntry } from './psl-field-resolution';
import {
  interpretModelAttribute,
  PSL_HINT_INVALID,
  sqlAttributeSpecs,
} from './sql-attribute-specs';

export interface CollectHintsInput {
  readonly modelEntries: readonly ModelNamespaceEntry[];
  readonly physicalNames: ReadonlyMap<ModelSymbol | FieldSymbol, string>;
  readonly defaultNamespaceId: string;
  readonly symbols: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}

interface DeclaredHint {
  readonly model: ModelSymbol;
  readonly namespaceId: string | undefined;
  readonly attribute: ResolvedAttribute<ModelAttributeAst>;
  readonly was: string;
}

function hintAttributes(model: ModelSymbol): readonly ResolvedAttribute<ModelAttributeAst>[] {
  return model.attributes.filter((attribute) => attribute.name === 'hint');
}

export function collectHints(input: CollectHintsInput): { readonly hints: HintEntry[] } {
  const { diagnostics, sources } = input;
  const reject = (
    model: ModelSymbol,
    attribute: ResolvedAttribute<ModelAttributeAst>,
    message: string,
  ): void => {
    diagnostics.push({
      code: PSL_HINT_INVALID,
      message,
      ...diagnosticSource(sources, model.node.syntax).at(
        nodePslSpan(attribute.node.syntax, sources),
      ),
    });
  };

  const baseOf = (model: ModelSymbol): ModelSymbol | undefined => {
    const node = getAttribute(model.attributes, 'base')?.node;
    if (node === undefined) return undefined;
    return interpretModelAttribute({
      node,
      spec: sqlAttributeSpecs.model.base(),
      model,
      symbols: input.symbols,
      sources,
      binder: input.binder,
      diagnostics: createPslDiagnosticCollector(sources),
    })?.base.declaration;
  };
  const sharesBaseTable = (model: ModelSymbol): boolean =>
    getAttribute(model.attributes, 'map') === undefined && baseOf(model) !== undefined;
  const tableOwner = (model: ModelSymbol): ModelSymbol => {
    let owner = model;
    const visited = new Set<ModelSymbol>();
    while (sharesBaseTable(owner) && !visited.has(owner)) {
      visited.add(owner);
      owner = baseOf(owner) ?? owner;
    }
    return owner;
  };

  const namespaceKey = (namespaceId: string | undefined) => namespaceId ?? input.defaultNamespaceId;
  const tableDeclarers = new Map<string, Map<string, ModelSymbol>>();
  for (const { model, namespaceId } of input.modelEntries) {
    if (sharesBaseTable(model)) continue;
    const key = namespaceKey(namespaceId);
    const declarers = tableDeclarers.get(key) ?? new Map<string, ModelSymbol>();
    tableDeclarers.set(key, declarers);
    const table = storageName(model, input.physicalNames);
    if (!declarers.has(table)) declarers.set(table, model);
  }

  const declaredHints: DeclaredHint[] = [];
  for (const { model, namespaceId } of input.modelEntries) {
    const [attribute, ...duplicates] = hintAttributes(model);
    if (attribute === undefined) continue;
    for (const duplicate of duplicates) {
      diagnostics.push(
        duplicateModelAttributeDiagnostic({
          name: 'hint',
          modelName: model.name,
          source: diagnosticSource(sources, model.node.syntax),
          span: duplicate.span,
        }),
      );
    }
    const parsed = interpretModelAttribute({
      node: attribute.node,
      spec: sqlAttributeSpecs.model.hint(),
      model,
      symbols: input.symbols,
      sources,
      binder: input.binder,
      diagnostics,
    });
    if (parsed?.was === undefined) continue;
    declaredHints.push({ model, namespaceId, attribute, was: parsed.was });
  }

  const hints: HintEntry[] = [];
  const claimants = new Map<string, Map<string, ModelSymbol>>();
  for (const { model, namespaceId, attribute, was } of declaredHints) {
    const owner = tableOwner(model);
    if (owner !== model) {
      reject(
        model,
        attribute,
        `@@hint(was:) belongs on the model that owns the table, "${owner.name}".`,
      );
      continue;
    }
    const table = storageName(model, input.physicalNames);
    if (was === table) {
      reject(
        model,
        attribute,
        `@@hint(was: "${was}") names the table's current name; the hint is spent, remove it.`,
      );
      continue;
    }
    const key = namespaceKey(namespaceId);
    const declarer = tableDeclarers.get(key)?.get(was);
    if (declarer !== undefined) {
      reject(
        model,
        attribute,
        `@@hint(was: "${was}") on model ${model.name} names a table this contract also declares through model ${declarer.name}; a rename cannot apply while both exist.`,
      );
      continue;
    }
    const claimed = claimants.get(key) ?? new Map<string, ModelSymbol>();
    claimants.set(key, claimed);
    const earlier = claimed.get(was);
    if (earlier !== undefined) {
      reject(
        model,
        attribute,
        `Models ${earlier.name} and ${model.name} both claim to have been "${was}".`,
      );
      continue;
    }
    claimed.set(was, model);
    hints.push({ namespaceId, table, hint: { was } });
  }
  return { hints };
}
