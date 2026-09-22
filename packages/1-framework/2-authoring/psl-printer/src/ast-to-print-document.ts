import type {
  PslAttribute,
  PslAttributeArgument,
  PslDocumentAst,
  PslExtensionBlock,
  PslField,
  PslModel,
  PslNamedTypeDeclaration,
  PslTypeConstructorCall,
} from '@internal/framework-components/psl-ast';
import {
  flatPslModels,
  namespacePslExtensionBlocks,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import type { PrintDocument, PrintNamespaceSection } from './print-document';
import { escapePslString } from './serialize-print-document';
import type { PrinterField, PrinterModel, PrinterNamedType } from './types';

// `contract infer` produces a starting-point PSL contract from a live database
// schema; the user is expected to edit it (rename models/fields, tighten types,
// add `@id` where introspection couldn't infer one, etc.) and then run
// `contract emit` to produce the canonical artifacts. The header invites that
// workflow rather than warning against it.
const DEFAULT_AST_PRINT_HEADER =
  '// use prisma-8\n// Contract inferred from the live database schema. Edit as needed, then run `prisma contract emit`.';

export function astDocumentToPrintDocument(ast: PslDocumentAst): PrintDocument {
  // FK dependencies are resolved across the whole document — a model in one
  // namespace can reference a model in another, and the topo-sort needs to
  // see every model to produce a stable order. After sorting, we re-bucket by
  // namespace so each block prints with its own models in topo order.
  const allModels = flatPslModels(ast);
  const modelNames = new Set(allModels.map((m) => m.name));
  const deps = buildModelFkDeps(allModels, modelNames);
  const sortedModels = topologicalSortModels(allModels, deps);

  const namedTypes: PrinterNamedType[] = ast.types
    ? ast.types.declarations.map(namedTypeDeclarationToPrinterNamedType)
    : [];

  const modelOrder = new Map(sortedModels.map((model, index) => [model.name, index]));

  // A namespace's name is its identity, but `ast.namespaces` is an array, so a
  // producer can hand over two entries sharing one name. One section per
  // distinct name, and each section takes its content from its own entries
  // rather than from a document-wide name lookup: a model name is unique
  // within a namespace but not across them, so a lookup keyed on the name
  // alone attributes both to whichever namespace came last and drops the
  // other.
  //
  // Models and blocks are both keyed the way a single namespace keys them
  // (`entries[kind][name]`, last one wins), so two entries declaring the same
  // model or block print it once instead of emitting a duplicate declaration
  // that would not parse back.
  type Section = {
    readonly models: Map<string, PslModel>;
    readonly blocks: Map<string, PslExtensionBlock>;
  };
  const sectionsByName = new Map<string, Section>();
  for (const namespace of ast.namespaces) {
    const section: Section = sectionsByName.get(namespace.name) ?? {
      models: new Map(),
      blocks: new Map(),
    };
    for (const model of namespace.models) {
      section.models.set(model.name, model);
    }
    for (const block of namespacePslExtensionBlocks(namespace)) {
      section.blocks.set(`${block.kind} ${block.name}`, block);
    }
    sectionsByName.set(namespace.name, section);
  }

  // Absent from the order map means absent from `flatPslModels`, which reads
  // the same `entries['model']` the section did — so it cannot happen. Sorting
  // such a model to the tail keeps the failure visible if it ever does, rather
  // than tying it with the genuine first model.
  const unranked = sortedModels.length;
  const namespaceSections: PrintNamespaceSection[] = [...sectionsByName].map(([name, section]) => ({
    name,
    models: [...section.models.values()]
      .sort((a, b) => (modelOrder.get(a.name) ?? unranked) - (modelOrder.get(b.name) ?? unranked))
      .map((m) => modelToPrinterModel(m)),
    extensionBlocks: [...section.blocks.values()],
  }));

  // Ensure the synthesised `__unspecified__` bucket sorts first so top-level
  // declarations print before any `namespace { … }` blocks — matches what a
  // user would write by hand. Remaining names compare by code point, not by
  // `localeCompare`, so the emitted bytes do not depend on the host's locale
  // or ICU build.
  namespaceSections.sort((a, b) => {
    if (a.name === b.name) return 0;
    if (a.name === UNSPECIFIED_PSL_NAMESPACE_ID) return -1;
    if (b.name === UNSPECIFIED_PSL_NAMESPACE_ID) return 1;
    return a.name < b.name ? -1 : 1;
  });

  return {
    headerComment: DEFAULT_AST_PRINT_HEADER,
    namedTypes,
    namespaces: namespaceSections,
  };
}

export function renderPslAttribute(attr: PslAttribute): string {
  const prefix = attr.target === 'model' || attr.target === 'enum' ? '@@' : '@';
  if (attr.args.length === 0) {
    return `${prefix}${attr.name}`;
  }
  const inner = attr.args.map(renderAttributeArgument).join(', ');
  return `${prefix}${attr.name}(${inner})`;
}

function renderAttributeArgument(arg: PslAttributeArgument): string {
  if (arg.kind === 'positional') {
    return arg.value;
  }
  return `${arg.name}: ${arg.value}`;
}

function namedTypeDeclarationToPrinterNamedType(decl: PslNamedTypeDeclaration): PrinterNamedType {
  const base =
    decl.baseType ??
    (decl.typeConstructor !== undefined ? formatTypeConstructor(decl.typeConstructor) : '');
  const attributes = decl.attributes.map(renderPslAttribute);
  return {
    name: decl.name,
    baseType: base,
    attributes,
  };
}

function formatTypeConstructor(tc: PslTypeConstructorCall): string {
  const path = tc.path.join('.');
  if (tc.args.length === 0) {
    return path;
  }
  return `${path}(${tc.args.map(renderAttributeArgument).join(', ')})`;
}

function getPositionalStringArg(attr: PslAttribute, index: number): string | undefined {
  const positional = attr.args.filter((a) => a.kind === 'positional');
  const raw = positional[index]?.value.trim();
  if (!raw) return undefined;
  const m = raw.match(/^(['"])(.*)\1$/);
  const unescaped = m?.[2];
  if (unescaped === undefined) return undefined;
  return unescapePslString(unescaped);
}

/**
 * Inverse of `escapePslString`. The parser stores quoted-literal arguments with
 * their PSL escape sequences (`\\`, `\"`, `\n`, `\r`) intact; when we round-trip
 * a value through `getPositionalStringArg` and re-render via `escapePslString`,
 * we must decode it once on extraction to avoid double-escaping the same
 * sequences on output.
 */
function unescapePslString(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (ch !== 0x5c /* '\\' */ || i + 1 >= value.length) {
      result += value[i];
      continue;
    }
    const next = value[i + 1];
    if (next === '\\' || next === '"' || next === "'") {
      result += next;
    } else if (next === 'n') {
      result += '\n';
    } else if (next === 'r') {
      result += '\r';
    } else {
      result += '\\';
      result += next;
    }
    i++;
  }
  return result;
}

function modelToPrinterModel(model: PslModel): PrinterModel {
  let mapName: string | undefined;
  const modelAttrStrings: string[] = [];

  for (const a of model.attributes) {
    if (a.name === 'map' && a.target === 'model') {
      mapName = getPositionalStringArg(a, 0) ?? mapName;
      continue;
    }
    modelAttrStrings.push(renderPslAttribute(a));
  }

  if (mapName !== undefined) {
    modelAttrStrings.push(`@@map("${escapePslString(mapName)}")`);
  }

  const printerFields = model.fields.map((f) => fieldToPrinterField(f));

  return {
    name: model.name,
    mapName,
    fields: printerFields,
    modelAttributes: modelAttrStrings,
    comment: model.comment,
  };
}

/**
 * Assembles the qualified type name string for a field type reference.
 *
 * Handles all four forms:
 * - `space:ns.Name`  — typeContractSpaceId + typeNamespaceId + typeName
 * - `space:Name`     — typeContractSpaceId + typeName (no namespace)
 * - `ns.Name`        — typeNamespaceId + typeName (no space); fixes TML-2459 printer gap
 * - `Name`           — typeName only (no qualifier)
 */
function assembleQualifiedTypeName(field: PslField): string {
  const { typeName, typeNamespaceId, typeContractSpaceId } = field;
  const dotted = typeNamespaceId !== undefined ? `${typeNamespaceId}.${typeName}` : typeName;
  return typeContractSpaceId !== undefined ? `${typeContractSpaceId}:${dotted}` : dotted;
}

function fieldToPrinterField(field: PslField): PrinterField {
  // Assemble the qualified type identifier: `space:ns.Name` / `space:Name` / `ns.Name` / `Name`.
  // When a typeConstructor is present it takes precedence and carries no qualifier.
  // Line-wrap policy (pinned): keep the identifier on one line until the existing column limit —
  // no special wrap logic at `:` or `.` (project-spec open question; simplest readable default).
  const typeName =
    field.typeConstructor !== undefined
      ? formatTypeConstructor(field.typeConstructor)
      : assembleQualifiedTypeName(field);

  let mapName: string | undefined;
  const attrStrings: string[] = [];

  for (const a of field.attributes) {
    if (a.name === 'map' && a.target === 'field') {
      mapName = getPositionalStringArg(a, 0) ?? mapName;
      continue;
    }
    attrStrings.push(renderPslAttribute(a));
  }

  if (mapName !== undefined) {
    attrStrings.push(`@map("${escapePslString(mapName)}")`);
  }

  const isRelation = field.attributes.some((a) => a.name === 'relation' && a.target === 'field');

  const isUnsupported = typeName.startsWith('Unsupported(');

  const isId = field.attributes.some((a) => a.name === 'id' && a.target === 'field');

  return {
    name: field.name,
    typeName,
    optional: field.optional,
    list: field.list,
    attributes: attrStrings,
    mapName,
    isId,
    isRelation,
    isUnsupported,
    comment: undefined,
  };
}

function buildModelFkDeps(
  models: readonly PslModel[],
  modelNames: ReadonlySet<string>,
): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  for (const m of models) {
    deps.set(m.name, new Set());
  }

  for (const m of models) {
    for (const field of m.fields) {
      const refModel = relationReferencedModel(field, modelNames);
      if (!refModel || refModel === m.name) continue;
      if (!hasFullRelation(field)) continue;
      deps.get(m.name)?.add(refModel);
    }
  }

  return deps;
}

function hasFullRelation(field: PslField): boolean {
  const rel = field.attributes.find((a) => a.name === 'relation' && a.target === 'field');
  if (!rel) return false;
  const named = Object.fromEntries(
    rel.args
      .filter(
        (a): a is import('@internal/framework-components/psl-ast').PslAttributeNamedArgument =>
          a.kind === 'named',
      )
      .map((a) => [a.name, a.value.trim()]),
  );
  return named['fields'] !== undefined && named['references'] !== undefined;
}

function relationReferencedModel(
  field: PslField,
  modelNames: ReadonlySet<string>,
): string | undefined {
  const head = field.typeConstructor?.path[0];
  const raw = head ?? field.typeName.replace(/\?$/, '').replace(/\[\]$/, '');
  if (raw.length === 0) {
    return undefined;
  }
  return modelNames.has(raw) ? raw : undefined;
}

function topologicalSortModels(
  models: readonly PslModel[],
  deps: ReadonlyMap<string, Set<string>>,
): PslModel[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const result: PslModel[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const sortedNames = [...deps.keys()].sort();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);

    const sortedDeps = [...(deps.get(name) ?? new Set())].sort();
    for (const dep of sortedDeps) {
      visit(dep);
    }

    visiting.delete(name);
    visited.add(name);
    const model = byName.get(name);
    if (model) {
      result.push(model);
    }
  }

  for (const name of sortedNames) {
    visit(name);
  }

  return result;
}
