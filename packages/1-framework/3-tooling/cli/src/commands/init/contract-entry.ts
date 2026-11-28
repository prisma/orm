import { errorInitContributionUnavailable } from './errors';
import type { ContractEntryInput, ContractEntryNode, InitContribution } from './init-contribution';
import { configFile, defaultContractEntry } from './templates/code-templates';

/** The package an init contribution came from, for the refusal of a malformed entry. */
export interface ContributionOwner {
  readonly packageName: string;
  readonly unlisted: boolean;
}

const NODE_METHODS = ['renderTypeScript', 'importRequirements', 'contractValue'] as const;

function isContractEntryNode(value: unknown): value is ContractEntryNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    NODE_METHODS.every((method) => typeof Reflect.get(value, method) === 'function')
  );
}

/**
 * What the contribution's `contractEntry` returns for `input`. The contribution comes from another package, which may depend on another copy of the framework, so the node is recognised by its methods.
 */
export function contributedContractEntry(
  contractEntry: NonNullable<InitContribution['contractEntry']>,
  input: ContractEntryInput,
  owner: ContributionOwner,
): ContractEntryNode {
  const returned: unknown = contractEntry(input);
  if (!isContractEntryNode(returned)) {
    throw errorInitContributionUnavailable({
      packageName: owner.packageName,
      reason: 'invalid-shape',
      detail: `its contractEntry returned no contract entry node with the methods ${NODE_METHODS.join(', ')}`,
      unlisted: owner.unlisted,
      missingPeers: [],
      missingPeersCommand: undefined,
    });
  }
  return returned;
}

/** The contribution's `contract:` entry for `input`, or the CLI's own when it gives none. */
export function contractEntryFor(
  contribution: InitContribution,
  input: ContractEntryInput,
  owner: ContributionOwner,
): ContractEntryNode {
  return contribution.contractEntry === undefined
    ? defaultContractEntry(contribution.configModule, input)
    : contributedContractEntry(contribution.contractEntry, input, owner);
}

/** `prisma.config.ts` as `init` writes it: the contribution's contract entry for `input`. */
export function initConfigFile(options: {
  readonly contribution: InitContribution;
  readonly input: ContractEntryInput;
  readonly owner: ContributionOwner;
  /** The directory the contract is emitted into; `undefined` leaves it to the target package. */
  readonly output: string | undefined;
}): string {
  return configFile({
    configModule: options.contribution.configModule,
    contract: contractEntryFor(options.contribution, options.input, options.owner),
    output: options.output,
  });
}
