import type { ContractField, ExecutionMutationDefaultPhases } from '@internal/contract/types';
import {
  type AuthoringContributions,
  checkUncomposedNamespace,
  getAuthoringFieldPreset,
  hasRegisteredFieldNamespace,
} from '@internal/framework-components/authoring';
import {
  diagnosticSource,
  type FieldSymbol,
  type PslDiagnosticCollector,
} from '@internal/psl-parser';
import {
  instantiatePslFieldPreset,
  reportUncomposedNamespace,
  reportUnknownFieldPreset,
} from '@internal/psl-parser/interpret';
import type { PslSources } from '@internal/psl-parser/syntax';
import { ifDefined } from '@internal/utils/defined';
import { getAttribute } from './psl-helpers';

export interface FieldPresetContext {
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly composedExtensions: ReadonlySet<string>;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}

export type FieldPresetResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'preset';
      readonly field: ContractField;
      readonly executionDefaults?: ExecutionMutationDefaultPhases;
    };

const NONE: FieldPresetResolution = { kind: 'none' };
const INVALID: FieldPresetResolution = { kind: 'invalid' };

function unsupportedContributions(
  instantiated: NonNullable<ReturnType<typeof instantiatePslFieldPreset>>,
): readonly string[] {
  return [
    ...(instantiated.default !== undefined ? ['a storage default'] : []),
    ...(instantiated.id ? ['id semantics'] : []),
    ...(instantiated.unique ? ['a unique constraint'] : []),
  ];
}

/**
 * Resolves a field whose type is a field-preset call (`temporal.updatedAt()`) against the composed field presets. Returns `none` when the type is not a preset call, so the caller falls back to scalar resolution.
 */
export function resolveFieldPreset(input: {
  readonly field: FieldSymbol;
  readonly ownerName: string;
  readonly ownerKind: 'model' | 'compositeType';
  readonly context: FieldPresetContext;
}): FieldPresetResolution {
  const { field, ownerName, context } = input;
  const call = field.typeConstructor;
  if (!call) {
    return NONE;
  }
  const { diagnostics } = context;
  const source = diagnosticSource(context.sources, field.node.syntax);
  const entityLabel = `Field "${ownerName}.${field.name}"`;
  const helperPath = call.path.join('.');

  const descriptor = getAuthoringFieldPreset(context.authoringContributions, call.path);
  if (!descriptor) {
    const namespace = call.path.length > 1 ? call.path[0] : undefined;
    if (namespace && hasRegisteredFieldNamespace(context.authoringContributions, namespace)) {
      reportUnknownFieldPreset({
        entityLabel,
        namespace,
        helperPath,
        source,
        span: call.span,
        diagnostics,
      });
      return INVALID;
    }
    const uncomposedNamespace = checkUncomposedNamespace(helperPath, context.composedExtensions, {
      familyId: 'mongo',
      targetId: 'mongo',
      authoringContributions: context.authoringContributions,
    });
    if (uncomposedNamespace) {
      reportUncomposedNamespace({
        subjectLabel: `Type constructor "${helperPath}"`,
        namespace: uncomposedNamespace,
        source,
        span: call.span,
        diagnostics,
      });
      return INVALID;
    }
    return NONE;
  }

  if (input.ownerKind === 'compositeType') {
    diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_TYPE',
      message: `${entityLabel} uses field preset "${helperPath}". Field presets can only be used on model fields, not on fields of a composite type.`,
      ...source.at(field.span),
    });
    return INVALID;
  }
  if (field.list) {
    diagnostics.push({
      code: 'PSL_PRESET_NOT_LIST',
      message: `${entityLabel} uses a field-preset call as a list element type. Presets cannot be list elements; remove "[]" or use a scalar type.`,
      ...source.at(field.span),
    });
    return INVALID;
  }
  if (field.optional) {
    diagnostics.push({
      code: 'PSL_PRESET_NOT_OPTIONAL',
      message: `${entityLabel} uses a field-preset call and cannot be optional. Remove "?" or use a different field type.`,
      ...source.at(field.span),
    });
    return INVALID;
  }

  const instantiated = instantiatePslFieldPreset({
    call,
    descriptor,
    diagnostics,
    source,
    entityLabel,
  });
  if (!instantiated) {
    return INVALID;
  }

  const idAttribute = getAttribute(field.attributes, 'id');
  if (idAttribute && !instantiated.id) {
    diagnostics.push({
      code: 'PSL_PRESET_AND_ID_CONFLICT',
      message: `${entityLabel} uses a field-preset call and cannot also declare @id. Use a preset that contributes id semantics, or drop @id.`,
      ...source.at(idAttribute.span),
    });
    return INVALID;
  }

  const unsupported = unsupportedContributions(instantiated);
  if (unsupported.length > 0) {
    diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_TYPE',
      message: `${entityLabel} uses field preset "${helperPath}", which contributes ${unsupported.join(' and ')}. Mongo supports presets that set a codec and execution defaults only.`,
      ...source.at(call.span),
    });
    return INVALID;
  }

  return {
    kind: 'preset',
    field: {
      type: {
        kind: 'scalar',
        codecId: instantiated.descriptor.codecId,
        ...ifDefined('typeParams', instantiated.descriptor.typeParams),
      },
      nullable: instantiated.nullable,
    },
    ...ifDefined('executionDefaults', instantiated.executionDefaults),
  };
}
