import type {
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
  JsonValue,
} from '@internal/contract/types';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Type } from 'arktype';
import type {
  AuthoringTypeChoiceDescriptor,
  AuthoringTypeChoiceOption,
} from './authoring-type-choice';
import type { CodecLookupWithDescriptors } from './codec-types';
import type { DataTypeId } from './data-type';
import type {
  GeneratorFunctionCall,
  GeneratorFunctionField,
  GeneratorFunctionRegistry,
} from './generator-functions';
import type { ParsedPslExtensionBlock, PslSpan } from './psl-extension-block';
import { runtimeError } from './runtime-error';
import type { DataTypeSupport } from './written-value';

export type EnumInferredMemberType = 'text' | 'int';

export type AuthoringArgRef = {
  readonly kind: 'arg';
  readonly index: number;
};

export type AuthoringTemplateValue =
  | string
  | number
  | boolean
  | null
  | AuthoringArgRef
  | readonly AuthoringTemplateValue[]
  | { readonly [key: string]: AuthoringTemplateValue };

/** An argument that is a value of the data type `dataType`, read and cast as attribute arguments are. ADR 254. */
export interface AuthoringArgumentDescriptor {
  readonly kind: 'value';
  readonly dataType: string;
  readonly name?: string;
  readonly optional?: boolean;
}

/**
 * What a type constructor produces: a codec and its parameters. The database type
 * is the codec's data type's, named by the family that writes the contract.
 */
export interface AuthoringStorageTypeTemplate {
  readonly codecId: string;
  readonly typeParams?: Record<string, AuthoringTemplateValue>;
}

/**
 * Declares that one positional argument of a
 * {@link AuthoringTypeConstructorDescriptor} call names another entity
 * parsed from the same document, rather than carrying a literal value (e.g.
 * `pg.enum(AalLevel)` naming a `native_enum` entity). `index` is the
 * argument's position in the call; `entityKind` is the entries-slot
 * discriminator the interpreter looks the named entity up under (the same
 * shape {@link AuthoringEntityTypeFactoryOutput.factory} output is collected
 * into, keyed by discriminator then block name).
 *
 * The interpreter resolves the named argument to the entity instance
 * generically, driven only by this declaration — it has no target-specific
 * knowledge of which type constructors carry one. Converting the resolved
 * entity into the constructor's params is a separate, codec-owned concern:
 * the codec descriptor registered for `output.codecId` supplies that
 * conversion, not this framework type.
 */
export interface AuthoringTypeConstructorEntityRef {
  readonly index: number;
  readonly entityKind: string;
}

export interface AuthoringTypeConstructorDescriptor {
  readonly kind: 'typeConstructor';
  readonly documentation?: string;
  readonly args?: readonly AuthoringArgumentDescriptor[];
  readonly output: AuthoringStorageTypeTemplate;
  /** Present when one of this constructor's positional arguments names another document-local entity instead of carrying a literal value. Absent for ordinary literal-argument constructors. */
  readonly entityRefArg?: AuthoringTypeConstructorEntityRef;
  /** Present when this name is kept only as an alias of `replacement` and will be removed; it resolves as before, and a source may warn. */
  readonly deprecated?: { readonly replacement: string };
  /** Marks the constructor written for a column of its codec's data type when no schema names one: `contract infer` and the reader of an earlier Prisma version's schema pick it. `contract print` picks it when it produces the column's codec, and otherwise the first constructor in the stack that does; either writes a type choice that becomes it instead, where one does. At most one per data type. */
  readonly inferred?: true;
}

/**
 * A type alias a pack contributes: a type with fixed params, and the generators every field typed by it takes. It takes no arguments, and is written bare, such as `temporal.CreatedAt`.
 */
export interface AuthoringTypeAliasDescriptor {
  readonly kind: 'typeAlias';
  readonly documentation?: string;
  readonly output: {
    /** Assembly refuses params the codec's parameter schema refuses. */
    readonly type: AuthoringStorageTypeTemplate;
    /** Resolved by the field's codec, as `@onCreate(fn())` is. Assembly refuses a call that does not resolve. */
    readonly onCreate?: GeneratorFunctionCall;
    readonly onUpdate?: GeneratorFunctionCall;
  };
}

export type AuthoringTypeNamespace = {
  readonly [name: string]: AuthoringTypeNamespaceMember;
};

/** A leaf of a `type` namespace, or a sub-namespace. */
export type AuthoringTypeNamespaceMember =
  | AuthoringTypeConstructorDescriptor
  | AuthoringTypeAliasDescriptor
  | AuthoringTypeChoiceDescriptor
  | AuthoringTypeNamespace;

/** The descriptor kinds a `type` namespace holds as leaves. */
export const AUTHORING_TYPE_DESCRIPTOR_KINDS = [
  'typeConstructor',
  'typeAlias',
  'typeChoice',
] as const;

/**
 * Context surfaced to entity-type factories at call time. Currently a
 * placeholder — sharpened as concrete consumers (enum, namespace, …)
 * discover what the factory actually needs to read (codec lookup,
 * namespace registry, …).
 */
/**
 * A write-only sink that a factory may push authoring-time diagnostics into.
 * The concrete type pushed must be structurally compatible with whatever the
 * consumer accumulates (typically `ContractSourceDiagnostic[]`); the framework
 * layer deliberately does not depend on that concrete type.
 */
export interface AuthoringDiagnosticSink {
  push(d: {
    readonly code: string;
    readonly message: string;
    readonly sourceId: string;
    readonly span?: unknown;
  }): void;
}

/**
 * A non-fatal advisory minted at authoring time. Fully formed at the push
 * site — the transport and the flush never learn family or target
 * vocabulary. Warnings batch together iff `code` AND `summary` match: the
 * batched rendering asserts the summary of every member, so the grouping
 * key must cover everything the summary claims.
 */
export interface AuthoringWarning {
  /** Stable machine code — what the user greps and what `process.emitWarning` stamps. */
  readonly code: string;
  /** Full text emitted when the warning is itemized (group at or below the batch threshold). */
  readonly message: string;
  /** Short subject label listed under a batched group summary (e.g. `object "…"`). */
  readonly item: string;
  /**
   * Group summary text — what a batched group asserts about EVERY member.
   * An over-threshold group renders as `"<count> <summary>"` above the item
   * lines, so this starts with the plural noun phrase (e.g.
   * `objects use <feature>. <remediation>`).
   */
  readonly summary: string;
}

/**
 * A write-only sink for non-fatal authoring-time warnings a factory may
 * emit. Entries travel verbatim to a single per-build flush — no
 * narrowing, no per-kind fields; a plain `AuthoringWarning[]` satisfies
 * this structurally.
 */
export interface AuthoringWarningSink {
  push(w: AuthoringWarning): void;
}

const AUTHORING_WARNING_BATCH_THRESHOLD = 5;

/**
 * Emits collected authoring warnings once per build, grouped by `code`:
 * a group at or below the threshold itemizes every `message`; above it,
 * one summary — `"<count> <summary>"` followed by the `item` lines — so
 * a build with many hits of one kind does not wall-of-text, and warnings
 * of different codes never batch into each other's summary.
 */
export function flushAuthoringWarnings(warnings: readonly AuthoringWarning[]): void {
  // Grouped on code + summary: the batched rendering asserts the summary of
  // every member, so the key must cover everything the summary claims — two
  // warnings sharing a code but differing in summary never share a batch.
  const groups = new Map<string, AuthoringWarning[]>();
  for (const warning of warnings) {
    const key = JSON.stringify([warning.code, warning.summary]);
    const group = groups.get(key) ?? [];
    group.push(warning);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    if (group.length <= AUTHORING_WARNING_BATCH_THRESHOLD) {
      for (const warning of group) {
        process.emitWarning(warning.message, { code: warning.code });
      }
      continue;
    }
    process.emitWarning(
      `${group.length} ${first.summary}\n${group.map((w) => `  - ${w.item}`).join('\n')}`,
      { code: first.code },
    );
  }
}

