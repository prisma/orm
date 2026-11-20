/** The string entries of a `package.json`'s `keywords`; none when it has no list there. */
export function keywordsOf(manifest: unknown): readonly string[] {
  const keywords: unknown =
    typeof manifest === 'object' && manifest !== null
      ? Reflect.get(manifest, 'keywords')
      : undefined;
  return Array.isArray(keywords)
    ? keywords.filter((keyword): keyword is string => typeof keyword === 'string')
    : [];
}
