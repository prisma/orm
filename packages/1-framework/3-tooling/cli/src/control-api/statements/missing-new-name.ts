import { shellQuoted, statementFlag } from './statement-flag';

/** The command a careful reader runs after changing the contract source, as advice writes it. */
export const EMIT_COMMAND = '`{bin} contract emit`';

/**
 * How a run again reaches the emitted contract: as it was, or without the `--to` that named a
 * stored one, whose contract emitting does not change.
 */
export function runAgain(destinationRef: string | undefined): string {
  return destinationRef === undefined
    ? 'run this command again'
    : `run this command again without --to ${shellQuoted(destinationRef)}`;
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
}

function quotedList(items: readonly string[]): string {
  const quoted = items.map((item) => `"${item}"`);
  return quoted.length < 2
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

export function missingNameFact({ entity, from, to, destinationRef }: RenameToMissingName): string {
  const contract =
    destinationRef === undefined
      ? 'The contract'
      : `The contract --to ${shellQuoted(destinationRef)} names`;
  return `${contract} has no ${entity} "${to}" to rename "${from}" to.`;
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

export function addAndEmit({ entity, from, to, destinationRef }: RenameToMissingName): string {
  return `If ${entity} "${from}" was renamed to "${to}", add ${entity} "${to}" to the contract, run ${EMIT_COMMAND}, and ${runAgain(destinationRef)}.`;
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
      `If ${entity} "${from}" was renamed to "${candidate}", put this in place of ${given}: ${statementFlag({ verb: 'rename', text: `${from}:${candidate}` })}`,
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
    `If ${rename.entity} "${rename.from}" was renamed to "${rename.to}", stop this command, add ${rename.entity} "${rename.to}" to the contract, run ${EMIT_COMMAND}, and ${runAgain(rename.destinationRef)}.`,
  ].join(' ');
}

/** Why a rename to a name the contract already had does not fit. */
export function nameHadBeforeReason(entity: string, from: string, to: string): string {
  return `the contract had ${entity} "${to}" before this change too, so one change cannot make it the new name of "${from}".`;
}

/** How to rename onto a name another thing of the contract held before the change: free the name in one migration, then rename. */
export function renameInTwoMigrations({ entity, from, to }: RenameToMissingName): string {
  return `If "${from}" takes the name of ${entity} "${to}", which this change renames or removes, make the change in two migrations: first change the contract so that "${to}" has its new name or is gone, and plan only that; then rename "${from}" to "${to}" with ${statementFlag({ verb: 'rename', text: `${from}:${to}` })}.`;
}
