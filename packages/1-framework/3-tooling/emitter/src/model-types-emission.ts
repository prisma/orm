import type {
  Contract,
  ContractModelBase,
  ContractReferenceRelation,
  ContractRelation,
  CrossReference,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { UNBOUND_PSL_NAMESPACE_NAME } from '@internal/framework-components/psl-ast';
import { serializeObjectKey, serializeValue } from './domain-type-generation';
import { emitterError } from './emitter-errors';

type ModelRef = {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly model: ContractModelBase;
};

type NamespaceModels = {
  readonly namespaceId: string;
  readonly models: readonly ModelRef[];
};

type RelationLine = {
  readonly line: string;
  readonly hasJoin: boolean;
};

type MemberLines = {
  readonly fieldsByName: Map<string, string>;
  readonly relationsByName: Map<string, RelationLine>;
};

const TYPESCRIPT_IDENTIFIER = /^[$A-Z_a-z][$\w]*$/;

type MemberNamer = (namespaceId: string, modelName: string) => string;

type ModelIndex = {
  readonly namespaces: readonly NamespaceModels[];
  readonly memberNameOf: MemberNamer;
};

function namespacedMemberName(namespaceId: string, modelName: string): string {
  const segment = namespaceId === UNBOUND_NAMESPACE_ID ? UNBOUND_PSL_NAMESPACE_NAME : namespaceId;
  return `${segment}_${modelName}`;
}

function bareMemberName(_namespaceId: string, modelName: string): string {
  return modelName;
}

function claimMemberName(claims: Map<string, string>, memberName: string, source: string): void {
  if (!TYPESCRIPT_IDENTIFIER.test(memberName)) {
    throw emitterError(
      'CONTRACT.MODEL_TYPE_NAME_INVALID',
      `Emitted model type name "${memberName}" (from ${source}) is not a TypeScript identifier`,
      {
        why: 'Every entry in the emitted Models namespace is declared as `export type <name>`, so the name must be a TypeScript identifier.',
        fix: 'Rename the namespace or model so that <namespace>_<Model> contains only letters, digits, `$`, and `_`, and does not start with a digit.',
        meta: { memberName, source },
      },
    );
  }
  const existing = claims.get(memberName);
  if (existing !== undefined) {
    throw emitterError(
      'CONTRACT.MODEL_TYPE_NAME_COLLISION',
      `Emitted model type name "${memberName}" is produced by both ${existing} and ${source}`,
      {
        why: 'Every entry in the emitted Models namespace needs a distinct name, formed as <namespace>_<Model>.',
        fix: 'Rename one of the models or namespaces so the two names differ.',
        meta: { memberName, sources: [existing, source] },
      },
    );
  }
  claims.set(memberName, source);
}

function isPolymorphicBase(model: ContractModelBase): boolean {
  return model.discriminator !== undefined && model.variants !== undefined;
}

function findModel(
  namespaces: readonly NamespaceModels[],
  ref: CrossReference,
): ModelRef | undefined {
  return namespaces
    .find((ns) => ns.namespaceId === ref.namespace)
    ?.models.find((m) => m.modelName === ref.model);
}

function requireRelationTarget(
  namespaces: readonly NamespaceModels[],
  owner: ModelRef,
  relationName: string,
  ref: CrossReference,
): ModelRef {
  const target = findModel(namespaces, ref);
  if (target !== undefined) return target;
  const ownerSource = `${owner.namespaceId}.${owner.modelName}`;
  throw emitterError(
    'CONTRACT.MODEL_RELATION_TARGET_MISSING',
    `Relation "${relationName}" on ${ownerSource} targets ${ref.namespace}.${ref.model}, which is not in the contract`,
    {
      why: 'A same-space relation must point at a model the contract declares; only cross-space relations may reference models outside it.',
      fix: 'Declare the target model in the contract, or mark the relation as cross-space by giving its target a `space`.',
      meta: {
        owner: ownerSource,
        relationName,
        target: { namespaceId: ref.namespace, modelName: ref.model },
      },
    },
  );
}

function requireBase(
  namespaces: readonly NamespaceModels[],
  variant: ModelRef,
  base: CrossReference,
): ModelRef {
  const found = findModel(namespaces, base);
  if (found !== undefined) return found;
  const variantSource = `${variant.namespaceId}.${variant.modelName}`;
  const baseSource = `${base.namespace}.${base.model}`;
  throw emitterError(
    'CONTRACT.MODEL_BASE_MISSING',
    `Model ${variantSource} names base ${baseSource}, which is not in the contract`,
    {
      why: "A variant's type is its base's fields plus its own, so the base must be a model the contract declares.",
      fix: 'Declare the base model in the contract, or remove `base` from the variant.',
      meta: { variant: variantSource, base: baseSource },
    },
  );
}

function requireVariant(
  namespaces: readonly NamespaceModels[],
  base: ModelRef,
  variantRef: CrossReference,
): ModelRef {
  const variant = findModel(namespaces, variantRef);
  if (variant !== undefined) return variant;
  const baseSource = `${base.namespaceId}.${base.modelName}`;
  const variantSource = `${variantRef.namespace}.${variantRef.model}`;
  throw emitterError(
    'CONTRACT.MODEL_VARIANT_MISSING',
    `Polymorphic base ${baseSource} names variant ${variantSource}, which is not in the contract`,
    {
      why: 'The Any<Base> union is the union of the variant model types, so every variant a base declares must be a model in the contract.',
      fix: "Declare the variant model, or remove it from the base's variants.",
      meta: { base: baseSource, variant: variantSource },
    },
  );
}

function collectFieldLines(
  ref: ModelRef,
  discriminatorType: { readonly field: string; readonly type: string } | undefined,
): Map<string, string> {
  const lines = new Map<string, string>();
  for (const fieldName of Object.keys(ref.model.fields)) {
    const type =
      discriminatorType !== undefined && fieldName === discriminatorType.field
        ? discriminatorType.type
        : `FieldOutputTypes[${serializeValue(ref.namespaceId)}][${serializeValue(ref.modelName)}][${serializeValue(fieldName)}]`;
    lines.set(fieldName, `${serializeObjectKey(fieldName)}: ${type};`);
  }
  return lines;
}

function hasJoin(relation: ContractRelation): relation is ContractReferenceRelation {
  return 'on' in relation && relation.on !== undefined;
}

function relationLine(
  owner: ModelRef,
  relationName: string,
  relation: ContractRelation,
  index: ModelIndex,
): RelationLine | undefined {
  if (relation.to.space !== undefined) return undefined;
  const target = requireRelationTarget(index.namespaces, owner, relationName, relation.to);
  const targetMember = index.memberNameOf(
    target.namespaceId,
    isPolymorphicBase(target.model) ? `Any${target.modelName}` : target.modelName,
  );
  const key = serializeObjectKey(relationName);
  if (!hasJoin(relation)) {
    const embedded = relation.cardinality === '1:N' ? `${targetMember}[]` : targetMember;
    return { line: `${key}: ${embedded};`, hasJoin: false };
  }
  if (relation.cardinality === '1:N' || relation.cardinality === 'N:M') {
    return { line: `${key}: ${targetMember}[];`, hasJoin: true };
  }
  return {
    line: `${key}: ${relation.nullable ? `${targetMember} | null` : targetMember};`,
    hasJoin: true,
  };
}

function collectRelationLines(ref: ModelRef, index: ModelIndex): Map<string, RelationLine> {
  const lines = new Map<string, RelationLine>();
  for (const [relationName, relation] of Object.entries(ref.model.relations)) {
    const rendered = relationLine(ref, relationName, relation, index);
    if (rendered !== undefined) lines.set(relationName, rendered);
  }
  return lines;
}

function discriminatorUnion(base: ContractModelBase): string {
  const values = Object.keys(base.variants ?? {}).map((value) => serializeValue(value));
  return values.length > 0 ? values.join(' | ') : 'never';
}

function memberLines(ref: ModelRef, index: ModelIndex): MemberLines {
  const base =
    ref.model.base !== undefined ? requireBase(index.namespaces, ref, ref.model.base) : undefined;
  if (base !== undefined && isPolymorphicBase(base.model)) {
    const discriminatorField = base.model.discriminator?.field ?? '';
    const variantValue = Object.entries(base.model.variants ?? {}).find(
      ([, variant]) => variant.namespace === ref.namespaceId && variant.model === ref.modelName,
    )?.[0];
    const discriminatorType = {
      field: discriminatorField,
      type:
        variantValue !== undefined ? serializeValue(variantValue) : discriminatorUnion(base.model),
    };
    return {
      fieldsByName: new Map([
        ...collectFieldLines(base, discriminatorType),
        ...collectFieldLines(ref, undefined),
      ]),
      relationsByName: new Map([
        ...collectRelationLines(base, index),
        ...collectRelationLines(ref, index),
      ]),
    };
  }
  const discriminatorType = isPolymorphicBase(ref.model)
    ? { field: ref.model.discriminator?.field ?? '', type: discriminatorUnion(ref.model) }
    : undefined;
  return {
    fieldsByName: collectFieldLines(ref, discriminatorType),
    relationsByName: collectRelationLines(ref, index),
  };
}

function renderMember(memberName: string, lines: MemberLines, hasOwner: boolean): string {
  const entries = [...lines.relationsByName];
  const joinlessLines = entries.filter(([, r]) => !r.hasJoin).map(([, r]) => r.line);
  const joinedLines = entries.filter(([, r]) => r.hasJoin).map(([, r]) => r.line);
  const relationNames = entries.filter(([, r]) => r.hasJoin).map(([name]) => name);
  const phantom =
    relationNames.length > 0
      ? relationNames.map((name) => serializeValue(name)).join(' | ')
      : 'never';
  const body = [
    ...lines.fieldsByName.values(),
    ...joinlessLines,
    ...joinedLines,
    ...(hasOwner ? [] : [`readonly [RelationKeys]?: ${phantom};`]),
  ]
    .map((line) => `    ${line}`)
    .join('\n');
  return `  export type ${memberName} = {\n${body}\n  };`;
}

function namespaceModelsOf(contract: Contract): NamespaceModels[] {
  return Object.entries(contract.domain.namespaces).map(([namespaceId, ns]) => ({
    namespaceId,
    models: Object.entries(ns.models).map(([modelName, model]) => ({
      namespaceId,
      modelName,
      model,
    })),
  }));
}

export function generateModelTypesBlock(contract: Contract, supportsNamespaces: boolean): string {
  const memberNameOf: MemberNamer = supportsNamespaces ? namespacedMemberName : bareMemberName;
  const namespaces = namespaceModelsOf(contract);
  const index: ModelIndex = { namespaces, memberNameOf };
  const claims = new Map<string, string>();
  for (const ns of namespaces) {
    for (const ref of ns.models) {
      claimMemberName(
        claims,
        memberNameOf(ns.namespaceId, ref.modelName),
        `${ns.namespaceId}.${ref.modelName}`,
      );
    }
  }
  for (const ns of namespaces) {
    for (const ref of ns.models) {
      if (!isPolymorphicBase(ref.model)) continue;
      claimMemberName(
        claims,
        memberNameOf(ns.namespaceId, `Any${ref.modelName}`),
        `${ns.namespaceId}.Any<${ref.modelName}>`,
      );
    }
  }

  const members: string[] = [];
  const constantEntries: string[] = [];
  for (const ns of namespaces) {
    const keys: string[] = [];
    for (const ref of ns.models) {
      const memberName = memberNameOf(ns.namespaceId, ref.modelName);
      members.push(
        renderMember(memberName, memberLines(ref, index), ref.model.owner !== undefined),
      );
      keys.push(`${serializeObjectKey(ref.modelName)}: Models.${memberName};`);
    }
    for (const ref of ns.models) {
      if (!isPolymorphicBase(ref.model)) continue;
      const unionName = memberNameOf(ns.namespaceId, `Any${ref.modelName}`);
      const variantMembers = Object.values(ref.model.variants ?? {}).map((variantRef) => {
        const variant = requireVariant(namespaces, ref, variantRef);
        return memberNameOf(variant.namespaceId, variant.modelName);
      });
      members.push(
        `  export type ${unionName} = ${variantMembers.length > 0 ? variantMembers.join(' | ') : 'never'};`,
      );
      keys.push(`${serializeObjectKey(`Any${ref.modelName}`)}: Models.${unionName};`);
    }
    if (!supportsNamespaces) {
      constantEntries.push(...keys.map((key) => `  ${key}`));
      continue;
    }
    const nsKey = serializeObjectKey(ns.namespaceId);
    const nested = keys.map((key) => `    ${key}`).join('\n');
    constantEntries.push(keys.length > 0 ? `  ${nsKey}: {\n${nested}\n  };` : `  ${nsKey}: {};`);
  }

  const namespaceBlock =
    members.length > 0
      ? `export namespace Models {\n${members.join('\n')}\n}`
      : 'export namespace Models {}';
  const constantBlock = `export declare const models: {\n${constantEntries.join('\n')}\n};`;
  return `${namespaceBlock}\n\n${constantBlock}`;
}
