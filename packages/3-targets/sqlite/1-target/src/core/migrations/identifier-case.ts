function foldAsciiLetters(identifier: string): string {
  return identifier.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * Whether SQLite takes two identifiers for the same name. It compares table and index names without regard to the case of ASCII letters, and compares every other character exactly.
 */
export function sqliteIdentifiersCollide(left: string, right: string): boolean {
  return foldAsciiLetters(left) === foldAsciiLetters(right);
}