export interface AuthoringEntityContext {
  readonly family: string;
  readonly target: string;
  /** Codec registry available to factories that need to validate or decode values. */
  readonly codecLookup: CodecLookupWithDescriptors;
  /** The stack's data types with their authoring entries: a factory reads the data type a codec represents from `lookup`, and a written value through the entries. */
  readonly dataTypes: DataTypeSupport;
  /** Source file identifier threaded into diagnostics emitted by the factory. */
  readonly sourceId?: string;
  /** Push channel for authoring-time diagnostics emitted by the factory. */
  readonly diagnostics?: AuthoringDiagnosticSink;
  /** Push channel for non-fatal authoring-time warnings emitted by the factory. */
  readonly warnings?: AuthoringWarningSink;
  /**
   * The target's default codec ids for an `enum` block that omits `@@type`.
   * `text` is used when every member is a bare name or a string value;
   * `int` is used when every member is an integer value. Every target pack
   * populates this so `@@type` omission can be inferred consistently.
   */
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
}

export function classifyEnumMemberType(
  values: Readonly<Record<string, unknown>>,
): 'text' | 'int' | null {
  let sawText = false;
  let sawInt = false;

  for (const key of Object.keys(values)) {
    const value = values[key];
    if (value === undefined || typeof value === 'string') {
      sawText = true;
    } else if (typeof value === 'number' && Number.isInteger(value)) {
      sawInt = true;
    } else {
      return null;
    }
  }

  if (sawText && sawInt) return null;
  if (sawText) return 'text';
  if (sawInt) return 'int';
  return null;
}

/**
 * Resolves the codec id for an `enum` block. When `@@type` is absent, the codec
 * is inferred from the members via {@link classifyEnumMemberType}; otherwise the
 * explicit `@@type("codec")` argument is parsed. Pushes the appropriate
 * diagnostic and returns `undefined` when neither yields a codec. `codecSpan` is
 * the span downstream codec-validation diagnostics should anchor to. Shared by
 * every family's enum factory so inference and the explicit path stay identical.
 */
export function resolveEnumCodecId(
  block: ParsedPslExtensionBlock,
  ctx: AuthoringEntityContext,
): { readonly codecId: string; readonly codecSpan: PslSpan } | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const typeAttr = block.attributes['type'];

  if (typeAttr === undefined) {
    const inferredKind = classifyEnumMemberType(block.values);
    if (inferredKind === null || ctx.enumInferenceCodecs === undefined) {
      ctx.diagnostics?.push({
        code: 'PSL_ENUM_CANNOT_INFER_TYPE',
        message: `cannot infer @@type for enum "${block.name}"; add an explicit @@type(...)`,
        sourceId,
        span: block.span,
      });
      return undefined;
    }
    return { codecId: ctx.enumInferenceCodecs[inferredKind], codecSpan: block.span };
  }

  const codecId = typeAttr.args['codecId'];
  invariant(typeof codecId === 'string', '@@type on an enum block parses one string argument');
  return { codecId, codecSpan: typeAttr.argSpans?.['codecId'] ?? typeAttr.span };
}

export interface AuthoringEntityTypeTemplateOutput {
  readonly template: AuthoringTemplateValue;
}

/**
 * Default `Input = never` is load-bearing for pack-bag-driven type
 * narrowing. Factory parameter positions are contravariant, so a pack
 * literal declaring `factory: (input: DemoEntityInput) => DemoEntity`
 * is only assignable to the base descriptor's factory shape if the
 * base's input is `never` (the bottom of the contravariant position).
 * The concrete input/output types are recovered at the helper-derivation
 * site via `EntityHelperFunction<Descriptor>`'s conditional inference,
 * which reads them from the pack's `as const` literal factory signature
 * — the base widening does not erase the literal because `satisfies`
 * does not widen the declared type.
 */
export interface AuthoringEntityTypeFactoryOutput<Input = never, Output = unknown> {
  readonly factory: (input: Input, ctx: AuthoringEntityContext) => Output;
}

export interface AuthoringEntityTypeDescriptor<Input = never, Output = unknown> {
  readonly kind: 'entity';
  readonly discriminator: string;
  readonly args?: readonly AuthoringArgumentDescriptor[];
  readonly output:
    | AuthoringEntityTypeTemplateOutput
    | AuthoringEntityTypeFactoryOutput<Input, Output>;
  /**
   * arktype schema fragment for one entry whose envelope `kind` matches
   * this descriptor's {@link discriminator}. The family validator composes
   * contributed fragments into the per-namespace entry schema at
   * validator construction time so the structural check covers
   * pack-introduced kinds without the family core hard-coding the schema.
   *
   * Hydration uses {@link AuthoringEntityTypeFactoryOutput.factory}
   * directly — the wire shape conforms structurally to the factory's
   * `Input` after `validatorSchema` validates it.
   */
  readonly validatorSchema?: Type<unknown>;
}

export type AuthoringEntityTypeNamespace = {
  readonly [name: string]: AuthoringEntityTypeDescriptor | AuthoringEntityTypeNamespace;
};

/**
 * Declarative descriptor for an extension-contributed top-level PSL block.
 *
 * An extension registers one of these per keyword it contributes. The
 * framework owns the generic parser, validator, and printer — no
 * parsing or printing code runs from the extension.
 *
 * - `keyword` is the PSL top-level identifier this descriptor claims
 *   (`policy_select`, `role`, …).
 * - `discriminator` is the routing key used by the printer dispatch and
 *   the `entityTypes` lowering factory lookup. Convention:
 *   `<target-or-family>-<kind>` (`postgres-policy-select`).
 * - `name.required` declares whether the block must have a name token
 *   after the keyword. Currently always `true` — anonymous blocks are
 *   not part of the closed-grammar premise — but the field is explicit
 *   so the type can evolve without a breaking change.
 */
