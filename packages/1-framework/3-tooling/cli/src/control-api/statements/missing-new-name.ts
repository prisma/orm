import { shellQuoted, statementFlag } from './statement-flag';

/** The command a careful reader runs after changing the contract source, as advice writes it. */
export const EMIT_COMMAND = '`{bin} contract emit`';

/**
 * How a run again reaches the emitted contract, with `flag` when given: as it was, or without the
 * `--to` that named a stored one, whose contract emitting does not change.
 */
export function runAgain(destinationRef: string | undefined, flag?: string): string {
  if (destinationRef === undefined) {
    return flag === undefined ? 'run this command again' : `run this command again with ${flag}`;
  }
  const to = `--to ${shellQuoted(destinationRef)}`;
  const withFlag = flag === undefined ? '' : `with ${flag} and `;
  return `run this command again ${withFlag}without ${to}, so that it plans to the emitted contract and not to the one that ${to} names`;
}

/**
 * A rename whose new name the contract does not have, or had before the change too. `entity` is
 * the kind of thing as the CLI names it, such as `field`; names are written as a `--rename` writes
 * them.
 */
export interface RenameToMissingName {
  readonly entity: string;
  readonly from: string;
  readonly to: string;
  /** The names the contract adds that `from` can have been renamed to instead. */
  readonly candidates: readonly string[];
  /** The `--to` value the command planned to, when its contract is a stored one and not the emitted one. */
  readonly destinationRef: string | undefined;
  /** The base model, as a `--rename` writes it, when `from` is a variant: its new name must be a variant of that base too. */
  readonly variantOf: string | undefined;
}

function quotedList(items: readonly string[]): string {
  const quoted = items.map((item) => `"${item}"`);
  return quoted.length < 2
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

function theContract(destinationRef: string | undefined): string {
  return destinationRef === undefined
    ? 'The contract'
    : `The contract that --to ${shellQuoted(destinationRef)} names`;
}

export function missingNameFact({ entity, from, to, destinationRef }: RenameToMissingName): string {
  return `${theContract(destinationRef)} has no ${entity} "${to}" to rename "${from}" to.`;
}

/** ` as a variant of model "Task"` for a variant's new name, which must be a variant of the same base; empty otherwise. */
export function asVariantOf(variantOf: string | undefined): string {
  return variantOf === undefined ? '' : ` as a variant of model "${variantOf}"`;
}

/** The names the contract adds that the subject can have been renamed to; `undefined` when it adds none. */
export function candidatesFact({
  entity,
  candidates,
  destinationRef,
}: RenameToMissingName): string | undefined {
  const contract = destinationRef === undefined ? 'The contract' : 'That contract';
  return candidates.length === 0
    ? undefined
    : `${contract} adds ${entity}${candidates.length === 1 ? '' : 's'} ${quotedList(candidates)}.`;
}

export function addAndEmit({
  entity,
  from,
  to,
  destinationRef,
  variantOf,
}: RenameToMissingName): string {
  return `If ${entity} "${from}" was renamed to "${to}", add ${entity} "${to}" to the contract${asVariantOf(variantOf)}, run ${EMIT_COMMAND}, and ${runAgain(destinationRef)}.`;
}

/** The `--rename` to each name the contract adds, with what it means, in place of the one given. */
export function candidateRenames({
  entity,
  from,
  to,
  candidates,
}: RenameToMissingName): readonly string[] {
  const given = statementFlag({ verb: 'rename', text: `${from}:${to}` });
  return candidates.map(
    (candidate) =>
      `If ${entity} "${from}" was renamed to "${candidate}", use ${statementFlag({ verb: 'rename', text: `${from}:${candidate}` })} in place of ${given}`,
  );
}

/**
 * Why a rename typed at the prompt does not fit, in one text: the missing name, the names it can
 * be, and how to add it, which the prompt cannot take, so it says to stop the command first.
 */
export function missingNameReason(rename: RenameToMissingName): string {
  const fact = missingNameFact(rename);
  const candidates = candidatesFact(rename);
  return [
    `${fact.charAt(0).toLowerCase()}${fact.slice(1)}`,
    ...(candidates === undefined ? [] : [candidates]),
    `If ${rename.entity} "${rename.from}" was renamed to "${rename.to}", stop this command, add ${rename.entity} "${rename.to}" to the contract${asVariantOf(rename.variantOf)}, run ${EMIT_COMMAND}, and ${runAgain(rename.destinationRef)}.`,
  ].join(' ');
}

/** That the contract had the new name before this change too, so one change cannot give it to the old name. */
export function nameHadBeforeFact({
  entity,
  from,
  to,
  destinationRef,
}: RenameToMissingName): string {
  return `${theContract(destinationRef)} had ${entity} "${to}" before this change too, so one change cannot make it the new name of "${from}".`;
}

/**
 * How to give the old name the new name that another thing of the contract holds: free the name
 * in one run, then rename in the next. At the prompt, which cannot take it, it says to stop first.
 */
export function renameInTwoSteps(rename: RenameToMissingName, atPrompt = false): string {
  const { entity, from, to, destinationRef } = rename;
  const flag = statementFlag({ verb: 'rename', text: `${from}:${to}` });
  return `If "${from}" is to take the name "${to}" from the ${entity} that has it now, ${atPrompt ? 'stop this command and ' : ''}do it in two steps. First, in the contract, give ${entity} "${to}" its new name or remove it, and keep "${from}" as it was; run ${EMIT_COMMAND}, and ${runAgain(destinationRef)}. Then rename "${from}" to "${to}" in the contract, run ${EMIT_COMMAND}, and ${runAgain(destinationRef, flag)}.`;
}

/**
 * Why a rename typed at the prompt to a name the contract already had does not fit, in one text:
 * the fact, the names it can be, and the two steps that give it that name.
 */
export function nameHadBeforeReason(rename: RenameToMissingName): string {
  const fact = nameHadBeforeFact(rename);
  const candidates = candidatesFact(rename);
  return [
    `${fact.charAt(0).toLowerCase()}${fact.slice(1)}`,
    ...(candidates === undefined ? [] : [candidates]),
    renameInTwoSteps(rename, true),
  ].join(' ');
}
