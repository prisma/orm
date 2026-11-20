import { shellQuoted, statementFlag } from './statement-flag';

/** The command a careful reader runs after changing the contract source, as advice writes it. */
export const EMIT_COMMAND = '`{bin} contract emit`';

/**
 * How a run again reaches the emitted contract, with `flag` or without `leftOut` when given: as it
 * was, or without the `--to` that named a stored one, whose contract emitting does not change.
 */
export function runAgain(
  destinationRef: string | undefined,
  flag?: string,
  leftOut?: string,
): string {
  const changes = [
    ...(flag === undefined ? [] : [`with ${flag}`]),
    ...(leftOut === undefined ? [] : [`without ${leftOut}`]),
  ];
  if (destinationRef === undefined) {
    return ['run this command again', ...changes].join(' ');
  }
  const to = `--to ${shellQuoted(destinationRef)}`;
  return `run this command again ${[...changes, `without ${to}`].join(' and ')}, so that it plans to the emitted contract and not to the one that ${to} names`;
}

/**
 * The base of a variant a rename names: one the change keeps, as a `--rename` writes it, which the
 * new name must be a variant of too; or one the change removes, whose rows the variant's rows are.
 */
export type VariantBase =
  | { readonly kind: 'kept'; readonly base: string }
  | { readonly kind: 'removed'; readonly base: string };

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
  /** The base model when `from` is a variant. */
  readonly variantOf: VariantBase | undefined;
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
export function asVariantOf(variantOf: VariantBase | undefined): string {
  return variantOf?.kind === 'kept' ? ` as a variant of model "${variantOf.base}"` : '';
}

/** Why a variant whose base the change removes has no new name to take: its rows are the base's. */
export function renamedOnlyWithBase(model: string, base: string): string {
  return `Model "${model}" cannot be renamed on its own: it is a variant of model "${base}", which this change removes too, and its rows are rows of model "${base}", so they are kept or deleted with them.`;
}

function leaveOutRename(from: string, variantOf: VariantBase | undefined): string | undefined {
  return variantOf?.kind === 'removed'
    ? `${renamedOnlyWithBase(from, variantOf.base)} Leave out this rename.`
    : undefined;
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
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
  const leaveOut = leaveOutRename(from, variantOf);
  if (leaveOut !== undefined) return leaveOut;
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
  const candidates = candidatesFact(rename);
  return [
    lowerFirst(missingNameFact(rename)),
    ...(candidates === undefined ? [] : [candidates]),
    leaveOutRename(rename.from, rename.variantOf) ??
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
  const { entity, from, to, destinationRef, variantOf } = rename;
  const leaveOut = leaveOutRename(from, variantOf);
  if (leaveOut !== undefined) return leaveOut;
  const flag = statementFlag({ verb: 'rename', text: `${from}:${to}` });
  return `If "${from}" is to take the name "${to}" from the ${entity} that has it now, ${atPrompt ? 'stop this command and ' : ''}do it in two steps. First, in the contract, give ${entity} "${to}" its new name or remove it, and keep "${from}" as it was; run ${EMIT_COMMAND}, and ${runAgain(destinationRef, undefined, atPrompt ? undefined : flag)}. Then rename "${from}" to "${to}" in the contract, run ${EMIT_COMMAND}, and ${runAgain(destinationRef, flag)}.`;
}

/**
 * Why a rename typed at the prompt to a name the contract already had does not fit, in one text:
 * the fact, the names it can be, and the two steps that give it that name.
 */
export function nameHadBeforeReason(rename: RenameToMissingName): string {
  const candidates = candidatesFact(rename);
  return [
    lowerFirst(nameHadBeforeFact(rename)),
    ...(candidates === undefined ? [] : [candidates]),
    renameInTwoSteps(rename, true),
  ].join(' ');
}