export interface AuthoringPslBlockDescriptor {
  readonly kind: 'pslBlock';
  readonly documentation?: string;
  readonly keyword: string;
  readonly discriminator: string;
  readonly name: { readonly required: boolean };
  readonly spec: unknown;
  /**
   * Declares that the model named by the block's ref parameter `parameter`
   * must carry the bare `@@` model attribute `attribute`. The family
   * interpreter enforces this generically over the whole parsed document —
   * declaration order of the block and the model does not matter — and
   * emits `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE` naming the block
   * and the model when the attribute is absent. A parameter that is
   * missing or does not resolve to a model is not this rule's concern
   * (missing-parameter and unresolved-ref diagnostics own those cases).
   */
  readonly requiresModelAttribute?: {
    readonly parameter: string;
    readonly attribute: string;
  };
  /**
   * Declares that the block's name is the name of the storage object the
   * block declares, and that the block attribute `map` replaces that name.
   */
  readonly nameIsStorageName?: boolean;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export type AuthoringPslBlockDescriptorNamespace = {
  readonly [name: string]: AuthoringPslBlockDescriptor | AuthoringPslBlockDescriptorNamespace;
};

/**
 * Context surfaced to a model-attribute lowering at call time: the entity
 * context shared with entity-type factories, plus the declaring model's
 * name, its mapped storage name (the name of the storage object the model
 * maps to; which kind of object that is belongs to the family, not the
 * framework), and the namespace id the lowered entity should be filed
 * under.
 */
export interface AuthoringModelAttributeContext extends AuthoringEntityContext {
  readonly modelName: string;
  readonly storageName: string;
  readonly namespaceId: string;
  /**
   * The storage name a field of the declaring model maps to, or `undefined`
   * when the model declares no such field. The interpreter owns the mapping
   * — a lowering that renders storage-level text must ask for the name here
   * rather than reusing the authored field name, which `@map` may rename.
   */
  readonly fieldStorageName: (fieldName: string) => string | undefined;
  /**
   * The codec a field of the declaring model stores its values through, or
   * `undefined` when the model declares no such field or the field is not a
   * stored value at all. A lowering that only makes sense over certain value
   * kinds checks this rather than guessing from the field's declared type.
   */
  readonly fieldCodecId: (fieldName: string) => string | undefined;
}

/**
 * What a model-attribute lowering returns when it produces an entity: `key`
 * is the identity the entity is stored under within its `entries` slot
 * (`entries[attribute][key]`); `entity` is the value stored there.
 */
export interface AuthoringModelAttributeEntityOutput {
  readonly key: string;
  readonly entity: unknown;
}

/**
 * What a model-attribute lowering returns when it produces an index on the
 * declaring model's storage rather than a standalone entity. The framework
 * never reads `index`: its shape is the family's authored-index input, which
 * the family interpreter narrows and files through the same path its own
 * index attribute uses, so naming and validation are shared.
 */
export interface AuthoringModelAttributeIndexOutput {
  readonly index: unknown;
}

/**
 * What a model-attribute lowering returns. A lowering that instead pushed a
 * diagnostic through {@link AuthoringModelAttributeContext.diagnostics}
 * returns `undefined` — the same convention
 * {@link AuthoringEntityTypeFactoryOutput} uses.
 */
export type AuthoringModelAttributeLoweringOutput =
  | AuthoringModelAttributeEntityOutput
  | AuthoringModelAttributeIndexOutput;

/**
 * Declarative descriptor for an extension-contributed `@@` model attribute.
 *
 * An extension registers one of these per bare attribute name it
 * contributes. The framework owns the generic consult in the interpreter's
 * model-attribute loop; the contribution supplies only `spec` and `lower`.
 *
 * - `attribute` is the bare `@@` attribute name this descriptor claims and,
 *   by the one-string rule, the `entries` slot its lowered entities are
 *   grouped under (`entries[attribute][key]`).
 * - `lower` receives the parsed arguments and the declaring model's
 *   context, and returns the entity to file into `entries`, or `undefined`
 *   after pushing a diagnostic via `ctx.diagnostics`.
 *
 * `Out` defaults to `never` — not `unknown` — for the same contravariance
 * reason documented on {@link AuthoringEntityTypeFactoryOutput}: a concrete
 * pack literal's narrower `lower(parsed: ConcreteOut, ctx)` is only
 * assignable to this base shape when the base parameter is the bottom type.
 */
export interface AuthoringModelAttributeDescriptor<Out = never> {
  readonly kind: 'modelAttribute';
  readonly attribute: string;
  readonly spec: unknown;
  /**
   * Whether one model may declare this attribute more than once. Defaults to
   * false, which is what the duplicate diagnostic enforces.
   */
  readonly repeatable?: boolean;
  readonly lower: (
    parsed: Out,
    ctx: AuthoringModelAttributeContext,
  ) => AuthoringModelAttributeLoweringOutput | undefined;
}

export type AuthoringModelAttributeDescriptorNamespace = {
  readonly [name: string]:
    | AuthoringModelAttributeDescriptor
    | AuthoringModelAttributeDescriptorNamespace;
};

export interface AuthoringAttributeSpecContributions {
  readonly model: Readonly<Record<string, unknown>>;
  readonly field: Readonly<Record<string, unknown>>;
}

/**
 * How a contract source writes values of one data type, and how it reads the text back.
 *
 * A tag is a qualified name followed by a body in any of the quote styles. A plain form is one of
 * the three pieces of syntax read without a tag: a quoted string, `true`/`false`, and a number.
 *
 * A number is the one plain form that yields several types, so instead of `parse` its arm carries a
 * classifier, which picks the type from the digits and returns JSON of that type with it, and
 * `types`, every type the classifier can return — which is how assembly knows those types can be
 * written. The type constructs its value from what `parse` or the classifier returns. ADR 254.
 */
export type DataTypeWrittenForm =
  | {
      readonly kind: 'tag';
      readonly tag: string;
      readonly parse: (text: string) => JsonValue;
    }
  | {
      readonly kind: 'plain';
      readonly syntax: 'string' | 'boolean';
      readonly parse: (text: string) => JsonValue;
    }
  | {
      readonly kind: 'plain';
      readonly syntax: 'number';
      readonly types: readonly DataTypeId[];
      readonly classify: (
        text: string,
      ) => { readonly type: DataTypeId; readonly value: JsonValue } | undefined;
    };

/**
 * PSL support for one data type, keyed by its id and contributed by the component that registers
 * the type.
 *
 * The written form reads text into JSON the type constructs its value from, throwing a structured
 * error for text it cannot read; `print` is the reverse.
 */
export interface DataTypeAuthoringEntry {
  readonly written: DataTypeWrittenForm;
  readonly print: (value: JsonValue) => string;
  readonly documentation: string;
}

export interface AuthoringContributions {
  readonly type?: AuthoringTypeNamespace;
  readonly entityTypes?: AuthoringEntityTypeNamespace;
  /**
   * Registry of declarative block descriptors this contribution registers,
   * keyed by arbitrary path segments. Each leaf is an
   * {@link AuthoringPslBlockDescriptor} that claims a PSL top-level keyword.
   * The framework owns the generic parser, validator, and printer; the
   * contribution supplies only these declarative descriptors.
   *
   * Contrast with the parsed block nodes themselves, which live in a
   * namespace's `entries` under their discriminator key; this field holds the
   * registry of descriptors that teach the parser how to read those blocks.
   */
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  /**
   * Registry of declarative `@@` model attribute descriptors this
   * contribution registers, keyed by arbitrary path segments. Each leaf is
   * an {@link AuthoringModelAttributeDescriptor} that claims a bare model
   * attribute name. The framework owns the generic consult in the family
   * interpreter's model-attribute loop; the contribution supplies only the
   * declarative spec and the lowering.
   */
  readonly modelAttributes?: AuthoringModelAttributeDescriptorNamespace;
  readonly attributeSpecs?: AuthoringAttributeSpecContributions;
  /** PSL support for the data types this contribution registers, keyed by data type id. ADR 254. */
  readonly dataTypes?: Readonly<Record<string, DataTypeAuthoringEntry>>;
  /**
   * Names the top-level type constructor that stores embedded value-object
   * fields (fields typed as a value-object `type` block). A single named
   * slot per component makes within-component ambiguity impossible by
   * shape. Assembly rejects two components both declaring it, validates
   * that the assembled namespace carries the named constructor as a
   * top-level bare-eligible entry (see
   * {@link collectScalarTypeConstructors}), and exposes the single value to
   * family interpreters — so family layers never hardcode a target's type
   * names.
   */
  readonly valueObjectStorageType?: string;
  /**
   * The data types whose values are text, such as a target's variable-length, fixed-length and bounded text types. A family uses the list where only text is meaningful, such as a polymorphic model's discriminator column. Assembly takes every component's list.
   */
  readonly textDataTypes?: readonly DataTypeId[];
}

/** Refuses the `authoring.field` key, which held field presets before Prisma 8 removed them. A component built against the old types would otherwise lose its presets silently. */
export function assertNoAuthoringFieldNamespace(
  componentId: string,
  authoring: object | undefined,
): void {
  if (authoring === undefined || !Object.hasOwn(authoring, 'field')) return;
  throw runtimeError(
    'CONTRACT.PACK_CONTRIBUTION_INVALID',
    `Component "${componentId}" contributes authoring.field, which Prisma 8 removed with field presets. Contribute a type alias (kind: 'typeAlias') or a type constructor in authoring.type.`,
  );
}

export function isAuthoringArgRef(value: unknown): value is AuthoringArgRef {
  if (typeof value !== 'object' || value === null || (value as { kind?: unknown }).kind !== 'arg') {
    return false;
  }
  const { index } = value as { index?: unknown };
  return typeof index === 'number' && Number.isInteger(index) && index >= 0;
}

function isAuthoringTemplateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAuthoringTypeConstructorDescriptor(
  value: object,
): value is AuthoringTypeConstructorDescriptor {
  return 'kind' in value && value.kind === 'typeConstructor';
}

export function isAuthoringTypeAliasDescriptor(
  value: AuthoringTypeNamespaceMember,
): value is AuthoringTypeAliasDescriptor {
  return 'kind' in value && value.kind === 'typeAlias';
}

export function isAuthoringTypeChoiceDescriptor(
  value: AuthoringTypeNamespaceMember,
): value is AuthoringTypeChoiceDescriptor {
  return 'kind' in value && value.kind === 'typeChoice';
}

/** Whether `value` is a leaf of a `type` namespace: a type constructor, a type alias or a type choice. */
export function isAuthoringTypeDescriptor(
  value: AuthoringTypeNamespaceMember,
): value is
  | AuthoringTypeConstructorDescriptor
  | AuthoringTypeAliasDescriptor
  | AuthoringTypeChoiceDescriptor {
  return (
    isAuthoringTypeConstructorDescriptor(value) ||
    isAuthoringTypeAliasDescriptor(value) ||
    isAuthoringTypeChoiceDescriptor(value)
  );
}

/** The type constructor at `path` in the contributions' type namespace, or `undefined` when none is there. */
export function getAuthoringTypeConstructor(
  contributions: { readonly type?: AuthoringTypeNamespace } | undefined,
  path: readonly string[],
): AuthoringTypeConstructorDescriptor | undefined {
  let current: AuthoringTypeNamespaceMember | undefined = contributions?.type;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || 'kind' in current) {
      return undefined;
    }
    current = current[segment];
  }
  return current !== undefined && isAuthoringTypeConstructorDescriptor(current)
    ? current
    : undefined;
}

