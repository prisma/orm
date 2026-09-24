/**
 * Shape-only types for the PSL source-position primitives, diagnostic
 * codes, the extension-block source/print representation, and the typed
 * extension-block envelope.
 *
 * These live in the shared plane so an extension's authoring descriptor
 * (`AuthoringPslBlockDescriptor` in `framework-authoring`) can reference
 * them without crossing the shared → migration-plane boundary. The
 * migration-plane `psl-ast.ts` re-exports everything here for consumers
 * that import PSL AST types from the control entrypoint.
 */

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
   * A string literal with no closing quote — the tokenizer stops a `"` or `'`
   * literal at a newline or at EOF, and a backtick literal before the next line
   * that opens with `}` or at EOF. The recursive-descent parser still consumes
   * the token (preserving the lossless round-trip) but reports this code
   * anchored on the string token's span.
   */
  | 'PSL_UNTERMINATED_STRING'
  /** A backtick string that is not the string literal of a tagged literal; anchored on the string. */
  | 'PSL_BACKTICK_STRING_REQUIRES_TAG'
  /** A `@default` tagged literal whose tag no pack in the stack registered. */
  | 'PSL_UNKNOWN_DEFAULT_LITERAL_TAG'
  /** A tagged literal body contains a NUL character. */
  | 'PSL_TAGGED_LITERAL_NUL'
  /** A tagged literal body is larger than 65536 UTF-8 bytes. */
  | 'PSL_TAGGED_LITERAL_TOO_LARGE'
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
   * A parameter value was rejected by its interpreting consumer — e.g. an
   * enum member value the selected codec's `decodeJson` refused, or an
   * unregistered codec id.
   */
  | 'PSL_EXTENSION_INVALID_VALUE'
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
 * One entry of the producer-only print shape of an extension block: the
 * entry's expression text and its span. A missing `expression` is a bare
 * line — a key with no `= value`.
 *
 * The text is born from a producer's own values (e.g. database inference),
 * never from parsed source — parsed AST is not stringified into this shape.
 * No validator, classifier, or lowering may read it; validated values travel
 * through {@link ParsedPslExtensionBlock} instead.
 */
export interface PslExtensionBlockSourceEntry {
  readonly expression?: string;
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
 * Producer-only print-document shape of an extension-contributed top-level
 * PSL block. It exists for producers that hold no AST — inference and other
 * generators whose text is born from introspected or computed values — and
 * the printer is its only consumer. Parsed source is never converted into
 * this shape, and validated values never travel here.
 *
 * - `kind` is the routing discriminant, equal to the descriptor's
 *   `discriminator`. Several keywords may share one discriminator (e.g.
 *   `policy_select`/`policy_insert` both route to `kind: 'policy'`) —
 *   `kind` identifies the entity/storage kind, not the source syntax.
 * - `keyword` is the source PSL keyword the block was declared with
 *   (`policy_select`, `policy_insert`, …) — the parse-dispatch identity.
 * - `name` is the block's declared name (the identifier after the keyword).
 * - `parameters` maps entry keys to their print entries in the producer's
 *   order. Each entry carries expression text and span for printing only; a
 *   missing `expression` renders as a bare line.
 * - `blockAttributes` are `@@`-prefixed attribute lines inside the block, in
 *   the producer's order.
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
  readonly parameters: Record<string, PslExtensionBlockSourceEntry>;
  readonly blockAttributes: readonly PslExtensionBlockAttribute[];
  readonly span: PslSpan;
}

/**
 * The parser-independent typed envelope of one successfully interpreted
 * extension block. `Values` is the output the block's spec inferred — it can
 * carry parser-owned reference results without this shared type depending on
 * them. `parameterSpans` maps each present entry key to its entry span so
 * consumers can anchor diagnostics without reparsing; `attributes` are the
 * block's interpreted `@@` attributes. Identity fields (`kind`, `keyword`,
 * `name`, `span`) mirror {@link PslExtensionBlock}.
 */
export interface ParsedPslExtensionBlock<Values = Readonly<Record<string, unknown>>> {
  readonly kind: string;
  readonly keyword: string;
  readonly name: string;
  readonly values: Values;
  readonly parameterSpans: Readonly<Record<string, PslSpan>>;
  readonly attributes: Readonly<Record<string, PslExtensionBlockParsedAttribute>>;
  readonly span: PslSpan;
}
