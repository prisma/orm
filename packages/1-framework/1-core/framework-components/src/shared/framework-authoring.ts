import type {
  ColumnDefault,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import {
  isColumnDefaultLiteralInputValue,
  isExecutionMutationDefaultValue,
} from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { Type } from 'arktype';
import type { CodecLookup } from './codec-types';
import type { AuthoringOption } from './option-descriptor';
import type { PslBlockParam, PslExtensionBlock, PslSpan } from './psl-extension-block';
import { runtimeError } from './runtime-error';

export type EnumInferredMemberType = 'text' | 'int';

export type AuthoringArgRef = {
  readonly kind: 'arg';
  readonly index: number;
  readonly path?: readonly string[];
  readonly default?: AuthoringTemplateValue;
};

/**
 * Selects among `cases` by the value of the referenced argument: the resolved
 * value must be one of the case keys, and the node resolves to that case's
 * recursively resolved template. An absent argument resolves to `undefined`,
 * which the enclosing object template omits entirely.
 *
 * Case coverage is validated against the referenced option argument's
 * `values` at pack-registration time, so the runtime miss-throw is an
 * assertion for type-bypassing callers, not a user-facing diagnostic.
 *
 * Must not be used in the `codecId`/`nullable`/`id`/`unique` positions of a
 * preset output: the type-level `ResolveTemplateValue` does not implement
 * select, and those fields feed TS builder-state inference. See ADR 246.
 */
export interface AuthoringSelectRef {
  readonly kind: 'select';
  readonly index: number;
  readonly path?: readonly string[];
  readonly cases: Readonly<Record<string, AuthoringTemplateValue>>;
}

export type AuthoringTemplateValue =
  | string
  | number
  | boolean
  | null
  | AuthoringArgRef
  | AuthoringSelectRef
  | readonly AuthoringTemplateValue[]
  | { readonly [key: string]: AuthoringTemplateValue };

interface AuthoringArgumentDescriptorCommon {
  readonly name?: string;
  readonly optional?: boolean;
}

export type AuthoringArgumentDescriptor = AuthoringArgumentDescriptorCommon &
  (
    | { readonly kind: 'string' }
    | { readonly kind: 'boolean' }
    | {
        readonly kind: 'number';
        readonly integer?: boolean;
        readonly minimum?: number;
        readonly maximum?: number;
      }
    | { readonly kind: 'stringArray' }
    | {
        readonly kind: 'object';
        readonly properties: Record<string, AuthoringArgumentDescriptor>;
      }
    | AuthoringOption
  );

export interface AuthoringStorageTypeTemplate {
  readonly codecId: string;
  /**
   * The storage type's base name — a plain string, never a template:
   * parameters live in `typeParams` and the DDL renderer composes them.
   * Optional so a type constructor whose {@link AuthoringTypeConstructorDescriptor.entityRefArg}
   * names another entity can omit it entirely — its output for that case is
   * derived by the codec at `codecId`. Every other consumer of this shape
   * (field presets, plain type constructors) always supplies it.
   */
  readonly nativeType?: string;
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
  readonly args?: readonly AuthoringArgumentDescriptor[];
  readonly output: AuthoringStorageTypeTemplate;
  /** Present when one of this constructor's positional arguments names another document-local entity instead of carrying a literal value. Absent for ordinary literal-argument constructors. */
  readonly entityRefArg?: AuthoringTypeConstructorEntityRef;
}

export interface AuthoringColumnDefaultTemplateLiteral {
  readonly kind: 'literal';
  readonly value: AuthoringTemplateValue;
}

export interface AuthoringColumnDefaultTemplateFunction {
  readonly kind: 'function';
  readonly expression: AuthoringTemplateValue;
}

export type AuthoringColumnDefaultTemplate =
  | AuthoringColumnDefaultTemplateLiteral
  | AuthoringColumnDefaultTemplateFunction;

export interface AuthoringExecutionDefaultsTemplate {
  readonly onCreate?: AuthoringTemplateValue;
  readonly onUpdate?: AuthoringTemplateValue;
}

export interface AuthoringFieldPresetOutput extends AuthoringStorageTypeTemplate {
  readonly nullable?: boolean;
  readonly default?: AuthoringColumnDefaultTemplate;
  readonly executionDefaults?: AuthoringExecutionDefaultsTemplate;
  readonly id?: boolean;
  readonly unique?: boolean;
}

export interface AuthoringFieldPresetDescriptor {
  readonly kind: 'fieldPreset';
  readonly args?: readonly AuthoringArgumentDescriptor[];
  readonly output: AuthoringFieldPresetOutput;
}

export type AuthoringTypeNamespace = {
  readonly [name: string]: AuthoringTypeConstructorDescriptor | AuthoringTypeNamespace;
};

export type AuthoringFieldNamespace = {
  readonly [name: string]: AuthoringFieldPresetDescriptor | AuthoringFieldNamespace;
};

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
    const key = `${warning.code}\u0000${warning.summary}`;
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
  readonly codecLookup?: CodecLookup;
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

/**
 * Classifies an `enum` block's members (before codec decoding, which needs
 * the codec chosen first) into which default codec an omitted `@@type`
 * should resolve to:
 *
 * - every member is `bare`, or a `value` whose raw JSON is a string → `'text'`
 * - every member is a `value` whose raw JSON is an integer → `'int'`
 * - anything else (float, bigint, boolean, mixed, or a `ref`/`option`/`list`
 *   parameter) → `null`, meaning the caller must require an explicit `@@type`.
 */
export function classifyEnumMemberType(block: PslExtensionBlock): 'text' | 'int' | null {
  let sawText = false;
  let sawInt = false;

  for (const paramValue of Object.values(block.parameters)) {
    if (paramValue.kind === 'bare') {
      sawText = true;
      continue;
    }
    if (paramValue.kind !== 'value') {
      return null;
    }
    let jsonValue: unknown;
    try {
      jsonValue = JSON.parse(paramValue.raw);
    } catch {
      return null;
    }
    if (typeof jsonValue === 'string') {
      sawText = true;
    } else if (typeof jsonValue === 'number' && Number.isInteger(jsonValue)) {
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
  block: PslExtensionBlock,
  ctx: AuthoringEntityContext,
): { readonly codecId: string; readonly codecSpan: PslSpan } | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const typeAttr = block.blockAttributes.find((a) => a.name === 'type');

  if (typeAttr === undefined) {
    const inferredKind = classifyEnumMemberType(block);
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

  const rawCodecArg = typeAttr.args[0]?.value;
  const codecId =
    rawCodecArg?.startsWith('"') && rawCodecArg.endsWith('"') && rawCodecArg.length >= 2
      ? rawCodecArg.slice(1, -1)
      : undefined;
  if (codecId === undefined) {
    ctx.diagnostics?.push({
      code: 'PSL_ENUM_MISSING_TYPE',
      message: `enum "${block.name}" @@type attribute must have a quoted codec id argument`,
      sourceId,
      span: typeAttr.span,
    });
    return undefined;
  }
  return { codecId, codecSpan: typeAttr.args[0]?.span ?? typeAttr.span };
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
 * - `parameters` maps parameter names to their value-kind descriptors
 *   (`ref` / `value` / `option` / `list`). The generic parser and
 *   validator interpret these; the extension supplies no parser or
 *   printer function.
 */
export interface AuthoringPslBlockDescriptor {
  readonly kind: 'pslBlock';
  readonly keyword: string;
  readonly discriminator: string;
  readonly name: { readonly required: boolean };
  readonly parameters: Record<string, PslBlockParam>;
  /**
   * When `true`, the block body accepts a variadic tail of parameters beyond
   * the declared set. The block body may contain: fields (model-style),
   * `key = value` parameters, and `@@` attributes. With `variadicParameters`,
   * bare identifiers (keys without a `= value`) and undeclared `key = value`
   * pairs flow into the variadic tail — their semantics belong to the
   * lowering, not the parser.
   *
   * A key that IS declared in `parameters` must still be supplied as
   * `key = value`; a bare occurrence of a declared key is a diagnostic.
   *
   * When `false` (default), the validator emits `PSL_EXTENSION_UNKNOWN_PARAMETER`
   * for keys absent from `parameters`.
   */
  readonly variadicParameters?: boolean;
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
}

/**
 * What a model-attribute lowering returns when it produces an entity: `key`
 * is the identity the entity is stored under within its `entries` slot
 * (`entries[attribute][key]`); `entity` is the value stored there. A
 * lowering that instead pushed a diagnostic through
 * {@link AuthoringModelAttributeContext.diagnostics} returns `undefined` —
 * the same convention {@link AuthoringEntityTypeFactoryOutput} uses.
 */
export interface AuthoringModelAttributeLoweringOutput {
  readonly key: string;
  readonly entity: unknown;
}

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
 * - `spec` is opaque to the framework core: an ADR-231 attribute-spec kit
 *   `AttributeSpec<Out>` value (`modelAttribute(name, {...})` from
 *   `@internal/psl-parser`). Framework core does not depend on
 *   psl-parser and never inspects this field; the family interpreter,
 *   which does depend on psl-parser, parses the attribute's arguments
 *   against it.
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

export interface AuthoringContributions {
  readonly type?: AuthoringTypeNamespace;
  readonly field?: AuthoringFieldNamespace;
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
}

export function isAuthoringArgRef(value: unknown): value is AuthoringArgRef {
  if (typeof value !== 'object' || value === null || (value as { kind?: unknown }).kind !== 'arg') {
    return false;
  }
  const { index, path } = value as { index?: unknown; path?: unknown };
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return false;
  }
  if (path !== undefined && (!Array.isArray(path) || path.some((s) => typeof s !== 'string'))) {
    return false;
  }
  return true;
}

function isAuthoringSelectRef(value: unknown): value is AuthoringSelectRef {
  if (!isAuthoringTemplateRecord(value) || value['kind'] !== 'select') {
    return false;
  }
  const index = value['index'];
  const path = value['path'];
  const cases = value['cases'];
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return false;
  }
  if (path !== undefined && (!Array.isArray(path) || path.some((s) => typeof s !== 'string'))) {
    return false;
  }
  return typeof cases === 'object' && cases !== null && !Array.isArray(cases);
}

function isAuthoringTemplateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTemplateArgumentValue(
  args: readonly unknown[],
  index: number,
  path: readonly string[] | undefined,
): unknown {
  let value = args[index];
  for (const segment of path ?? []) {
    if (!isAuthoringTemplateRecord(value) || !Object.hasOwn(value, segment)) {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

export function isAuthoringTypeConstructorDescriptor(
  value: AuthoringTypeConstructorDescriptor | AuthoringTypeNamespace,
): value is AuthoringTypeConstructorDescriptor {
  return 'kind' in value && value.kind === 'typeConstructor';
}

export function isAuthoringFieldPresetDescriptor(
  value: AuthoringFieldPresetDescriptor | AuthoringFieldNamespace,
): value is AuthoringFieldPresetDescriptor {
  return 'kind' in value && value.kind === 'fieldPreset';
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

/**
 * Returns true when `namespace` is a non-leaf key in `contributions.field`.
 *
 * `AuthoringFieldNamespace` permits a leaf descriptor at any depth — including
 * the root — so a top-level `field: { Foo: { kind: 'fieldPreset', ... } }`
 * registration must NOT be treated as a "namespace" with sub-paths. Callers
 * use this predicate to gate dot-namespaced lookups (e.g. PSL `@Foo.bar`).
 */
export function hasRegisteredFieldNamespace(
  contributions: AuthoringContributions | undefined,
  namespace: string,
): boolean {
  if (contributions?.field === undefined || !Object.hasOwn(contributions.field, namespace)) {
    return false;
  }
  const value = contributions.field[namespace];
  return value !== undefined && !isAuthoringFieldPresetDescriptor(value);
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
function isWellFormedDescriptor(value: unknown, descriptorKind: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (!('kind' in value) || value.kind !== descriptorKind) return false;
  switch (descriptorKind) {
    case 'typeConstructor':
    case 'fieldPreset': {
      if (!('output' in value)) return false;
      const output = value.output;
      return typeof output === 'object' && output !== null;
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
      if (!('parameters' in value)) return false;
      const parameters = value.parameters;
      return typeof parameters === 'object' && parameters !== null && !Array.isArray(parameters);
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
  descriptorKind: string,
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
 * level. `descriptorKind` is the `kind` value ('typeConstructor',
 * 'fieldPreset', 'entity', or 'pslBlock') that identifies a descriptor
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
  descriptorKind: string,
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
  descriptorKind: string,
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
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
}

/**
 * Derives the scalar view of an assembled authoring type namespace: every
 * **top-level** type constructor that is instantiable with an empty argument
 * list — all declared args optional and no entity-ref argument. A bare type
 * name `T` in a schema is semantically the zero-arg instantiation `T()`, so
 * each entry is exactly what that call produces (defaulted template values
 * applied, absent optional-arg typeParams keys omitted). Constructors
 * registered under a namespace segment, constructors with required args, and
 * entity-ref constructors are not scalars and are excluded.
 *
 * Eligibility needs no template inspection: templates that cannot resolve
 * for their legal call shapes are rejected at the composition boundary by
 * {@link assertResolvableTypeConstructorTemplates}, so the zero-arg
 * instantiation below cannot fail for an eligible constructor.
 */
export function collectScalarTypeConstructors(
  namespace: AuthoringTypeNamespace,
): ReadonlyMap<string, ScalarTypeConstructorOutput> {
  const result = new Map<string, ScalarTypeConstructorOutput>();
  for (const [name, value] of Object.entries(namespace)) {
    if (!isAuthoringTypeConstructorDescriptor(value)) continue;
    if (value.entityRefArg !== undefined) continue;
    if (value.args?.some((arg) => arg.optional !== true)) continue;
    result.set(name, instantiateAuthoringTypeConstructor(value, []));
  }
  return result;
}

function visitTemplateArgRefs(
  template: AuthoringTemplateValue | undefined,
  visit: (ref: AuthoringArgRef) => void,
): void {
  if (template === undefined) return;
  if (isAuthoringArgRef(template)) {
    visit(template);
    // A reference's fallback is a template of its own; its references are
    // checked too.
    visitTemplateArgRefs(template.default, visit);
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
 * entity): a plain constructor must declare its output storage type name,
 * and every `typeParams` arg-ref (including refs inside arg-ref defaults)
 * must point at a declared argument index.
 */
export function assertResolvableTypeConstructorTemplates(
  namespace: AuthoringTypeNamespace,
  contributedBy: string,
  path: readonly string[] = [],
): void {
  for (const [name, value] of Object.entries(namespace)) {
    const currentPath = [...path, name];
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

    if (value.output.nativeType === undefined) {
      throw invalid(
        'The output declares no storage type template and no entityRefArg; a plain constructor must declare one.',
      );
    }
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
  fieldNamespace: AuthoringFieldNamespace,
  entityTypeNamespace: AuthoringEntityTypeNamespace = {},
  pslBlockNamespace: AuthoringPslBlockDescriptorNamespace = {},
  modelAttributeNamespace: AuthoringModelAttributeDescriptorNamespace = {},
): void {
  const typePaths = new Set(
    collectDescriptorPaths(typeNamespace, isAuthoringTypeConstructorDescriptor),
  );
  const fieldPaths = new Set(
    collectDescriptorPaths(fieldNamespace, isAuthoringFieldPresetDescriptor),
  );
  const entityPaths = new Set(
    collectDescriptorPaths(entityTypeNamespace, isAuthoringEntityTypeDescriptor),
  );
  // Within-registry duplicates are caught upstream by the merge walkers; this
  // checks only cross-registry collisions, and only among the user-facing
  // `type`/`field`/`entityTypes` paths. `pslBlockDescriptors` is an internal
  // index — its block→factory link is checked by discriminator in
  // `assertPslBlocksHaveFactories`, not by path.
  const ambiguityHint =
    'Register each path in only one of authoringContributions.field / authoringContributions.type / authoringContributions.entityTypes.';
  for (const fieldPath of fieldPaths) {
    if (typePaths.has(fieldPath)) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Ambiguous authoring registry path "${fieldPath}". The same path is registered as both a type constructor and a field preset; PSL resolution would be ambiguous. ${ambiguityHint}`,
      );
    }
  }
  for (const entityPath of entityPaths) {
    if (typePaths.has(entityPath) || fieldPaths.has(entityPath)) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Ambiguous authoring registry path "${entityPath}". The same path is registered as an entity contribution AND as a type constructor or field preset; PSL resolution would be ambiguous. ${ambiguityHint}`,
      );
    }
  }

  assertPslBlocksHaveFactories(entityTypeNamespace, pslBlockNamespace);
  assertUniqueModelAttributeNames(collectModelAttributeEntries(modelAttributeNamespace));
  assertSelectTemplatesMatchOptionArgs(typeNamespace, fieldNamespace, entityTypeNamespace);
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

function collectSelectRefs(value: unknown, found: AuthoringSelectRef[]): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  if (isAuthoringSelectRef(value)) {
    found.push(value);
    for (const caseTemplate of Object.values(value.cases)) {
      collectSelectRefs(caseTemplate, found);
    }
    return;
  }
  if (isAuthoringArgRef(value)) {
    collectSelectRefs(value.default, found);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSelectRefs(entry, found);
    }
    return;
  }
  for (const entry of Object.values(value)) {
    collectSelectRefs(entry, found);
  }
}

function validateSelectRefsAgainstArgs(
  label: string,
  helperPath: string,
  args: readonly AuthoringArgumentDescriptor[] | undefined,
  templateRoot: unknown,
): void {
  const selects: AuthoringSelectRef[] = [];
  collectSelectRefs(templateRoot, selects);

  for (const select of selects) {
    const position = `#${select.index + 1}`;
    let descriptor: AuthoringArgumentDescriptor | undefined = args?.[select.index];
    if (descriptor === undefined) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Authoring ${label} helper "${helperPath}" select template references argument ${position}, but the helper declares no argument at that position.`,
      );
    }
    for (const segment of select.path ?? []) {
      descriptor = descriptor.kind === 'object' ? descriptor.properties[segment] : undefined;
      if (descriptor === undefined) {
        throw runtimeError(
          'CONTRACT.PACK_CONTRIBUTION_INVALID',
          `Authoring ${label} helper "${helperPath}" select template references argument ${position} at path "${(select.path ?? []).join('.')}", which does not resolve to a declared argument property.`,
        );
      }
    }
    if (descriptor.kind !== 'option') {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Authoring ${label} helper "${helperPath}" select template references argument ${position}, which is kind "${descriptor.kind}"; select requires an option argument.`,
      );
    }

    const argumentLabel = descriptor.name !== undefined ? `"${descriptor.name}"` : position;
    const missing = descriptor.values.filter((value) => !Object.hasOwn(select.cases, value));
    if (missing.length > 0) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Authoring ${label} helper "${helperPath}" option argument ${argumentLabel} allows [${descriptor.values.join(', ')}] but the select template has no case for: ${missing.join(', ')}.`,
      );
    }
    const values = descriptor.values;
    const unreachable = Object.keys(select.cases).filter((key) => !values.includes(key));
    if (unreachable.length > 0) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Authoring ${label} helper "${helperPath}" select template has case(s) not allowed by option argument ${argumentLabel}: ${unreachable.join(', ')}. Allowed values: [${values.join(', ')}].`,
      );
    }
  }
}

/**
 * Every `select` template node must target an option argument whose `values`
 * exactly cover the node's `cases` — a legal token with no case and a case no
 * token can reach are both declaration bugs, caught here at pack-registration
 * time rather than at first resolution.
 */
function assertSelectTemplatesMatchOptionArgs(
  typeNamespace: AuthoringTypeNamespace,
  fieldNamespace: AuthoringFieldNamespace,
  entityTypeNamespace: AuthoringEntityTypeNamespace,
): void {
  for (const [helperPath, descriptor] of collectDescriptorNodes(
    fieldNamespace,
    isAuthoringFieldPresetDescriptor,
  )) {
    validateSelectRefsAgainstArgs('field', helperPath, descriptor.args, descriptor.output);
  }
  for (const [helperPath, descriptor] of collectDescriptorNodes(
    typeNamespace,
    isAuthoringTypeConstructorDescriptor,
  )) {
    validateSelectRefsAgainstArgs('type', helperPath, descriptor.args, descriptor.output);
  }
  for (const [helperPath, descriptor] of collectDescriptorNodes(
    entityTypeNamespace,
    isAuthoringEntityTypeDescriptor,
  )) {
    if ('template' in descriptor.output) {
      validateSelectRefsAgainstArgs(
        'entityType',
        helperPath,
        descriptor.args,
        descriptor.output.template,
      );
    }
  }
}

export function resolveAuthoringTemplateValue(
  template: AuthoringTemplateValue | undefined,
  args: readonly unknown[],
): unknown {
  if (template === undefined) {
    return undefined;
  }
  if (isAuthoringArgRef(template)) {
    const value = readTemplateArgumentValue(args, template.index, template.path);

    if (value === undefined && template.default !== undefined) {
      return resolveAuthoringTemplateValue(template.default, args);
    }

    return value;
  }
  if (isAuthoringSelectRef(template)) {
    const value = readTemplateArgumentValue(args, template.index, template.path);

    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string' || !Object.hasOwn(template.cases, value)) {
      throw new InternalError(`Authoring template select has no case for value "${String(value)}"`);
    }
    return resolveAuthoringTemplateValue(template.cases[value], args);
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

function validateAuthoringArgument(
  descriptor: AuthoringArgumentDescriptor,
  value: unknown,
  path: string,
): void {
  if (value === undefined) {
    if (descriptor.optional) {
      return;
    }
    throw runtimeError(
      'CONTRACT.ARGUMENT_INVALID',
      `Missing required authoring helper argument at ${path}`,
    );
  }

  if (descriptor.kind === 'string') {
    if (typeof value !== 'string') {
      throw runtimeError(
        'CONTRACT.ARGUMENT_INVALID',
        `Authoring helper argument at ${path} must be a string`,
      );
    }
    return;
  }

  if (descriptor.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw runtimeError(
        'CONTRACT.ARGUMENT_INVALID',
        `Authoring helper argument at ${path} must be a boolean`,
      );
    }
    return;
  }

  if (descriptor.kind === 'stringArray') {
    if (!Array.isArray(value)) {
      throw runtimeError(
        'CONTRACT.ARGUMENT_INVALID',
        `Authoring helper argument at ${path} must be an array of strings`,
      );
    }
    for (const entry of value) {
      if (typeof entry !== 'string') {
        throw runtimeError(
          'CONTRACT.ARGUMENT_INVALID',
          `Authoring helper argument at ${path} must be an array of strings`,
        );
      }
    }
    return;
  }

  if (descriptor.kind === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw runtimeError(
        'CONTRACT.ARGUMENT_INVALID',
        `Authoring helper argument at ${path} must be an object`,
      );
    }

    const input = value as Record<string, unknown>;
    const expectedKeys = new Set(Object.keys(descriptor.properties));

    for (const key of Object.keys(input)) {
      if (!expectedKeys.has(key)) {
        throw runtimeError(
          'CONTRACT.ARGUMENT_INVALID',
          `Authoring helper argument at ${path} contains unknown property "${key}"`,
        );
      }
    }

    for (const [key, propertyDescriptor] of Object.entries(descriptor.properties)) {
      validateAuthoringArgument(propertyDescriptor, input[key], `${path}.${key}`);
    }

    return;
  }

  if (descriptor.kind === 'option') {
    if (typeof value !== 'string' || !descriptor.values.includes(value)) {
      throw runtimeError(
        'CONTRACT.ARGUMENT_INVALID',
        `Authoring helper argument at ${path} must be one of: ${descriptor.values.join(', ')}`,
      );
    }
    return;
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw runtimeError(
      'CONTRACT.ARGUMENT_INVALID',
      `Authoring helper argument at ${path} must be a number`,
    );
  }

  if (descriptor.integer && !Number.isInteger(value)) {
    throw runtimeError(
      'CONTRACT.ARGUMENT_INVALID',
      `Authoring helper argument at ${path} must be an integer`,
    );
  }
  if (descriptor.minimum !== undefined && value < descriptor.minimum) {
    throw runtimeError(
      'CONTRACT.ARGUMENT_INVALID',
      `Authoring helper argument at ${path} must be >= ${descriptor.minimum}, received ${value}`,
    );
  }
  if (descriptor.maximum !== undefined && value > descriptor.maximum) {
    throw runtimeError(
      'CONTRACT.ARGUMENT_INVALID',
      `Authoring helper argument at ${path} must be <= ${descriptor.maximum}, received ${value}`,
    );
  }
}

export function validateAuthoringHelperArguments(
  helperPath: string,
  descriptors: readonly AuthoringArgumentDescriptor[] | undefined,
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
    validateAuthoringArgument(descriptor, args[index], `${helperPath}[${index}]`);
  });
}

function resolveAuthoringStorageTypeTemplate(
  template: AuthoringStorageTypeTemplate,
  args: readonly unknown[],
): {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
} {
  const nativeType = template.nativeType;
  if (nativeType === undefined) {
    throw runtimeError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Authoring output template for codec "${template.codecId}" declares no nativeType; only entity-ref constructors may omit it`,
    );
  }
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
    nativeType,
    ...ifDefined('typeParams', normalizedTypeParams),
  };
}

function resolveAuthoringColumnDefaultTemplate(
  template: AuthoringColumnDefaultTemplate,
  args: readonly unknown[],
): ColumnDefault {
  if (template.kind === 'literal') {
    const value = resolveAuthoringTemplateValue(template.value, args);
    if (value === undefined) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        'Resolved authoring literal default must not be undefined',
      );
    }
    if (!isColumnDefaultLiteralInputValue(value)) {
      throw runtimeError(
        'CONTRACT.PACK_CONTRIBUTION_INVALID',
        `Resolved authoring literal default must be a JSON-serializable value or Date, received ${String(value)}`,
      );
    }
    return {
      kind: 'literal',
      value,
    };
  }

  const expression = resolveAuthoringTemplateValue(template.expression, args);
  if (expression === undefined || (typeof expression === 'object' && expression !== null)) {
    throw runtimeError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Resolved authoring function default expression must resolve to a primitive, received ${String(expression)}`,
    );
  }
  return {
    kind: 'function',
    expression: String(expression),
  };
}