export function isAuthoringEntityTypeDescriptor(
  value: AuthoringEntityTypeDescriptor | AuthoringEntityTypeNamespace,
): value is AuthoringEntityTypeDescriptor {
  return 'kind' in value && value.kind === 'entity';
}

export function isAuthoringPslBlockDescriptor(
  value: AuthoringPslBlockDescriptor | AuthoringPslBlockDescriptorNamespace,
): value is AuthoringPslBlockDescriptor {
  return 'kind' in value && value.kind === 'pslBlock';
}

export function isAuthoringModelAttributeDescriptor(
  value: AuthoringModelAttributeDescriptor | AuthoringModelAttributeDescriptorNamespace,
): value is AuthoringModelAttributeDescriptor {
  return 'kind' in value && value.kind === 'modelAttribute';
}

function isCopyableNamespaceObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep structural check run only at the composition boundary (the merge and
 * collect walkers) to classify a raw namespace-tree node as a leaf descriptor.
 * A node counts as a leaf iff its `kind` matches `descriptorKind` AND it
 * carries that kind's required fields.
 *
 * This is boundary validation over `unknown`, NOT a type-predicate: the four
 * exported `isAuthoring*Descriptor` predicates deliberately narrow on `kind`
 * alone and trust the static types. The walkers, by contrast, also receive
 * type-bypassing packs (`as unknown as never` in tests, untyped JS at runtime)
 * whose descriptor-shaped-but-incomplete nodes must be rejected rather than
 * silently treated as sub-namespaces — so the well-formedness check lives here.
 */
/** The `kind` of the leaves of one namespace, or several kinds when the namespace holds more than one, as `type` does. */
export type AuthoringDescriptorKinds = string | readonly string[];

function isWellFormedDescriptor(
  value: unknown,
  descriptorKinds: AuthoringDescriptorKinds,
): boolean {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
  const kind = value.kind;
  const kinds = typeof descriptorKinds === 'string' ? [descriptorKinds] : descriptorKinds;
  if (typeof kind !== 'string' || !kinds.includes(kind)) return false;
  switch (kind) {
    case 'typeConstructor': {
      if (!('output' in value)) return false;
      const output = value.output;
      return typeof output === 'object' && output !== null;
    }
    case 'typeChoice':
      return (
        'args' in value &&
        Array.isArray(value.args) &&
        'choices' in value &&
        Array.isArray(value.choices)
      );
    case 'typeAlias': {
      if (!('output' in value)) return false;
      const output = value.output;
      if (typeof output !== 'object' || output === null || !('type' in output)) return false;
      return typeof output.type === 'object' && output.type !== null;
    }
    case 'entity': {
      if (!('discriminator' in value) || typeof value.discriminator !== 'string') return false;
      if (value.discriminator.length === 0) return false;
      if (!('output' in value)) return false;
      const output = value.output;
      if (typeof output !== 'object' || output === null) return false;
      const factory = 'factory' in output ? output.factory : undefined;
      const template = 'template' in output ? output.template : undefined;
      return typeof factory === 'function' || template !== undefined;
    }
    case 'pslBlock': {
      if (
        !('keyword' in value) ||
        typeof value.keyword !== 'string' ||
        value.keyword.length === 0
      ) {
        return false;
      }
      if (
        !('discriminator' in value) ||
        typeof value.discriminator !== 'string' ||
        value.discriminator.length === 0
      ) {
        return false;
      }
      if (!('name' in value)) return false;
      const name = value.name;
      if (typeof name !== 'object' || name === null) return false;
      if (!('required' in name) || typeof name.required !== 'boolean') return false;
      if (!('spec' in value) || typeof value.spec !== 'function') return false;
      if (!('attributes' in value) || value.attributes === undefined) return true;
      const attributes = value.attributes;
      if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
        return false;
      }
      return Object.values(attributes).every((factory) => typeof factory === 'function');
    }
    case 'modelAttribute': {
      if (
        !('attribute' in value) ||
        typeof value.attribute !== 'string' ||
        value.attribute.length === 0
      ) {
        return false;
      }
      if (!('spec' in value)) return false;
      return 'lower' in value && typeof value.lower === 'function';
    }
    default:
      return false;
  }
}

function deepCopyNamespace(
  source: Record<string, unknown>,
  descriptorKind: AuthoringDescriptorKinds,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    copy[key] =
      isCopyableNamespaceObject(value) && !isWellFormedDescriptor(value, descriptorKind)
        ? deepCopyNamespace(value, descriptorKind)
        : value;
  }
  return copy;
}

/**
 * Merges `source` into `target` recursively at the descriptor-namespace
 * level. `descriptorKind` is the `kind` value, or values, ('typeConstructor'
 * and 'typeAlias', 'entity', or 'pslBlock') that identifies a descriptor
 * (terminal merge point; same-path registrations across components are
 * reported as duplicates) as opposed to a sub-namespace (recursion target).
 *
 * Path segments are validated against prototype-pollution names
 * (`__proto__`, `constructor`, `prototype`). A value that is neither a
 * recognized leaf nor a plain object — e.g. a malformed descriptor
 * where the canonical leaf guard rejected it for missing `output` —
 * is reported as an invalid contribution rather than recursed into,
 * which would either silently mangle state or infinite-loop on
 * primitive properties.
 *
 * Within-registry duplicate detection is this walker's job;
 * cross-registry detection runs separately via
 * `assertNoCrossRegistryCollisions` after merging completes.
 */
