import type {
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '@internal/framework-components/authoring';
import { isAuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import type { PslExtensionBlock } from '@internal/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { contractError } from './contract-errors';
import type { PrintDocument, PrintNamespaceSection } from './print-document';
import type { PrinterField, PrinterNamedType } from './types';

/**
 * Indent unit used for PSL block bodies and namespace nesting.
 */
const PSL_INDENT_UNIT = '  ';

/**
 * Maps each block keyword to its descriptor, keyed by keyword rather than
 * discriminator because several keywords can share one discriminator but
 * each keyword resolves to exactly one descriptor.
 */
interface PslBlockDispatchMap {
  readonly byKeyword: ReadonlyMap<string, AuthoringPslBlockDescriptor>;
}

function buildPslBlockDispatchMap(
  namespace: AuthoringPslBlockDescriptorNamespace | undefined,
): PslBlockDispatchMap {
  const byKeyword = new Map<string, AuthoringPslBlockDescriptor>();
  if (namespace) {
    collectBlockDescriptors(namespace, byKeyword);
  }
  return { byKeyword };
}

function collectBlockDescriptors(
  namespace: AuthoringPslBlockDescriptorNamespace,
  byKeyword: Map<string, AuthoringPslBlockDescriptor>,
): void {
  for (const value of Object.values(namespace)) {
    if (isAuthoringPslBlockDescriptor(value)) {
      byKeyword.set(value.keyword, value);
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      collectBlockDescriptors(value, byKeyword);
    }
  }
}

export function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export interface SerializePrintDocumentOptions {
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
}

export function serializePrintDocument(
  doc: PrintDocument,
  options: SerializePrintDocumentOptions = {},
): string {
  const sections: string[] = [];

  sections.push(doc.headerComment);

  const namedTypeEntries = [...doc.namedTypes].sort((a, b) => a.name.localeCompare(b.name));
  if (namedTypeEntries.length > 0) {
    sections.push(serializeTypesBlock(namedTypeEntries));
  }

  const blockDispatchMap = buildPslBlockDispatchMap(options.pslBlockDescriptors);

  for (const namespace of doc.namespaces) {
    const namespaceSections = serializeNamespaceContents(namespace, blockDispatchMap);
    if (namespaceSections.length === 0) {
      continue;
    }
    if (namespace.name === UNSPECIFIED_PSL_NAMESPACE_ID) {
      // The parser-synthesised bucket exists for AST symmetry; printing it as
      // `namespace __unspecified__ { … }` would invent syntax the user never
      // wrote. Top-level declarations round-trip back to top-level output.
      sections.push(...namespaceSections);
    } else {
      sections.push(wrapNamespaceBlock(namespace.name, namespaceSections));
    }
  }

  return `${sections.join('\n\n')}\n`;
}

function serializeNamespaceContents(
  namespace: PrintNamespaceSection,
  blockDispatchMap: PslBlockDispatchMap,
): string[] {
  const sections: string[] = [];
  for (const model of namespace.models) {
    sections.push(serializeModel(model));
  }
  for (const extensionBlock of namespace.extensionBlocks) {
    sections.push(serializeExtensionBlock(extensionBlock, blockDispatchMap));
  }
  return sections;
}

/**
 * Renders one extension block from its source provenance: ordered entries
 * exactly as authored (or as inference synthesized them) and printable `@@`
 * attribute lines. Provenance rendering only — no value interpretation, no
 * reference resolution, and no spec factory execution; the registration and
 * keyword/discriminator consistency checks are the printer's whole use of
 * the descriptor.
 */
function serializeExtensionBlock(
  extensionBlock: PslExtensionBlock,
  blockDispatchMap: PslBlockDispatchMap,
): string {
  const descriptor = blockDispatchMap.byKeyword.get(extensionBlock.keyword);
  if (!descriptor) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `No pslBlockDescriptors contribution registered for extension-contributed block keyword "${extensionBlock.keyword}". Provide a matching pslBlockDescriptors contribution to serializePrintDocument, or remove the block from the input AST.`,
      { meta: { reason: 'block-descriptor-missing', keyword: extensionBlock.keyword } },
    );
  }
  if (descriptor.discriminator !== extensionBlock.kind) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `The pslBlockDescriptors contribution for keyword "${extensionBlock.keyword}" owns discriminator "${descriptor.discriminator}", but the block carries kind "${extensionBlock.kind}". Provide a matching pslBlockDescriptors contribution to serializePrintDocument, or remove the block from the input AST.`,
      {
        meta: {
          reason: 'block-descriptor-kind-mismatch',
          keyword: extensionBlock.keyword,
          descriptorDiscriminator: descriptor.discriminator,
          blockKind: extensionBlock.kind,
        },
      },
    );
  }
  const lines: string[] = [`${extensionBlock.keyword} ${extensionBlock.name} {`];
  for (const [entryKey, entry] of Object.entries(extensionBlock.parameters)) {
    lines.push(
      entry.expression === undefined
        ? `${PSL_INDENT_UNIT}${entryKey}`
        : `${PSL_INDENT_UNIT}${entryKey} = ${entry.expression}`,
    );
  }
  for (const attr of extensionBlock.blockAttributes ?? []) {
    const args = attr.args.map((arg) => arg.value).join(', ');
    lines.push(`${PSL_INDENT_UNIT}@@${attr.name}${args.length > 0 ? `(${args})` : ''}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function wrapNamespaceBlock(name: string, innerSections: readonly string[]): string {
  const indented = innerSections
    .map((section) =>
      section
        .split('\n')
        .map((line) => (line.length > 0 ? `  ${line}` : line))
        .join('\n'),
    )
    .join('\n\n');
  return `namespace ${name} {\n${indented}\n}`;
}

function serializeTypesBlock(namedTypes: readonly PrinterNamedType[]): string {
  const lines = ['types {'];
  for (const nt of namedTypes) {
    const attrStr = nt.attributes.length > 0 ? ` ${nt.attributes.join(' ')}` : '';
    lines.push(`  ${nt.name} = ${nt.baseType}${attrStr}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function serializeModel(model: import('./types').PrinterModel): string {
  const lines: string[] = [];

  if (model.comment) {
    lines.push(model.comment);
  }
  lines.push(`model ${model.name} {`);

  const idFields = model.fields.filter((f) => f.isId);
  const scalarFields = model.fields.filter((f) => !f.isId && !f.isRelation);
  const relationFields = model.fields.filter((f) => f.isRelation);

  const allOrderedFields = [...idFields, ...scalarFields, ...relationFields];

  if (allOrderedFields.length > 0) {
    const maxNameLen = Math.max(...allOrderedFields.map((f) => f.name.length));
    const maxTypeLen = Math.max(...allOrderedFields.map((f) => formatFieldType(f).length));

    for (const field of allOrderedFields) {
      const typePart = formatFieldType(field);
      const paddedName = field.name.padEnd(maxNameLen);
      const paddedType = typePart.padEnd(maxTypeLen);

      if (field.comment) {
        lines.push(`  ${field.comment}`);
      }

      const attrStr = field.attributes.length > 0 ? ` ${field.attributes.join(' ')}` : '';
      lines.push(`  ${paddedName} ${paddedType}${attrStr}`.trimEnd());
    }
  }

  if (model.modelAttributes.length > 0) {
    if (allOrderedFields.length > 0) {
      lines.push('');
    }
    for (const attr of model.modelAttributes) {
      lines.push(`  ${attr}`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function formatFieldType(field: PrinterField): string {
  let type = field.typeName;
  if (field.list) {
    type += '[]';
  }
  if (field.optional) {
    type += '?';
  }
  return type;
}
