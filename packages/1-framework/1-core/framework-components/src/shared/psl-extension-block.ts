/**
 * Shape-only types for the PSL source-position primitives, diagnostic
 * codes, extension-block descriptor vocabulary, and the uniform
 * extension-block AST node base.
 *
 * These live in the shared plane so an extension's authoring descriptor
 * (`AuthoringPslBlockDescriptor` in `framework-authoring`) can reference
 * them without crossing the shared → migration-plane boundary. The
 * migration-plane `psl-ast.ts` re-exports everything here for consumers
 * that import PSL AST types from the control entrypoint.
 */

import type { AuthoringOption } from './option-descriptor';

export interface PslPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface PslSpan {
  readonly start: PslPosition;
  readonly end: PslPosition;
}

export type PslDiagnosticCode =
  | 'PSL_UNTERMINATED_BLOCK'
  | 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK'
  | 'PSL_INVALID_NAMESPACE_BLOCK'
  | 'PSL_INVALID_ATTRIBUTE_SYNTAX'
  | 'PSL_INVALID_MODEL_MEMBER'
  | 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE'
  | 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE'
  | 'PSL_INVALID_RELATION_ATTRIBUTE'
  | 'PSL_INVALID_REFERENTIAL_ACTION'
  | 'PSL_INVALID_DEFAULT_VALUE'
  | 'PSL_INVALID_ENUM_MEMBER'
  | 'PSL_INVALID_TYPES_MEMBER'
  | 'PSL_INVALID_QUALIFIED_TYPE'
  /**
   * A qualified name (e.g. a dotted type or attribute reference) is structurally
   * invalid, such as an over-qualified or trailing-separator name.
   */
  | 'PSL_INVALID_QUALIFIED_NAME'
  /**
   * A reserved declaration keyword (`model`/`enum`/`namespace`/`type`) that
   * committed the declaration kind on the keyword alone but is missing its name
   * and/or opening brace. The recursive-descent parser produces a best-effort
   * typed node for the malformed header and reports this code rather than
   * `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK`, which is reserved for a genuinely unknown
   * top-level keyword.
   */
  | 'PSL_INVALID_DECLARATION'
  /**
   * A malformed line inside an extension-contributed top-level block body, or
   * a structurally invalid element inside a `list` parameter value.
   *
   * Replaces the overloaded `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` code that the
   * generic framework parser previously used for these two parse-error sites
   * inside extension blocks — keeping `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` for
   * its original meaning (an unknown keyword at the top level) and giving
   * extension-block parse errors their own code.
   */
  | 'PSL_INVALID_EXTENSION_BLOCK_MEMBER'
  /**
   * A malformed JS-like object literal `{ key: value, … }` in value/argument
   * position — a field missing its `:`, a field missing its value, or an
   * unterminated `{`. The recursive-descent parser still produces a best-effort
   * `ObjectLiteralExpr` node (preserving the lossless round-trip) and reports
   * this code anchored on the offending token.
   */
  | 'PSL_INVALID_OBJECT_LITERAL'
  /**
   * A string literal with no closing quote — the tokenizer stops the literal at
   * a newline or at EOF when no terminating `"` is found, and the
   * recursive-descent parser still consumes the token (preserving the lossless
   * round-trip) but reports this code anchored on the string token's span.
   */
  | 'PSL_UNTERMINATED_STRING'
  /**
   * An unknown parameter key in an extension-contributed block — a key present
   * in the source block but absent from the descriptor's `parameters` map.
   */
  | 'PSL_EXTENSION_UNKNOWN_PARAMETER'
  /**
   * A required parameter declared in the descriptor is absent from the parsed block.
   */
  | 'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER'
  /**
   * An `option`-kind parameter value is not one of the allowed tokens listed
   * in the descriptor's `values` array.
   */
  | 'PSL_EXTENSION_OPTION_OUT_OF_SET'
  /**
   * A `value`-kind parameter's raw text is not a valid JSON literal, or the
   * parsed JSON value was rejected by the codec's `decodeJson` method, or the
   * codec id is not registered in the lookup.
   */
  | 'PSL_EXTENSION_INVALID_VALUE'
  /**
   * A `ref`-kind parameter identifier does not resolve to a declared entity of
   * the required `refKind` within the declared scope.
   */
  | 'PSL_EXTENSION_UNRESOLVED_REF'
  /**
   * A parameter key appears more than once in an extension block body.
   * The first occurrence is kept; subsequent occurrences emit this diagnostic.
   */
  | 'PSL_EXTENSION_DUPLICATE_PARAMETER'
  /**
   * A `@@`-prefixed block-attribute line inside an extension block has invalid syntax.
   */
  | 'PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE'
  | 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE'
  /**
   * Duplicate scopes are top level, namespace body, or block fields; diagnostics
   * are first-wins and anchored on later name spans.
   */
  | 'PSL_DUPLICATE_DECLARATION';

