export type { AuthoringPslBlockDescriptorNamespace } from '../shared/framework-authoring';
export type {
  ContributedPslDiagnosticCode,
  PslBlockParam,
  PslBlockParamList,
  PslBlockParamOption,
  PslBlockParamRef,
  PslBlockParamValue,
  PslDiagnosticCode,
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockAttributeArg,
  PslExtensionBlockParamBare,
  PslExtensionBlockParamList,
  PslExtensionBlockParamOption,
  PslExtensionBlockParamRef,
  PslExtensionBlockParamScalarValue,
  PslExtensionBlockParamValue,
  PslExtensionBlockParsedAttribute,
  PslPosition,
  PslSpan,
} from '../shared/psl-extension-block';

import { blindCast } from '@internal/utils/casts';
import type { CodecLookup } from '../shared/codec-types';
import type { AuthoringPslBlockDescriptorNamespace } from '../shared/framework-authoring';
import type {
  ContributedPslDiagnosticCode,
  PslDiagnosticCode,
  PslExtensionBlock,
  PslSpan,
} from '../shared/psl-extension-block';

export interface PslDiagnostic {
  /**
   * The closed {@link PslDiagnosticCode} set exists for IDE completion and
   * as documentation of the framework's own codes; the
   * {@link ContributedPslDiagnosticCode} pattern arm is the seam for
   * package-contributed codes, minted where the domain vocabulary lives
   * (e.g. contract-psl). The two arms are extensionally equal — every
   * framework code matches the pattern — and nothing switches
   * exhaustively over the union, deliberately: consumers treat the code
   * as an opaque identifier.
   */
  readonly code: PslDiagnosticCode | ContributedPslDiagnosticCode;
  readonly message: string;
  readonly sourceId: string;
  readonly span: PslSpan;
}

export interface PslDefaultFunctionValue {
  readonly kind: 'function';
  readonly name: 'autoincrement' | 'now';
}

export interface PslDefaultLiteralValue {
  readonly kind: 'literal';
  readonly value: string | number | boolean;
}

export type PslDefaultValue = PslDefaultFunctionValue | PslDefaultLiteralValue;

export type PslAttributeTarget = 'field' | 'model' | 'enum' | 'namedType';

export interface PslAttributePositionalArgument {
  readonly kind: 'positional';
  readonly value: string;
  readonly span: PslSpan;
}

export interface PslAttributeNamedArgument {
  readonly kind: 'named';
  readonly name: string;
  readonly value: string;
  readonly span: PslSpan;
}

export type PslAttributeArgument = PslAttributePositionalArgument | PslAttributeNamedArgument;

export interface PslTypeConstructorCall {
  readonly kind: 'typeConstructor';
  readonly path: readonly string[];
  readonly args: readonly PslAttributeArgument[];
  readonly span: PslSpan;
}

export interface PslAttribute {
  readonly kind: 'attribute';
  readonly target: PslAttributeTarget;
  readonly name: string;
  readonly args: readonly PslAttributeArgument[];
  readonly span: PslSpan;
}

export type PslReferentialAction = string;

export type PslFieldAttribute = PslAttribute;

export interface PslField {
  readonly kind: 'field';
  readonly name: string;
  /** Unqualified type name, e.g. `"User"` for both `User`, `auth.User`, and `supabase:auth.User`. */
  readonly typeName: string;
  /** Namespace qualifier from a dot-qualified type reference, e.g. `"auth"` for `auth.User` or `supabase:auth.User`. Absent for unqualified types. */
  readonly typeNamespaceId?: string;
  /**
   * Contract-space qualifier from a colon-prefix type reference, e.g. `"supabase"` for
   * `supabase:auth.User` or `supabase:User`. Absent for local (same-space) type references.
   *
   * When present, the field references a model from a different contract space. The namespace
   * (`typeNamespaceId`) and model name (`typeName`) identify the target within that space.
   * Physical table resolution against the extension contract is deferred to the aggregate stage (M3).
   */
  readonly typeContractSpaceId?: string;
  readonly typeConstructor?: PslTypeConstructorCall;
  readonly optional: boolean;
  readonly list: boolean;
  readonly typeRef?: string;
  readonly attributes: readonly PslFieldAttribute[];
  readonly span: PslSpan;
}

export interface PslUniqueConstraint {
  readonly kind: 'unique';
  readonly fields: readonly string[];
  readonly span: PslSpan;
}

export interface PslIndexConstraint {
  readonly kind: 'index';
  readonly fields: readonly string[];
  readonly span: PslSpan;
}

export type PslModelAttribute = PslAttribute;

export interface PslModel {
  readonly kind: 'model';
  readonly name: string;
  readonly fields: readonly PslField[];
  readonly attributes: readonly PslModelAttribute[];
  readonly span: PslSpan;
  /**
   * Optional leading comment line emitted above the `model` keyword by the
   * printer. Producers (e.g. `sqlSchemaIrToPslAst`) attach introspection
   * advisories such as "// WARNING: This table has no primary key in the
   * database" here. The parser leaves this field unset; round-tripping a
   * parsed schema does not re-attach comments.
   */
  readonly comment?: string;
}

