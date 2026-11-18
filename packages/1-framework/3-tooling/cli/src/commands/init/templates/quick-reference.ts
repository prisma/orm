import type { ServerRequirement } from '../init-contribution';

/**
 * The FR8.2 "Requirements" section of `prisma-8.md`: the minimum server the target package
 * states, and how to check it. Empty when the package states none.
 */
export function requirementsBlock(
  label: string,
  requirement: ServerRequirement | undefined,
  pkgRun: string,
): string {
  if (requirement === undefined) {
    return '';
  }
  return [
    '## Requirements',
    '',
    `- **${label} ${requirement.minVersion} or newer.** Older servers are not supported. Run \`${requirement.checkCommand}\` against your server to verify.`,
    `- The CLI never connects to your database without explicit consent. Pass \`--probe-db\` to \`${pkgRun} orm init\` if you want \`init\` to verify the server version itself.`,
  ].join('\n');
}