function resolveExecutionMutationDefaultPhase(
  phase: 'onCreate' | 'onUpdate',
  template: AuthoringTemplateValue,
  args: readonly unknown[],
): ExecutionMutationDefaultValue | undefined {
  const value = resolveAuthoringTemplateValue(template, args);
  if (value === undefined) {
    return undefined;
  }
  if (!isExecutionMutationDefaultValue(value)) {
    throw runtimeError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Authoring preset executionDefaults.${phase} did not resolve to a valid generator descriptor (kind: 'generator', id: string).`,
    );
  }
  return value;
}

function resolveAuthoringExecutionDefaultsTemplate(
  template: AuthoringExecutionDefaultsTemplate,
  args: readonly unknown[],
): ExecutionMutationDefaultPhases | undefined {
  const phases: ExecutionMutationDefaultPhases = {
    ...ifDefined(
      'onCreate',
      template.onCreate !== undefined
        ? resolveExecutionMutationDefaultPhase('onCreate', template.onCreate, args)
        : undefined,
    ),
    ...ifDefined(
      'onUpdate',
      template.onUpdate !== undefined
        ? resolveExecutionMutationDefaultPhase('onUpdate', template.onUpdate, args)
        : undefined,
    ),
  };
  return Object.keys(phases).length === 0 ? undefined : phases;
}

export function instantiateAuthoringTypeConstructor(
  descriptor: AuthoringTypeConstructorDescriptor,
  args: readonly unknown[],
): {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
} {
  return resolveAuthoringStorageTypeTemplate(descriptor.output, args);
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
  // entities (which mirror field/type's declarative argument shape).
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

export function instantiateAuthoringFieldPreset(
  descriptor: AuthoringFieldPresetDescriptor,
  args: readonly unknown[],
): {
  readonly descriptor: {
    readonly codecId: string;
    readonly nativeType: string;
    readonly typeParams?: Record<string, unknown>;
  };
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly id: boolean;
  readonly unique: boolean;
} {
  return {
    descriptor: resolveAuthoringStorageTypeTemplate(descriptor.output, args),
    nullable: descriptor.output.nullable ?? false,
    ...ifDefined(
      'default',
      descriptor.output.default !== undefined
        ? resolveAuthoringColumnDefaultTemplate(descriptor.output.default, args)
        : undefined,
    ),
    ...ifDefined(
      'executionDefaults',
      descriptor.output.executionDefaults !== undefined
        ? resolveAuthoringExecutionDefaultsTemplate(descriptor.output.executionDefaults, args)
        : undefined,
    ),
    id: descriptor.output.id ?? false,
    unique: descriptor.output.unique ?? false,
  };
}