/**
 * A reusable group of fields embedded in a model (a `type Name { … }` block) —
 * e.g. a MongoDB embedded document or a Postgres composite type. Unlike
 * {@link PslModel} it has no storage or identity of its own.
 */
export interface PslCompositeType {
  readonly kind: 'compositeType';
  readonly name: string;
  readonly fields: readonly PslField[];
  readonly attributes: readonly PslAttribute[];
  readonly span: PslSpan;
}

export interface PslNamedTypeDeclaration {
  readonly kind: 'namedType';
  readonly name: string;
  /**
   * Parser invariant: exactly one of `baseType` and `typeConstructor` is set.
   * Expressing this as a discriminated union trips TypeScript narrowing when
   * the declaration flows through helpers that accept the full union.
   */
  readonly baseType?: string;
  readonly typeConstructor?: PslTypeConstructorCall;
  readonly attributes: readonly PslAttribute[];
  readonly span: PslSpan;
}

export interface PslTypesBlock {
  readonly kind: 'types';
  readonly declarations: readonly PslNamedTypeDeclaration[];
  readonly span: PslSpan;
}

/**
 * Name of the synthesised namespace bucket the framework parser uses for
 * top-level declarations that appear outside any `namespace { … }` block.
 * The double-underscore decoration signals that the identifier is parser-
 * synthesised and never appears in user-authored PSL source — writing
 * `namespace __unspecified__ { … }` is a parse error.
 *
 * Distinct from the IR sentinel `__unbound__`: the PSL bucket describes
 * syntactic absence at the parser layer; the IR sentinel describes a late-
 * bound storage slot at the IR layer. Per-target interpreters decide how
 * (or whether) to map the PSL bucket to the IR sentinel.
 */
export const UNSPECIFIED_PSL_NAMESPACE_ID = '__unspecified__';

/** A value in {@link PslNamespace.entries}: a built-in entity node or an extension-contributed {@link PslExtensionBlock}. */
export type PslNamespaceEntry = PslModel | PslCompositeType | PslExtensionBlock;

/**
 * A namespace block, or the parser's synthesised `__unspecified__` bucket for
 * declarations outside any `namespace { … }`. Same-name blocks reopen-merge;
 * `span` points at the first opening.
 *
 * Entities are stored canonically (ADR 224) in `entries[kind][name]`, where
 * `kind` is the PSL keyword for built-ins or the block discriminator for
 * extension kinds, e.g. `entries['policy']['ReadPosts']` (the discriminator,
 * not the PSL keyword — a `policy_select` block lands under `'policy'` per
 * ADR 225).
 */
export interface PslNamespace {
  readonly kind: 'namespace';
  readonly name: string;
  /** Canonical store: a frozen container of frozen per-kind maps. The accessors below derive from it. */
  readonly entries: Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>>;
  /** Built-in models, from `entries['model']`. Extension kinds: {@link namespacePslExtensionBlocks}. */
  readonly models: readonly PslModel[];
  /** Built-in composite types, from `entries['compositeType']`. */
  readonly compositeTypes: readonly PslCompositeType[];
  readonly span: PslSpan;
}

/**
 * Stores `entries`; exposes `models`/`enums`/`compositeTypes` as getters over
 * it. The getters are prototype members (non-enumerable), so spreading or
 * `JSON.stringify`-ing a namespace copies only `entries`, never a duplicate view.
 */
class PslNamespaceNode implements PslNamespace {
  readonly kind = 'namespace' as const;
  readonly name: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>>;
  readonly span: PslSpan;

  constructor(init: {
    readonly name: string;
    readonly entries: Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>>;
    readonly span: PslSpan;
  }) {
    this.name = init.name;
    this.entries = init.entries;
    this.span = init.span;
    Object.freeze(this);
  }

  get models(): readonly PslModel[] {
    return blindCast<readonly PslModel[], 'entries[model] holds only PslModel by construction'>(
      Object.values(this.entries['model'] ?? {}),
    );
  }

  get compositeTypes(): readonly PslCompositeType[] {
    return blindCast<
      readonly PslCompositeType[],
      'entries[compositeType] holds only PslCompositeType by construction'
    >(Object.values(this.entries['compositeType'] ?? {}));
  }
}

/** Constructs a {@link PslNamespace}. Use this, never a namespace literal — the accessors must derive from `entries`. */
export function makePslNamespace(init: {
  readonly kind: 'namespace';
  readonly name: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>>;
  readonly span: PslSpan;
}): PslNamespace {
  return new PslNamespaceNode(init);
}

/**
 * Builds the frozen `entries[kind][name]` container from per-kind arrays.
 * Built-ins key on their PSL keyword; extension blocks key on their `kind`
 * discriminator. Call this rather than hand-building the literal.
 */
