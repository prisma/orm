/**
 * Removes the contract's planner hints. Hints describe how to reach the emitted contract from an
 * earlier one, so no stored copy of a contract carries them.
 */
export function stripContractHints(contractJson: unknown): unknown {
  if (typeof contractJson !== 'object' || contractJson === null || !('hints' in contractJson)) {
    return contractJson;
  }
  const { hints: _hints, ...rest } = contractJson;
  return rest;
}