export function mergeAuthoringNamespaces(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: readonly string[],
  descriptorKind: AuthoringDescriptorKinds,
  label: string,
): void {
  const assertSafePath = (currentPath: readonly string[]) => {
    const blockedSegment = currentPath.find(
      (segment) => segment === '__proto__' || segment === 'constructor' || segment === 'prototype',
    );
    if (blockedSegment) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Invalid authoring ${label} helper "${currentPath.join('.')}". Helper path segments must not use "${blockedSegment}".`,
      );
    }
  };

  for (const [key, sourceValue] of Object.entries(source)) {
    const currentPath = [...path, key];
    assertSafePath(currentPath);
    const hasExistingValue = Object.hasOwn(target, key);
    const existingValue = hasExistingValue ? target[key] : undefined;

    if (!hasExistingValue) {
      // Deep-copy plain-object sub-namespaces so subsequent merges don't mutate
      // objects owned by source packs. Leaf descriptors and class instances are
      // passed by reference — leaves are identity values; class instances carry
      // prototype getters that spread would destroy.
      target[key] =
        isCopyableNamespaceObject(sourceValue) &&
        !isWellFormedDescriptor(sourceValue, descriptorKind)
          ? deepCopyNamespace(sourceValue, descriptorKind)
          : sourceValue;
      continue;
    }

    const existingIsLeaf = isWellFormedDescriptor(existingValue, descriptorKind);
    const sourceIsLeaf = isWellFormedDescriptor(sourceValue, descriptorKind);

    if (existingIsLeaf || sourceIsLeaf) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Duplicate authoring ${label} helper "${currentPath.join('.')}". Helper names must be unique across composed packs.`,
      );
    }

    if (!isCopyableNamespaceObject(existingValue) || !isCopyableNamespaceObject(sourceValue)) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Invalid authoring ${label} helper "${currentPath.join('.')}". Expected a sub-namespace object or a recognized descriptor; received a malformed value.`,
      );
    }

    mergeAuthoringNamespaces(existingValue, sourceValue, currentPath, descriptorKind, label);
  }
}

const ATTRIBUTE_SPEC_LEVELS = ['model', 'field'] as const;

export function mergeAuthoringAttributeSpecs(
  target: { readonly model: Record<string, unknown>; readonly field: Record<string, unknown> },
  source: AuthoringAttributeSpecContributions,
  contributedBy: string,
  owners: Map<string, string>,
): void {
  const invalidContribution = (detail: string) =>
    runtimeError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Invalid authoring attributeSpecs contribution from descriptor "${contributedBy}". ${detail}`,
    );
  if (!isCopyableNamespaceObject(source)) {
    throw invalidContribution('Expected a record carrying a "model" and a "field" level.');
  }
  for (const level of ATTRIBUTE_SPEC_LEVELS) {
    const contributed: unknown = source[level];
    if (!isCopyableNamespaceObject(contributed)) {
      throw invalidContribution(
        `The "${level}" level must be a record of spec factories keyed by attribute name.`,
      );
    }
    for (const [attribute, factory] of Object.entries(contributed)) {
      const entryPath = `${level}.${attribute}`;
      const invalidEntry = (detail: string) =>
        runtimeError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Invalid authoring attributeSpecs entry "${entryPath}" contributed by descriptor "${contributedBy}". ${detail}`,
        );
      if (attribute === '__proto__' || attribute === 'constructor' || attribute === 'prototype') {
        throw invalidEntry(`Attribute names must not use "${attribute}".`);
      }
      if (typeof factory !== 'function') {
        throw invalidEntry('Each entry must be a spec factory function.');
      }
      const existingOwner = owners.get(entryPath);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Duplicate authoring attributeSpecs entry "${entryPath}". ` +
            `Descriptor "${contributedBy}" conflicts with "${existingOwner}". ` +
            'Each attribute name may be claimed once per level.',
        );
      }
      owners.set(entryPath, contributedBy);
      target[level][attribute] = factory;
    }
  }
}

/**
 * Collects the full dotted paths of every well-formed descriptor of
 * `descriptorKind` in a raw contribution tree, using the same boundary
 * classification as {@link mergeAuthoringNamespaces}. Lets assembly-level
 * callers attribute each contributed path to its contributing component
 * before merging, so a same-path collision can be reported naming both
 * contributors.
 */
export function collectContributedDescriptorPaths(
  namespace: Record<string, unknown>,
  descriptorKind: AuthoringDescriptorKinds,
  path: readonly string[] = [],
): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isWellFormedDescriptor(value, descriptorKind)) {
      paths.push(currentPath.join('.'));
      continue;
    }
    if (isCopyableNamespaceObject(value)) {
      paths.push(...collectContributedDescriptorPaths(value, descriptorKind, currentPath));
    }
  }
  return paths;
}

export interface ScalarTypeConstructorOutput {
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown>;
}

function visitTemplateArgRefs(
  template: AuthoringTemplateValue | undefined,
  visit: (ref: AuthoringArgRef) => void,
): void {
  if (template === undefined) return;
  if (isAuthoringArgRef(template)) {
    visit(template);
    return;
  }
  if (Array.isArray(template)) {
    for (const value of template) {
      visitTemplateArgRefs(value, visit);
    }
    return;
  }
  if (typeof template === 'object' && template !== null) {
    for (const value of Object.values(template)) {
      visitTemplateArgRefs(value, visit);
    }
  }
}

/**
 * Boundary validation for a contributed authoring type namespace, called
 * per contributing component at assembly (which supplies `contributedBy`
 * for attribution). Rejects what the types cannot express — entity-ref
 * constructors are skipped (their output derives from the referenced
 * entity): every `typeParams` arg-ref must point at a declared argument
 * index.
 */
export function assertResolvableTypeConstructorTemplates(
  namespace: AuthoringTypeNamespace,
  contributedBy: string,
  path: readonly string[] = [],
): void {
  for (const [name, value] of Object.entries(namespace)) {
    const currentPath = [...path, name];
    if (isAuthoringTypeAliasDescriptor(value)) {
      for (const [key, template] of Object.entries(value.output.type.typeParams ?? {})) {
        visitTemplateArgRefs(template, () => {
          throw runtimeError(
            'CONTRACT.PACK_CONTRIBUTION_INVALID',
            `Invalid authoring type alias "${currentPath.join('.')}" contributed by descriptor "${contributedBy}". output.type.typeParams.${key} references an argument, but a type alias takes none. Write the value itself.`,
          );
        });
      }
      continue;
    }
    if (isAuthoringTypeChoiceDescriptor(value)) continue;
    if (!isAuthoringTypeConstructorDescriptor(value)) {
      assertResolvableTypeConstructorTemplates(value, contributedBy, currentPath);
      continue;
    }
    if (value.entityRefArg !== undefined) continue;

    const args = value.args ?? [];
    const invalid = (detail: string) =>
      new Error(
        `Invalid authoring type constructor "${currentPath.join('.')}" contributed by descriptor "${contributedBy}". ${detail}`,
      );

    for (const [key, template] of Object.entries(value.output.typeParams ?? {})) {
      visitTemplateArgRefs(template, (ref) => {
        if (args[ref.index] === undefined) {
          throw invalid(
            `output.typeParams.${key} references argument ${ref.index}, but the constructor declares ${args.length} argument(s). Declare the argument or correct the reference index.`,
          );
        }
      });
    }
  }
}

/**
 * Shape shared by every `Authoring*Namespace` type: a tree whose leaves are
 * descriptors of type `D` and whose internal nodes are sub-namespaces of the
 * same shape. `collectDescriptorPaths` and `collectDescriptorEntries` are
 * generic over `D` so they can walk any of the four descriptor families with
 * a properly narrowed `isLeaf` predicate instead of an `unknown`-typed one.
 */
type AuthoringNamespaceTree<D> = { readonly [name: string]: D | AuthoringNamespaceTree<D> };

function collectDescriptorPaths<D>(
  namespace: AuthoringNamespaceTree<D>,
  isLeaf: (value: D | AuthoringNamespaceTree<D>) => value is D,
  path: readonly string[] = [],
): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isLeaf(value)) {
      paths.push(currentPath.join('.'));
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      paths.push(...collectDescriptorPaths(value, isLeaf, currentPath));
    }
  }
  return paths;
}

interface DescriptorEntry {
  readonly path: string;
  readonly discriminator: string;
}

