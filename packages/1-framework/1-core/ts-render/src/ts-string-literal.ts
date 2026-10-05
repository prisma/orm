/**
 * Renders a string as a TypeScript source-text literal.
 *
 * `JSON.stringify` already escapes quotes, backslashes, and control characters
 * exactly as TypeScript needs; it leaves U+2028/U+2029 unescaped, which legacy
 * parsers treat as line terminators, and DEL (U+007F), which is invisible, so
 * those are escaped explicitly.
 *
 * Used for both value literals (`jsonToTsSource`) and type-level literals /
 * property keys (the contract emitter), so a physical name that a store admits
 * as a quoted identifier but TypeScript does not admit bare renders the same
 * way everywhere.
 */
export function tsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/\u007f/g, '\\x7f');
}

/**
 * TypeScript source for a string: an untagged template literal when the text holds both quote kinds, so neither quote
 * is escaped; otherwise `tsStringLiteral(text)`. Text holding a control character (below U+0020, or U+007F), U+2028,
 * U+2029 or a lone surrogate is always `tsStringLiteral(text)`.
 */
export function tsQuotedTextSource(text: string): string {
  const holdsBothQuoteKinds = text.includes("'") && text.includes('"');
  if (!holdsBothQuoteKinds || needsEscapeSequence(text)) return tsStringLiteral(text);
  const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `\`${escaped}\``;
}

function needsEscapeSequence(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || code === 0x7f;
    const isLineOrParagraphSeparator = code === 0x2028 || code === 0x2029;
    const isLoneSurrogate = code >= 0xd800 && code <= 0xdfff;
    if (isControl || isLineOrParagraphSeparator || isLoneSurrogate) return true;
  }
  return false;
}
