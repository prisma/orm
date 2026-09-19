const DIRECTIVE = /^(\s*\/\/ *use +)(prisma-8|prisma-next)( *)(?!\S)/;
const LEGACY_NAME = 'prisma-next';

export function isPrismaNextSchema(text: string): boolean {
  return DIRECTIVE.test(text);
}

/** The document with the directive earlier releases wrote replaced by the current one. */
export function renameLegacyDirective(text: string): string {
  return text.replace(DIRECTIVE, (whole, lead: string, name: string, trail: string) =>
    name === LEGACY_NAME ? `${lead}prisma-8${trail}` : whole,
  );
}