export function makePslNamespaceEntries(
  models: readonly PslModel[],
  compositeTypes: readonly PslCompositeType[],
  extensionBlocks: readonly PslExtensionBlock[],
): Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>> {
  const container: Record<string, Readonly<Record<string, PslNamespaceEntry>>> = {};

  if (models.length > 0) {
    const map: Record<string, PslModel> = {};
    for (const m of models) {
      map[m.name] = m;
    }
    container['model'] = Object.freeze(map);
  }

  if (compositeTypes.length > 0) {
    const map: Record<string, PslCompositeType> = {};
    for (const ct of compositeTypes) {
      map[ct.name] = ct;
    }
    container['compositeType'] = Object.freeze(map);
  }

  for (const block of extensionBlocks) {
    const existing = container[block.kind];
    const newMap: Record<string, PslExtensionBlock> = existing
      ? blindCast<Record<string, PslExtensionBlock>, 'kind map holds only PslExtensionBlock'>({
          ...existing,
        })
      : {};
    newMap[block.name] = block;
    container[block.kind] = Object.freeze(newMap);
  }

  return Object.freeze(container);
}

export interface PslDocumentAst {
  readonly kind: 'document';
  readonly sourceId: string;
  readonly namespaces: readonly PslNamespace[];
  readonly types?: PslTypesBlock;
  readonly span: PslSpan;
}

/**
 * Returns all models from every namespace in document order. Convenience
 * for consumers that don't (yet) need namespace-awareness.
 */
export function flatPslModels(ast: PslDocumentAst): readonly PslModel[] {
  return ast.namespaces.flatMap((ns) =>
    blindCast<PslModel[], 'model kind map contains only PslModel by construction'>(
      Object.values(ns.entries['model'] ?? {}),
    ),
  );
}

/**
 * Returns all composite types from every namespace in document order.
 */
export function flatPslCompositeTypes(ast: PslDocumentAst): readonly PslCompositeType[] {
  return ast.namespaces.flatMap((ns) =>
    blindCast<
      PslCompositeType[],
      'compositeType kind map contains only PslCompositeType by construction'
    >(Object.values(ns.entries['compositeType'] ?? {})),
  );
}

/**
 * The set of `entries` kind keys that the framework parser reserves for
 * built-in PSL entity kinds. Any own-enumerable key on `PslNamespace.entries`
 * that is **not** in this set was contributed by an extension-block descriptor.
 *
 * Built-in keys match the PSL keyword used on each block type:
 * `'model'`, `'compositeType'`. The `'enum'` keyword is claimed by the
 * extension-block grammar via a registered descriptor, so `entries['enum']`
 * holds `PslExtensionBlock` nodes and is returned by `namespacePslExtensionBlocks`.
 */
export const BUILTIN_PSL_KIND_KEYS: ReadonlySet<string> = new Set(['model', 'compositeType']);

/**
 * Returns all extension-contributed blocks in the given namespace, in
 * insertion order (the order the parser encountered them in the source).
 *
 * Reads from `namespace.entries`, skipping the built-in kind keys
 * (`'model'`, `'compositeType'`). All remaining kind maps contain
 * only `PslExtensionBlock` nodes by construction (see `makePslNamespaceEntries`).
 */
export function namespacePslExtensionBlocks(ns: PslNamespace): readonly PslExtensionBlock[] {
  const result: PslExtensionBlock[] = [];
  for (const [kindKey, kindMap] of Object.entries(ns.entries)) {
    if (BUILTIN_PSL_KIND_KEYS.has(kindKey)) continue;
    for (const entry of Object.values(kindMap)) {
      result.push(
        blindCast<
          PslExtensionBlock,
          'non-builtin kind maps contain only PslExtensionBlock by construction'
        >(entry),
      );
    }
  }
  return result;
}

export interface ParsePslDocumentInput {
  readonly schema: string;
  readonly sourceId: string;
  /**
   * Registry of declarative block descriptors, keyed by arbitrary path
   * segments with {@link AuthoringPslBlockDescriptor} leaves. The registry
   * teaches the parser which top-level keywords belong to extension
   * contributions: when the parser encounters an unknown keyword, it looks
   * it up here and, when found, reads the block generically into a
   * {@link PslExtensionBlock} node. Absent or undefined means no extension
   * blocks are registered and any unknown keyword yields
   * `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK`.
   *
   * Contrast with the parsed block nodes themselves, which live in
   * {@link PslNamespace.entries} under their discriminator key (read them with
   * {@link namespacePslExtensionBlocks}); this field holds the registry of
   * descriptors that teach the parser how to read those blocks.
   */
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  /**
   * Codec lookup for validating `value`-kind extension block parameters.
   * When provided alongside `pslBlockDescriptors`, the generic validator runs
   * over every parsed extension block after the full AST is assembled,
   * appending any diagnostics to the parse result. Absent or undefined means
   * no codec validation runs; `ref` resolution still runs when namespace
   * context is available (built from the assembled namespaces).
   */
  readonly codecLookup?: CodecLookup;
}

export interface ParsePslDocumentResult {
  readonly ast: PslDocumentAst;
  readonly diagnostics: readonly PslDiagnostic[];
  readonly ok: boolean;
}