function collectDescriptorEntries<D extends { readonly discriminator: string }>(
  namespace: AuthoringNamespaceTree<D>,
  isLeaf: (value: D | AuthoringNamespaceTree<D>) => value is D,
  descriptorKind: string,
  label: string,
  path: readonly string[] = [],
): DescriptorEntry[] {
  const entries: DescriptorEntry[] = [];
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isLeaf(value)) {
      // `isLeaf` narrows on `kind` alone; a type-bypassing pack can carry the
      // right `kind` while missing the rest of the descriptor shape. Reject
      // that here so a half-built contribution can't pass validation.
      if (!isWellFormedDescriptor(value, descriptorKind)) {
        throw runtimeError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Malformed authoring ${label} contribution at "${currentPath.join('.')}". The value carries descriptor keys (kind/keyword/discriminator) but does not satisfy the ${label} descriptor shape. Fix the contribution so it is a complete descriptor, or remove the stray keys if it was meant to be a sub-namespace.`,
        );
      }
      if (value.discriminator.length > 0) {
        entries.push({ path: currentPath.join('.'), discriminator: value.discriminator });
      }
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = blindCast<
        Readonly<Record<string, unknown>>,
        'walker inspects a non-leaf value for descriptor-shaped keys before recursing'
      >(value);
      // A value carrying descriptor-shaped keys (`kind`/`keyword`/`discriminator`)
      // but lacking a matching `kind` (so `isLeaf` rejected it) is a malformed
      // declarative descriptor. Descending into it as a sub-namespace would
      // silently skip it, so a half-built contribution would pass validation.
      // Reject it at load time instead, naming the path and what's wrong.
      //
      // A valid sub-namespace whose key happens to be named `kind`, `keyword`, or
      // `discriminator` (but which does not look like a descriptor overall) must
      // still descend normally — the check requires descriptor-shaped keys present
      // AND the leaf guard rejecting it.
      if (
        (record['kind'] !== undefined ||
          record['keyword'] !== undefined ||
          record['discriminator'] !== undefined) &&
        !isLeaf(value)
      ) {
        const hasKind = record['kind'] === 'pslBlock';
        const hasKeyword = typeof record['keyword'] === 'string';
        const hasDiscriminator = typeof record['discriminator'] === 'string';
        if (hasKind || (hasKeyword && hasDiscriminator)) {
          throw runtimeError(
            'CONTRACT.PACK_CONTRIBUTION_INVALID',
            `Malformed authoring ${label} contribution at "${currentPath.join('.')}". The value carries descriptor keys (kind/keyword/discriminator) but does not satisfy the ${label} descriptor shape. Fix the contribution so it is a complete descriptor, or remove the stray keys if it was meant to be a sub-namespace.`,
          );
        }
      }
      entries.push(...collectDescriptorEntries(value, isLeaf, descriptorKind, label, currentPath));
    }
  }
  return entries;
}

/**
 * Throws when two or more entries in the same namespace share a key. A
 * duplicate key makes dispatch ambiguous — the caller's lookup dispatches by
 * this key, so one entry would silently shadow the other. Catch duplicates
 * before building any dispatch map.
 *
 * `label` (e.g. `'pslBlock'`, `'entityType'`) names which namespace the
 * duplicate was found in and is carried in the structured error metadata;
 * the key itself is always called `key` in both the message and the
 * metadata, since what it semantically represents (a discriminator for
 * `entityType`, the parser's dispatch keyword for `pslBlock`) is the
 * caller's concern, not this function's.
 */
function assertUniqueDiscriminators(entries: readonly DescriptorEntry[], label: string): void {
  const seen = new Map<string, string>();
  for (const { path, discriminator: key } of entries) {
    const existing = seen.get(key);
    if (existing !== undefined) {
      throw runtimeError(
        'RUNTIME.DUPLICATE_AUTHORING_DISCRIMINATOR',
        `Duplicate ${label} key "${key}" registered at both "${existing}" and "${path}". Each ${label} contribution must use a unique key.`,
        { label, key, existingPath: existing, path },
      );
    }
    seen.set(key, path);
  }
}

interface PslBlockDescriptorEntry extends DescriptorEntry {
  readonly keyword: string;
}

function collectPslBlockDescriptorEntries(
  namespace: AuthoringPslBlockDescriptorNamespace,
  path: readonly string[] = [],
): PslBlockDescriptorEntry[] {
  const entries: PslBlockDescriptorEntry[] = [];
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isAuthoringPslBlockDescriptor(value)) {
      // `isAuthoringPslBlockDescriptor` narrows on `kind` alone; reject a
      // `kind: 'pslBlock'` value that is missing the rest of the shape.
      if (!isWellFormedDescriptor(value, 'pslBlock')) {
        throw runtimeError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Malformed authoring pslBlock contribution at "${currentPath.join('.')}". The value carries descriptor keys (kind/keyword/discriminator) but does not satisfy the pslBlock descriptor shape. Fix the contribution so it is a complete descriptor, or remove the stray keys if it was meant to be a sub-namespace.`,
        );
      }
      entries.push({
        path: currentPath.join('.'),
        discriminator: value.discriminator,
        keyword: value.keyword,
      });
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = blindCast<
        Readonly<Record<string, unknown>>,
        'walker descends into psl block namespace'
      >(value);
      const hasKind = record['kind'] === 'pslBlock';
      const hasKeyword = typeof record['keyword'] === 'string';
      const hasDiscriminator = typeof record['discriminator'] === 'string';
      if (hasKind || (hasKeyword && hasDiscriminator)) {
        throw runtimeError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Malformed authoring pslBlock contribution at "${currentPath.join('.')}". The value carries descriptor keys (kind/keyword/discriminator) but does not satisfy the pslBlock descriptor shape. Fix the contribution so it is a complete descriptor, or remove the stray keys if it was meant to be a sub-namespace.`,
        );
      }
      entries.push(...collectPslBlockDescriptorEntries(value, currentPath));
    }
  }
  return entries;
}

/**
 * Every `pslBlockDescriptors` entry requires a matching `entityTypes` factory
 * with the same discriminator. An `entityTypes` factory may stand alone (e.g.
 * `enum`, reachable from the TypeScript builder without any PSL block).
 *
 * Uniqueness for pslBlock entries is keyed on **keyword**, not discriminator:
 * several keywords (e.g. `policy_select`/`policy_insert`) may legitimately
 * share one discriminator, routing to the same `entityTypes` factory and the
 * same `entries[discriminator]` slot — that N:1 shape is exactly what lets
 * one entity kind be authored through several PSL keywords. What must stay
 * unique is the keyword itself, since that's what the parser dispatches on.
 */
function assertPslBlocksHaveFactories(
  entityTypeNamespace: AuthoringEntityTypeNamespace,
  pslBlockNamespace: AuthoringPslBlockDescriptorNamespace,
): void {
  const blockEntries = collectPslBlockDescriptorEntries(pslBlockNamespace);
  const entityEntries = collectDescriptorEntries(
    entityTypeNamespace,
    isAuthoringEntityTypeDescriptor,
    'entity',
    'entityType',
  );

  assertUniqueDiscriminators(
    blockEntries.map((entry) => ({ path: entry.path, discriminator: entry.keyword })),
    'pslBlock',
  );
  assertUniqueDiscriminators(entityEntries, 'entityType');

  const entityDiscriminators = new Set(entityEntries.map((entry) => entry.discriminator));

  for (const block of blockEntries) {
    if (!entityDiscriminators.has(block.discriminator)) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Incomplete extension contribution: pslBlock helper "${block.path}" registers discriminator "${block.discriminator}" but no entityType contribution shares that discriminator. An extension-contributed PSL block requires a matching entityType factory so the parsed AST node can lower to an IR class instance; add an entityType helper with discriminator "${block.discriminator}".`,
      );
    }
  }
}

function collectModelAttributeEntries(
  namespace: AuthoringModelAttributeDescriptorNamespace,
  path: readonly string[] = [],
): DescriptorEntry[] {
  const entries: DescriptorEntry[] = [];
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isAuthoringModelAttributeDescriptor(value)) {
      // `isAuthoringModelAttributeDescriptor` narrows on `kind` alone; reject a
      // `kind: 'modelAttribute'` value that is missing the rest of the shape.
      if (!isWellFormedDescriptor(value, 'modelAttribute')) {
        throw runtimeError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Malformed authoring modelAttribute contribution at "${currentPath.join('.')}". The value carries descriptor keys (kind/attribute) but does not satisfy the modelAttribute descriptor shape. Fix the contribution so it is a complete descriptor, or remove the stray keys if it was meant to be a sub-namespace.`,
        );
      }
      entries.push({ path: currentPath.join('.'), discriminator: value.attribute });
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = blindCast<
        Readonly<Record<string, unknown>>,
        'walker descends into modelAttribute namespace'
      >(value);
      // `kind === 'modelAttribute'` is unreachable here: it would have made
      // `isAuthoringModelAttributeDescriptor` true and taken the leaf branch
      // above. A descriptor-shaped-but-kindless value (attribute + spec) is
      // the only malformed case a sub-namespace walk can hit.
      const hasAttribute = typeof record['attribute'] === 'string';
      if (hasAttribute && 'spec' in record) {
        throw runtimeError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Malformed authoring modelAttribute contribution at "${currentPath.join('.')}". The value carries descriptor keys (kind/attribute) but does not satisfy the modelAttribute descriptor shape. Fix the contribution so it is a complete descriptor, or remove the stray keys if it was meant to be a sub-namespace.`,
        );
      }
      entries.push(...collectModelAttributeEntries(value, currentPath));
    }
  }
  return entries;
}

