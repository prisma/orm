import { instantiateAuthoringTypeConstructor } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type {
  Binder,
  BlockSymbol,
  DiagnosticSource,
  NamedTypeSymbol,
  PslDiagnosticCollector,
  Resolution,
} from '@internal/psl-parser';
import { diagnosticSource, typeReferenceNode } from '@internal/psl-parser';
import {
  type AuthoredStorageTypeInstance,
  CODEC_INSTANCE_KIND,
} from '@internal/sql-contract/types';
import { formatDbAttributeMigrationMessage } from './psl-attribute-parsing';
import {
  bareTypeConstructorOf,
  type ColumnDescriptor,
  instantiatePslTypeConstructor,
  toNamedTypeFieldDescriptor,
} from './psl-column-resolution';

export interface ResolveNamedTypeDeclarationsInput {
  readonly declarations: readonly NamedTypeSymbol[];
  readonly source: DiagnosticSource;
  readonly binder: Binder;
  readonly enumTypeDescriptors: ReadonlyMap<BlockSymbol, ColumnDescriptor>;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly diagnostics: PslDiagnosticCollector;
}

function baseColumnDescriptor(
  resolution: Resolution | undefined,
  enumTypeDescriptors: ReadonlyMap<BlockSymbol, ColumnDescriptor>,
): ColumnDescriptor | undefined {
  if (resolution?.kind === 'block') return enumTypeDescriptors.get(resolution.symbol);
  const scalar = bareTypeConstructorOf(resolution);
  return scalar === undefined ? undefined : instantiateAuthoringTypeConstructor(scalar, []);
}

function validateNamedTypeAttributes(input: {
  readonly declaration: NamedTypeSymbol;
  readonly source: DiagnosticSource;
  readonly diagnostics: PslDiagnosticCollector;
}): boolean {
  let hasUnsupportedNamedTypeAttribute = false;

  for (const attribute of input.declaration.attributes) {
    if (attribute.name.startsWith('db.')) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: formatDbAttributeMigrationMessage(attribute),
        ...input.source.at(attribute.span),
      });
      hasUnsupportedNamedTypeAttribute = true;
      continue;
    }

    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
      message: `Named type "${input.declaration.name}" uses unsupported attribute "${attribute.name}"`,
      ...input.source.at(attribute.span),
    });
    hasUnsupportedNamedTypeAttribute = true;
  }

  return hasUnsupportedNamedTypeAttribute;
}

export function resolveNamedTypeDeclarations(input: ResolveNamedTypeDeclarationsInput): {
  readonly storageTypes: Record<string, AuthoredStorageTypeInstance>;
  readonly namedTypeDescriptors: Map<NamedTypeSymbol, ColumnDescriptor>;
} {
  const storageTypeEntries: [string, AuthoredStorageTypeInstance][] = [];
  const namedTypeDescriptors = new Map<NamedTypeSymbol, ColumnDescriptor>();
  const storageTypeOf = (descriptor: {
    readonly codecId: string;
    readonly typeParams?: Record<string, unknown> | undefined;
  }): AuthoredStorageTypeInstance => ({
    kind: CODEC_INSTANCE_KIND,
    codecId: descriptor.codecId,
    typeParams: descriptor.typeParams ?? {},
  });

  for (const declaration of input.declarations) {
    const source = diagnosticSource(input.source.sources, declaration.node.syntax);
    const reference = typeReferenceNode(declaration);
    const resolution = reference === undefined ? undefined : input.binder.symbolForNode(reference);
    if (declaration.isConstructor) {
      const typeConstructor = declaration.typeConstructor;
      if (typeConstructor === undefined) {
        input.diagnostics.push({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message: `Named type "${declaration.name}" must declare a base type or constructor`,
          ...source.at(declaration.span),
        });
        continue;
      }

      const hasUnsupportedNamedTypeAttribute = validateNamedTypeAttributes({
        declaration,
        source,
        diagnostics: input.diagnostics,
      });
      if (hasUnsupportedNamedTypeAttribute) {
        continue;
      }

      const descriptor =
        resolution?.kind === 'contributedType' &&
        resolution.symbol.descriptor.kind === 'typeConstructor'
          ? resolution.symbol.descriptor
          : undefined;
      if (!descriptor) {
        input.diagnostics.push({
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR',
          message: `Named type "${declaration.name}" references unsupported constructor "${typeConstructor.path.join('.')}"`,
          ...source.at(typeConstructor.span),
        });
        continue;
      }

      const storageType = instantiatePslTypeConstructor({
        call: typeConstructor,
        descriptor,
        codecLookup: input.codecLookup,
        diagnostics: input.diagnostics,
        source,
        entityLabel: `Named type "${declaration.name}"`,
      });
      if (!storageType) {
        continue;
      }

      namedTypeDescriptors.set(
        declaration,
        toNamedTypeFieldDescriptor(declaration.name, storageType),
      );
      storageTypeEntries.push([declaration.name, storageTypeOf(storageType)]);
      continue;
    }

    const baseType = declaration.baseType;
    if (baseType === undefined) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message: `Named type "${declaration.name}" must declare a base type or constructor`,
        ...source.at(declaration.span),
      });
      continue;
    }

    const baseDescriptor = baseColumnDescriptor(resolution, input.enumTypeDescriptors);
    if (!baseDescriptor) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message: `Named type "${declaration.name}" references unsupported base type "${baseType}"`,
        ...source.at(declaration.span),
      });
      continue;
    }

    const hasUnsupportedNamedTypeAttribute = validateNamedTypeAttributes({
      declaration,
      source,
      diagnostics: input.diagnostics,
    });
    if (hasUnsupportedNamedTypeAttribute) {
      continue;
    }

    const descriptor = toNamedTypeFieldDescriptor(declaration.name, baseDescriptor);
    namedTypeDescriptors.set(declaration, descriptor);
    storageTypeEntries.push([declaration.name, storageTypeOf(baseDescriptor)]);
  }

  return { storageTypes: Object.fromEntries(storageTypeEntries), namedTypeDescriptors };
}
