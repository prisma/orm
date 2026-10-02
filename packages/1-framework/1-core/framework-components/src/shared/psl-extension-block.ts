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
  /** A tagged literal whose tag no pack in the stack registered. */
  | 'PSL_UNKNOWN_LITERAL_TAG'
  /** A written value has a data type the receiving position's type neither is nor casts from, or the target has no data type for its syntax. */
  | 'PSL_VALUE_TYPE_INCOMPATIBLE'
  /** A written value that its authoring entry's parse or a cast refused. */
  | 'PSL_INVALID_LITERAL'
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

export interface PslExtensionBlockPrintEntry {
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
  readonly argSpans?: Readonly<Record<string, PslSpan>>;
  readonly span: PslSpan;
}

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
  readonly parameters: Record<string, PslExtensionBlockPrintEntry>;
  readonly blockAttributes: readonly PslExtensionBlockAttribute[];
  readonly span: PslSpan;
}

export interface ParsedPslExtensionBlock<Values = Readonly<Record<string, unknown>>> {
  readonly kind: string;
  readonly keyword: string;
  readonly name: string;
  readonly values: Values;
  readonly parameterSpans: Readonly<Record<string, PslSpan>>;
  /** The source text of each entry whose value is a number literal, by key, so a reader can keep digits a JavaScript number loses. */
  readonly numberTexts?: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, PslExtensionBlockParsedAttribute>>;
  readonly span: PslSpan;
}
