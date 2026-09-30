/**
 * `text` without the run of `character` it ends with, found by walking back from the end, so the cost is the length of that run. A regular expression such as `/ +$/` retries at every position of an earlier run and costs time quadratic in its length.
 */
export function withoutTrailing(text: string, character: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === character) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}