/**
 * A PSL diagnostic code contributed by a family or target package (e.g. an
 * attribute-spec refine in a family's authoring layer). The framework union
 * above stays the parser's own vocabulary; contributed codes share the
 * `PSL_` pattern but their names are owned by the contributing package —
 * no family or target vocabulary enters this module. Contributed codes
 * must not reuse a framework code name; pick a domain-scoped prefix
 * segment (e.g. `PSL_INDEX_`, `PSL_POLICY_`) to keep the namespaces
 * collision-free.
 */
export type ContributedPslDiagnosticCode = `PSL_${string}`;

/**
 * Descriptor vocabulary for a single parameter on a declared block.
 *
 * Four kinds:
 * - `ref` — the parameter value is an identifier that must resolve to a
 *   declared entity of `refKind` within the declared `scope`.
 * - `value` — the parameter value is a PSL literal parsed and printed
 *   through the codec identified by `codecId`.
 * - `option` — the parameter value is one of the literal tokens in `values`.
 *   Not a codec; not persisted data. A closed authoring-time constraint only.
 * - `list` — a bracketed list whose elements each match the `of` descriptor.
 */
export type PslBlockParam =
  | PslBlockParamRef
  | PslBlockParamValue
  | PslBlockParamOption
  | PslBlockParamList;

export interface PslBlockParamRef {
  readonly kind: 'ref';
  readonly refKind: string;
  readonly scope: 'same-namespace' | 'same-space' | 'cross-space';
  readonly required?: boolean;
}

export interface PslBlockParamValue {
  readonly kind: 'value';
  readonly codecId: string;
  readonly required?: boolean;
}

export interface PslBlockParamOption extends AuthoringOption {
  readonly required?: boolean;
}

export interface PslBlockParamList {
  readonly kind: 'list';
  readonly of: PslBlockParam;
  readonly required?: boolean;
}

/**
 * The parsed representation of a single parameter value on a uniform
 * extension-block AST node. Mirrors the `PslBlockParam` descriptor
 * vocabulary, plus `bare` for keyonly entries:
 *
 * - `ref`    → `PslExtensionBlockParamRef` — a raw identifier string
 *   (resolution runs in the validator, not the parser).
 * - `value`  → `PslExtensionBlockParamScalarValue` — a raw PSL literal string
 *   (codec validation runs in the validator).
 * - `option` → `PslExtensionBlockParamOption` — the chosen token.
 * - `list`   → `PslExtensionBlockParamList` — ordered list of the above.
 * - `bare`   → `PslExtensionBlockParamBare` — a bare identifier line with no
 *   `= value` (e.g. `Low` in an enum block). The name is the key in
 *   `parameters`; the interpreting consumer decides the default value.
 *
 * These shapes are intentionally minimal. The validator and lowering refine
 * and consume them; the generic framework parser produces them.
 */
export type PslExtensionBlockParamValue =
  | PslExtensionBlockParamRef
  | PslExtensionBlockParamScalarValue
  | PslExtensionBlockParamOption
  | PslExtensionBlockParamList
  | PslExtensionBlockParamBare;

export interface PslExtensionBlockParamRef {
  readonly kind: 'ref';
  readonly identifier: string;
  readonly span: PslSpan;
}

