/**
 * `text` without the run of `character` it ends with, found by walking back from the end, so the cost is the length of that run. A regular expression such as `/ +$/` retries at every position of an earlier run and costs time quadratic in its length.
 */
export function withoutTrailing(text: string, character: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === character) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

/** `1 character`, `3 characters`: a count and its noun, as a refusal names what a value must hold. */
export function counted(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const utf8 = new TextEncoder();

/** The length of `text` in UTF-8 bytes, the unit databases measure identifiers in. */
export function utf8ByteLength(text: string): number {
  return utf8.encode(text).length;
}

/** The longest start of `text` that fits `maxBytes` UTF-8 bytes, cut on a character boundary so a multibyte character is never split. */
export function clipToUtf8Bytes(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  let kept = '';
  let bytes = 0;
  for (const character of text) {
    const size = utf8ByteLength(character);
    if (bytes + size > maxBytes) break;
    kept += character;
    bytes += size;
  }
  return kept;
}
