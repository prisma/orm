/** The binary every next action and example names; `{bin}` in a command string stands for it. */
export const BIN_NAME = 'prisma';

/** Replaces the `{bin}` placeholder the CLI's messages carry with the binary name. */
export function resolveBin(text: string): string {
  return text.replaceAll('{bin}', BIN_NAME);
}