/**
 * Throws when two modelAttribute contributions — at any paths, even
 * different ones — claim the same bare `@@` attribute name. The family
 * interpreter dispatches by attribute name, not by registration path, so
 * two descriptors claiming the same name would have one silently shadow
 * the other.
 */
function assertUniqueModelAttributeNames(entries: readonly DescriptorEntry[]): void {
  const seen = new Map<string, string>();
  for (const { path, discriminator: attribute } of entries) {
    const existing = seen.get(attribute);
    if (existing !== undefined) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Duplicate modelAttribute "${attribute}" registered at both "${existing}" and "${path}". Each modelAttribute contribution must claim a unique attribute name.`,
      );
    }
    seen.set(attribute, path);
  }
}

export function assertNoCrossRegistryCollisions(
  typeNamespace: AuthoringTypeNamespace,
  entityTypeNamespace: AuthoringEntityTypeNamespace = {},
  pslBlockNamespace: AuthoringPslBlockDescriptorNamespace = {},
  modelAttributeNamespace: AuthoringModelAttributeDescriptorNamespace = {},
): void {
  const typePaths = new Set(collectDescriptorPaths(typeNamespace, isAuthoringTypeDescriptor));
  const entityPaths = new Set(
    collectDescriptorPaths(entityTypeNamespace, isAuthoringEntityTypeDescriptor),
  );
  // Within-registry duplicates are caught upstream by the merge walkers; this
  // checks only cross-registry collisions, and only among the user-facing
  // `type`/`entityTypes` paths. `pslBlockDescriptors` is an internal
  // index — its block→factory link is checked by discriminator in
  // `assertPslBlocksHaveFactories`, not by path.
  for (const entityPath of entityPaths) {
    if (typePaths.has(entityPath)) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Ambiguous authoring registry path "${entityPath}". The same path is registered as an entity contribution AND as a type constructor or type alias; PSL resolution would be ambiguous. Register each path in only one of authoringContributions.type / authoringContributions.entityTypes.`,
      );
    }
  }

  assertPslBlocksHaveFactories(entityTypeNamespace, pslBlockNamespace);
  assertUniqueModelAttributeNames(collectModelAttributeEntries(modelAttributeNamespace));
}

function collectDescriptorNodes<D>(
  namespace: AuthoringNamespaceTree<D>,
  isLeaf: (value: D | AuthoringNamespaceTree<D>) => value is D,
  path: readonly string[] = [],
): [string, D][] {
  const nodes: [string, D][] = [];
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isLeaf(value)) {
      nodes.push([currentPath.join('.'), value]);
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      nodes.push(...collectDescriptorNodes(value, isLeaf, currentPath));
    }
  }
  return nodes;
}

export function resolveAuthoringTemplateValue(
  template: AuthoringTemplateValue | undefined,
  args: readonly unknown[],
): unknown {
  if (template === undefined) {
    return undefined;
  }
  if (isAuthoringArgRef(template)) {
    return args[template.index];
  }
  if (Array.isArray(template)) {
    return template.map((value) => resolveAuthoringTemplateValue(value, args));
  }
  if (typeof template === 'object' && template !== null) {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      const resolvedValue = resolveAuthoringTemplateValue(value, args);
      if (resolvedValue !== undefined) {
        resolved[key] = resolvedValue;
      }
    }
    return resolved;
  }
  return template;
}

export function validateAuthoringHelperArguments(
  helperPath: string,
  descriptors: readonly HelperArgumentDescriptor[] | undefined,
  args: readonly unknown[],
): void {
  const expected = descriptors ?? [];
  const minimumArgs = expected.reduce(
    (count, descriptor, index) => (descriptor.optional ? count : index + 1),
    0,
  );
  if (args.length < minimumArgs || args.length > expected.length) {
    throw runtimeError(
      'CONTRACT.ARGUMENT_INVALID',
      `${helperPath} expects ${minimumArgs === expected.length ? expected.length : `${minimumArgs}-${expected.length}`} argument(s), received ${args.length}`,
    );
  }

  expected.forEach((descriptor, index) => {
    if (args[index] === undefined && !descriptor.optional) {
      throw runtimeError(
        'CONTRACT.ARGUMENT_INVALID',
        `${argumentLabel(helperPath, descriptor, index)} is missing`,
      );
    }
  });
}

/** An argument of a type constructor, or of a type choice, whose call a helper checks. */
type HelperArgumentDescriptor = AuthoringArgumentDescriptor | AuthoringTypeChoiceOption;

function argumentLabel(
  helperPath: string,
  descriptor: HelperArgumentDescriptor,
  index: number,
): string {
  return descriptor.name === undefined
    ? `Authoring helper argument at ${helperPath}[${index}]`
    : `Argument "${descriptor.name}" of ${helperPath}`;
}

function argumentIndexOf(template: AuthoringTemplateValue | undefined): number | undefined {
  let index: number | undefined;
  visitTemplateArgRefs(template, (ref) => {
    index ??= ref.index;
  });
  return index;
}

function issueKey(issue: StandardSchemaV1.Issue): string | undefined {
  const [first] = issue.path ?? [];
  const key = typeof first === 'object' && first !== null ? first.key : first;
  return typeof key === 'string' ? key : undefined;
}

/** Why a constructor's type parameters fail its codec's parameter schema, and the argument the failing parameter came from. */
export interface AuthoringTypeParamsIssue {
  readonly message: string;
  readonly argumentIndex: number | undefined;
}

function authoringTypeParamsIssue(
  template: AuthoringStorageTypeTemplate,
  typeParams: Record<string, unknown> | undefined,
  paramsSchema: StandardSchemaV1<unknown> | undefined,
): AuthoringTypeParamsIssue | undefined {
  if (template.typeParams === undefined || paramsSchema === undefined) return undefined;
  const result = paramsSchema['~standard'].validate(typeParams ?? {});
  if (result instanceof Promise) {
    throw new InternalError(
      `The parameter schema of codec "${template.codecId}" is asynchronous; authoring requires a synchronous schema.`,
    );
  }
  const [issue] = result.issues ?? [];
  if (issue === undefined) return undefined;
  const key = issueKey(issue);
  return {
    message: issue.message,
    argumentIndex: key === undefined ? undefined : argumentIndexOf(template.typeParams[key]),
  };
}

/**
 * Checks the type parameters a constructor produced against its codec's parameter schema, which is where the bounds of a data type's parameters are written. A failure names the argument the failing parameter came from.
 */
export function validateAuthoringTypeParams(
  helperPath: string,
  template: AuthoringStorageTypeTemplate,
  typeParams: Record<string, unknown> | undefined,
  paramsSchema: StandardSchemaV1<unknown> | undefined,
): void {
  const issue = authoringTypeParamsIssue(template, typeParams, paramsSchema);
  if (issue === undefined) return;
  const { argumentIndex } = issue;
  throw runtimeError(
    'CONTRACT.ARGUMENT_INVALID',
    argumentIndex === undefined
      ? `The type parameters of ${helperPath} are invalid: ${issue.message}`
      : `Authoring helper argument at ${helperPath}[${argumentIndex}] is invalid: ${issue.message}`,
    { helperPath, ...ifDefined('argumentIndex', argumentIndex) },
  );
}

/**
 * {@link validateAuthoringTypeParams} for a call of the type choice `choice` that chose `chosen`: a failure names the choice's own argument the failing parameter came from, by its name and its index in the choice's arguments.
 */