export interface PslExtensionBlockParamScalarValue {
  readonly kind: 'value';
  readonly raw: string;
  readonly span: PslSpan;
}

export interface PslExtensionBlockParamOption {
  readonly kind: 'option';
  readonly token: string;
  readonly span: PslSpan;
}

export interface PslExtensionBlockParamList {
  readonly kind: 'list';
  readonly items: readonly PslExtensionBlockParamValue[];
  readonly span: PslSpan;
}

/**
 * A bare identifier line inside an extension block — a key with no `= value`.
 * Emitted when a line matches `/^[A-Za-z_]\w*$/` with no assignment. The
 * consumer decides what default value (if any) to apply.
 */
export interface PslExtensionBlockParamBare {
  readonly kind: 'bare';
  readonly span: PslSpan;
}

/**
 * A positional argument on a block attribute, e.g. the `"pg/text@1"` in
 * `@@type("pg/text@1")`.
 */
export interface PslExtensionBlockAttributeArg {
  readonly kind: 'positional';
  readonly value: string;
  readonly span: PslSpan;
}

/**
 * A `@@`-prefixed block-level attribute parsed inside an extension block,
 * e.g. `@@type("pg/text@1")`. Block attributes are captured generically
 * — the parser does not validate attribute names or argument shapes; that
 * is a concern of the block's interpreter.
 */
export interface PslExtensionBlockAttribute {
  readonly name: string;
  readonly args: readonly PslExtensionBlockAttributeArg[];
  readonly span: PslSpan;
}

export interface PslExtensionBlockParsedAttribute {
  readonly args: Readonly<Record<string, unknown>>;
  readonly span: PslSpan;
}

/**
 * Base shape for a uniform extension-contributed top-level PSL block
 * node, as produced by the generic framework parser and consumed by the
 * validator, printer, and lowering factory.
 *
 * - `kind` is the routing discriminant, equal to the descriptor's
 *   `discriminator`. The framework parser sets this to
 *   `descriptor.discriminator` for every block it parses. Several keywords
 *   may share one discriminator (e.g. `policy_select`/`policy_insert` both
 *   route to `kind: 'policy'`) — `kind` identifies the entity/storage kind,
 *   not the source syntax.
 * - `keyword` is the source PSL keyword the block was declared with
 *   (`policy_select`, `policy_insert`, …) — the parse-dispatch identity.
 *   Distinct from `kind` precisely when a discriminator is shared by more
 *   than one keyword; a lowering factory that contributes several keywords
 *   under one discriminator reads `keyword` to tell its blocks apart, and
 *   the printer re-emits each block under its own `keyword` regardless of
 *   how many other keywords share its `kind`.
 * - `name` is the block's declared name (the identifier after the keyword).
 * - `parameters` is the descriptor-driven parameter map. Keys are
 *   parameter names from the descriptor; values are the parsed parameter
 *   representations. Only parameters present in the source are included
 *   — absence of a required parameter is a validator concern, not a
 *   parser concern. Insertion order is preserved; the first occurrence of a
 *   duplicate key is retained and subsequent occurrences emit
 *   `PSL_EXTENSION_DUPLICATE_PARAMETER`.
 * - `blockAttributes` are `@@`-prefixed attribute lines inside the block, in
 *   declaration order. Captured generically — names and args are not validated
 *   by the parser.
 * - `span` covers the full block from keyword to closing brace.
 */
export interface PslExtensionBlock {
  readonly kind: string;
  /**
   * The block's parse identity — the source PSL keyword it was declared
   * with. `kind`/`discriminator` is its storage identity; several keywords
   * can share one. E.g. the five `policy_*` keywords all lower to the
   * `policy` entity kind.
   */
  readonly keyword: string;
  readonly name: string;
  readonly parameters: Record<string, PslExtensionBlockParamValue>;
  readonly blockAttributes: readonly PslExtensionBlockAttribute[];
  readonly attributes: Readonly<Record<string, PslExtensionBlockParsedAttribute>>;
  readonly span: PslSpan;
}
