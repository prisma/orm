import type { JsonValue } from '@internal/ts-render';
import { type } from 'arktype';
import { errorInitContributionUnavailable } from './errors';
import type { ContractEntry, ContractEntryInput, InitContribution } from './init-contribution';
import { defaultContractEntry } from './templates/code-templates';

const ContractEntrySchema = type({ value: 'unknown', '+': 'reject' }).or({
  call: {
    module: /\S/,
    export: /^[A-Za-z_$][\w$]*$/,
    args: 'unknown[]',
    '+': 'reject',
  },
  '+': 'reject',
});

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== 'object') {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every(isJsonValue)
  );
}

/** The package an init contribution came from, for the refusal of a malformed entry. */
export interface ContributionOwner {
  readonly packageName: string;
  readonly unlisted: boolean;
}

/**
 * The contribution's `contract:` entry for `input`, or the CLI's own when it gives none. The
 * contribution comes from another package, so what it returns is checked here.
 */
export function contractEntryFor(
  contribution: InitContribution,
  input: ContractEntryInput,
  owner: ContributionOwner,
): ContractEntry {
  if (contribution.contractEntry === undefined) {
    return defaultContractEntry(contribution.configModule, input);
  }
  const malformed = (detail: string) =>
    errorInitContributionUnavailable({
      packageName: owner.packageName,
      reason: 'invalid-shape',
      detail: `its contractEntry returned ${detail}`,
      unlisted: owner.unlisted,
      missingPeers: [],
      missingPeersCommand: undefined,
    });

  const returned: unknown = contribution.contractEntry(input);
  const entry = ContractEntrySchema(returned);
  if (entry instanceof type.errors) {
    throw malformed(`neither { value } nor { call: { module, export, args } } (${entry.summary})`);
  }
  if ('value' in entry) {
    const { value } = entry;
    if (!isJsonValue(value)) {
      throw malformed('a value that is not JSON');
    }
    return { value };
  }
  const { module, export: exported, args } = entry.call;
  if (!args.every(isJsonValue)) {
    throw malformed(`a call of ${exported} with an argument that is not JSON`);
  }
  return { call: { module, export: exported, args } };
}
