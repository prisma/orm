import type {
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '@internal/framework-components/authoring';
import { isAuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type {
  PslBlockParam,
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '@internal/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
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
  readonly codecLookup?: CodecLookup;
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
    const namespaceSections = serializeNamespaceContents(
      namespace,
      blockDispatchMap,
      options.codecLookup,
    );
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
  codecLookup: CodecLookup | undefined,
): string[] {
  const sections: string[] = [];
  for (const model of namespace.models) {
    sections.push(serializeModel(model));
  }
  for (const extensionBlock of namespace.extensionBlocks) {
    sections.push(serializeExtensionBlock(extensionBlock, blockDispatchMap, codecLookup));
  }
  return sections;
}

function serializeExtensionBlock(
  extensionBlock: PslExtensionBlock,
  blockDispatchMap: PslBlockDispatchMap,
  codecLookup: CodecLookup | undefined,
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
  for (const [paramName, paramDescriptor] of Object.entries(descriptor.parameters)) {
    const paramValue = extensionBlock.parameters[paramName];
    if (paramValue === undefined) {
      continue;
    }
    const rendered = renderParamValue(paramValue, paramDescriptor, codecLookup, paramName);
    lines.push(`${PSL_INDENT_UNIT}${paramName} = ${rendered}`);
  }
  if (descriptor.variadicParameters) {
    for (const [paramName, paramValue] of Object.entries(extensionBlock.parameters)) {
      if (Object.hasOwn(descriptor.parameters, paramName)) {
        continue;
      }
      lines.push(`${PSL_INDENT_UNIT}${renderVariadicParam(paramName, paramValue)}`);
    }
  }
  for (const attr of extensionBlock.blockAttributes ?? []) {
    const args = attr.args.map((arg) => arg.value).join(', ');
    lines.push(`${PSL_INDENT_UNIT}@@${attr.name}${args.length > 0 ? `(${args})` : ''}`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * Renders one undeclared parameter of a `variadicParameters` block (e.g. a
 * `native_enum` member line). Variadic entries have no per-parameter
 * descriptor, so there is no codec to round-trip a `value` through — the raw
 * PSL literal is emitted verbatim. A `bare` entry is just its key.
 */
function renderVariadicParam(paramName: string, paramValue: PslExtensionBlockParamValue): string {
  if (paramValue.kind === 'bare') {
    return paramName;
  }
  return `${paramName} = ${renderVariadicValue(paramValue)}`;
}

function renderVariadicValue(paramValue: PslExtensionBlockParamValue): string {
  switch (paramValue.kind) {
    case 'bare':
      return '';
    case 'value':
      return paramValue.raw;
    case 'ref':
      return paramValue.identifier;
    case 'option':
      return paramValue.token;
    case 'list':
      return `[${paramValue.items.map(renderVariadicValue).join(', ')}]`;
  }
}

function renderParamValue(
  paramValue: PslExtensionBlockParamValue,
  descriptor: PslBlockParam,
  codecLookup: CodecLookup | undefined,
  paramName: string,
): string {
  switch (descriptor.kind) {
    case 'ref': {
      if (paramValue.kind !== 'ref') {
        throw paramKindMismatchError(paramName, 'ref', paramValue.kind);
      }
      return paramValue.identifier;
    }
    case 'value': {
      if (paramValue.kind !== 'value') {
        throw paramKindMismatchError(paramName, 'value', paramValue.kind);
      }
      return renderValueParam(paramValue.raw, descriptor.codecId, codecLookup, paramName);
    }
    case 'option': {
      if (paramValue.kind !== 'option') {
        throw paramKindMismatchError(paramName, 'option', paramValue.kind);
      }
      return paramValue.token;
    }
    case 'list': {
      if (paramValue.kind !== 'list') {
        throw paramKindMismatchError(paramName, 'list', paramValue.kind);
      }
      const items = paramValue.items.map((item) =>
        renderParamValue(item, descriptor.of, codecLookup, paramName),
      );
      return `[${items.join(', ')}]`;
    }
  }
}

function paramKindMismatchError(
  paramName: string,
  descriptorKind: PslBlockParam['kind'],
  valueKind: PslExtensionBlockParamValue['kind'],
) {
  return contractError(
    'CONTRACT.PACK_CONTRIBUTION_INVALID',
    `Extension block parameter "${paramName}": descriptor is "${descriptorKind}" but AST node has kind "${valueKind}"`,
    { meta: { reason: 'param-kind-mismatch', paramName, descriptorKind, valueKind } },
  );
}

function renderValueParam(
  raw: string,
  codecId: string,
  codecLookup: CodecLookup | undefined,
  paramName: string,
): string {
  if (!codecLookup) {
    return raw;
  }
  const codec = codecLookup.get(codecId);
  if (!codec) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Extension block parameter "${paramName}": no codec registered for id "${codecId}"`,
      { meta: { reason: 'codec-unregistered', paramName, codecId } },
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Extension block parameter "${paramName}": codec "${codecId}" — raw literal is not valid JSON: ${String(e)}`,
      { meta: { reason: 'raw-literal-invalid-json', paramName, codecId }, cause: e },
    );
  }
  return JSON.stringify(
    codec.encodeJson(
      codec.decodeJson(
        blindCast<Parameters<typeof codec.decodeJson>[0], 'JSON.parse output is JsonValue'>(
          parsedJson,
        ),
      ),
    ),
  );
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
