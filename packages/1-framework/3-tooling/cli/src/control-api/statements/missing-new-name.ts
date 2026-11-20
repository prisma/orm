import { statementFlag } from './statement-flag';

/** The command a careful reader runs after changing the contract source, as advice writes it. */
export const EMIT_COMMAND = '`{bin} contract emit`';

/**
 * A rename whose new name the contract does not have. `entity` is the kind of thing as the CLI
 * names it, such as `field`; names are written as a `--rename` writes them.
 */
export interface RenameToMissingName {
  readonly entity: string;
  readonly from: string;
  readonly to: string;
  /** The names the contract adds that `from` can have been renamed to instead. */
  readonly candidates: readonly string[];
}

function quotedList(items: readonly string[]): string {
  const quoted = items.map((item) => `"${item}"`);
  return quoted.length < 2
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

export function missingNameFact({ entity, from, to }: RenameToMissingName): string {
  return `The contract has no ${entity} "${to}" to rename "${from}" to.`;
}

/** The names the contract adds that the subject can have been renamed to; `undefined` when it adds none. */
export function candidatesFact({ entity, candidates }: RenameToMissingName): string | undefined {
  return candidates.length === 0
    ? undefined
    : `The contract adds ${entity}${candidates.length === 1 ? '' : 's'} ${quotedList(candidates)}.`;
}

export function addAndEmit({ entity, from, to }: RenameToMissingName): string {
  return `If ${entity} "${from}" was renamed to "${to}", add ${entity} "${to}" to the contract, run ${EMIT_COMMAND}, and run this command again.`;
}

/** The `--rename` to each name the contract adds, with what it means. */
export function candidateRenames({
  entity,
  from,
  candidates,
}: RenameToMissingName): readonly string[] {
  return candidates.map(
    (candidate) =>
      `If ${entity} "${from}" was renamed to "${candidate}": ${statementFlag({ verb: 'rename', text: `${from}:${candidate}` })}`,
  );
}

/** Why a rename typed at the prompt does not fit, in one text: the missing name, the names it can be, and how to add it. */
export function missingNameReason(rename: RenameToMissingName): string {
  const fact = missingNameFact(rename);
  const candidates = candidatesFact(rename);
  return [
    `${fact.charAt(0).toLowerCase()}${fact.slice(1)}`,
    ...(candidates === undefined ? [] : [candidates]),
    addAndEmit(rename),
  ].join(' ');
}

/** Why a rename to a name the contract already had does not fit. */
export function nameHadBeforeReason(entity: string, from: string, to: string): string {
  return `the contract had ${entity} "${to}" before this change too, so it is not the new name of "${from}".`;
}
