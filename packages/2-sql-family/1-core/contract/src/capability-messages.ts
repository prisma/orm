/** Capability keys as a message lists them: each in backticks, joined with commas and a final "and". */
export function capabilityKeysText(capabilities: readonly string[]): string {
  const keys = capabilities.map((capability) => `\`${capability}\``);
  return keys.length <= 1 ? keys.join('') : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`;
}

/**
 * The refusal of `feature` when the contract does not require `capabilities`: what is unavailable, `reason` when the feature explains why it needs them, and how to enable it.
 */
export function capabilityUnavailableMessage(
  feature: string,
  capabilities: readonly string[],
  reason?: string,
): string {
  const keys = capabilityKeysText(capabilities);
  return [
    `${feature} is unavailable: your contract declares no dependency on ${keys}.`,
    ...(reason === undefined ? [] : [reason]),
    `To enable it, add ${keys} to your contract's required capabilities.`,
  ].join(' ');
}