export function validateAuthoringTypeChoiceParams(
  helperPath: string,
  choice: AuthoringTypeChoiceDescriptor,
  chosen: AuthoringTypeConstructorDescriptor,
  typeParams: Record<string, unknown> | undefined,
  paramsSchema: StandardSchemaV1<unknown> | undefined,
): void {
  const issue = authoringTypeParamsIssue(chosen.output, typeParams, paramsSchema);
  if (issue === undefined) return;
  const name =
    issue.argumentIndex === undefined ? undefined : chosen.args?.[issue.argumentIndex]?.name;
  const argumentIndex =
    name === undefined ? -1 : choice.args.findIndex((argument) => argument.name === name);
  throw runtimeError(
    'CONTRACT.ARGUMENT_INVALID',
    argumentIndex < 0
      ? `The type parameters of ${helperPath} are invalid: ${issue.message}`
      : `Argument "${name}" of ${helperPath} is invalid: ${issue.message}`,
    { helperPath, ...ifDefined('argumentIndex', argumentIndex < 0 ? undefined : argumentIndex) },
  );
}

function resolveAuthoringStorageTypeTemplate(
  template: AuthoringStorageTypeTemplate,
  args: readonly unknown[],
): ScalarTypeConstructorOutput {
  const typeParams =
    template.typeParams === undefined
      ? undefined
      : resolveAuthoringTemplateValue(template.typeParams, args);
  if (typeParams !== undefined && !isAuthoringTemplateRecord(typeParams)) {
    throw runtimeError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Resolved authoring typeParams must be an object for codec "${template.codecId}", received ${String(typeParams)}`,
    );
  }
  const normalizedTypeParams =
    typeParams !== undefined && Object.keys(typeParams).length === 0 ? undefined : typeParams;

  return {
    codecId: template.codecId,
    ...ifDefined('typeParams', normalizedTypeParams),
  };
}

export function instantiateAuthoringTypeConstructor(
  descriptor: AuthoringTypeConstructorDescriptor,
  args: readonly unknown[],
): ScalarTypeConstructorOutput {
  return resolveAuthoringStorageTypeTemplate(descriptor.output, args);
}

/** What a field typed by a contributed type alias takes: the type, and the alias's generator calls. */
export interface AuthoringTypeAliasOutput {
  readonly type: ScalarTypeConstructorOutput;
  readonly onCreate?: GeneratorFunctionCall;
  readonly onUpdate?: GeneratorFunctionCall;
}

export function instantiateAuthoringTypeAlias(
  descriptor: AuthoringTypeAliasDescriptor,
): AuthoringTypeAliasOutput {
  const { output } = descriptor;
  return {
    type: resolveAuthoringStorageTypeTemplate(output.type, []),
    ...ifDefined('onCreate', output.onCreate),
    ...ifDefined('onUpdate', output.onUpdate),
  };
}

const GENERATOR_PHASE_TEXT = { onCreate: 'on create', onUpdate: 'on update' } as const;

/**
 * The generators the calls of the type alias at `path` resolve to for its column, or `undefined` when it calls none. A call that does not resolve is the pack's mistake, so it throws `CONTRACT.PACK_CONTRIBUTION_INVALID`. `length` is the column's length, in its data type's normal form, when the caller's family knows it.
 */
export function resolveTypeAliasGenerators(input: {
  readonly path: string;
  readonly descriptor: AuthoringTypeAliasDescriptor;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly length: number | undefined;
}): ExecutionMutationDefaultPhases | undefined {
  const { type, ...calls } = instantiateAuthoringTypeAlias(input.descriptor);
  const phases: {
    onCreate?: ExecutionMutationDefaultValue;
    onUpdate?: ExecutionMutationDefaultValue;
  } = {};
  for (const phase of ['onCreate', 'onUpdate'] as const) {
    const call = calls[phase];
    if (call === undefined) continue;
    const resolution = input.generatorFunctions.resolve(call, {
      codecId: type.codecId,
      typeParams: type.typeParams,
      length: input.length,
    });
    if (resolution.ok) {
      phases[phase] = resolution.generator;
      continue;
    }
    const written = `Type alias "${input.path}" calls ${call.name}() ${GENERATOR_PHASE_TEXT[phase]}`;
    throw runtimeError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      resolution.reason === 'refused'
        ? `${written}, which its codec "${type.codecId}" refuses: ${resolution.message}`
        : resolution.reason === 'not-bound'
          ? `${written}, which does not apply to its codec "${type.codecId}".`
          : `${written}, but no component declares the generator function "${call.name}".`,
    );
  }
  return phases.onCreate === undefined && phases.onUpdate === undefined ? undefined : phases;
}

/** What assembly checks a contributed type alias against: the stack's generator functions, each codec's parameter schema, and the length the family gives a field of a type. */
export interface TypeAliasAssemblyLookups {
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly paramsSchemaOf: (codecId: string) => StandardSchemaV1<unknown> | undefined;
  readonly fieldLength: (field: Omit<GeneratorFunctionField, 'length'>) => number | undefined;
}

/**
 * Refuses a type alias of `namespace` whose fixed type params its codec's parameter schema refuses, or whose generator call does not resolve for its codec and length. The control stack and the TypeScript builders call it on their assembled namespace, so PSL and TypeScript refuse the same packs, before any schema is read.
 */
export function assertTypeAliasesValid(
  namespace: AuthoringTypeNamespace,
  lookups: TypeAliasAssemblyLookups,
): void {
  for (const [path, descriptor] of collectDescriptorNodes(namespace, isAuthoringTypeDescriptor)) {
    if (!isAuthoringTypeAliasDescriptor(descriptor)) continue;
    const { type } = instantiateAuthoringTypeAlias(descriptor);
    const issue = authoringTypeParamsIssue(
      descriptor.output.type,
      type.typeParams,
      lookups.paramsSchemaOf(type.codecId),
    );
    if (issue !== undefined) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Type alias "${path}" fixes type parameters its codec "${type.codecId}" refuses: ${issue.message}`,
      );
    }
    resolveTypeAliasGenerators({
      path,
      descriptor,
      generatorFunctions: lookups.generatorFunctions,
      length: lookups.fieldLength({ codecId: type.codecId, typeParams: type.typeParams }),
    });
  }
}

/**
 * The column a type constructor makes from the stored values of its arguments, as a reader that holds values rather than written arguments has them, or why its codec's parameter schema refuses the parameters they give. The schema check is {@link validateAuthoringTypeParams}'s.
 */
export function instantiateAuthoringTypeConstructorFromValues(
  descriptor: AuthoringTypeConstructorDescriptor,
  values: readonly unknown[],
  paramsSchema: StandardSchemaV1<unknown> | undefined,
): Result<ScalarTypeConstructorOutput, AuthoringTypeParamsIssue> {
  const output = instantiateAuthoringTypeConstructor(descriptor, values);
  const issue = authoringTypeParamsIssue(descriptor.output, output.typeParams, paramsSchema);
  return issue === undefined ? ok(output) : notOk(issue);
}

export function instantiateAuthoringEntityType<TOutput = unknown>(
  helperPath: string,
  descriptor: AuthoringEntityTypeDescriptor,
  args: readonly unknown[],
  ctx: AuthoringEntityContext,
): TOutput {
  // Factory-output entities carry their input contract on the factory
  // signature itself — TypeScript narrows callers via
  // `EntityHelperFunction`'s extracted `input` parameter, and the factory
  // is free to do its own runtime validation (e.g. arktype Type). The
  // descriptor-level `args` validator is reserved for template-output
  // entities (which mirror a type constructor's declarative argument shape).
  if ('factory' in descriptor.output) {
    const input = args[0];
    // The base `AuthoringEntityTypeDescriptor`'s factory is typed
    // `(input: never, ctx) => unknown` so concrete pack-literal factories
    // with narrower input types remain assignable through the
    // contravariant position (see the type's docstring). The runtime
    // delegates input validation to the pack's factory itself, so we
    // forward the supplied input here without a static input contract.
    const factory = blindCast<
      (input: unknown, ctx: AuthoringEntityContext) => TOutput,
      'entity factory output is caller-selected via instantiateAuthoringEntityType<TOutput>'
    >(descriptor.output.factory);
    return factory(input, ctx);
  }
  validateAuthoringHelperArguments(helperPath, descriptor.args, args);
  return blindCast<TOutput, 'template-output resolves to the declared TOutput by convention'>(
    resolveAuthoringTemplateValue(descriptor.output.template, args),
  );
}
