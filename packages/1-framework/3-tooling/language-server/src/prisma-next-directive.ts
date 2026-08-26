const PRISMA_NEXT_DIRECTIVE = /^\s*\/\/ *use +prisma-next *(?!\S)/;

export function isPrismaNextSchema(text: string): boolean {
  return PRISMA_NEXT_DIRECTIVE.test(text);
}
