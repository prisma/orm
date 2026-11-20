import { shellQuoted, statementFlag } from './statement-flag';
import type { StatementText } from './statement-text';

/** A flag that settles a question, with what it means. */
export interface QuestionAnswer {
  readonly flag: StatementText;
  /** What the flag means when its question is the only one open. */
  readonly meaning: string;
  /** What the flag means beside other open questions, naming its subject. */
  readonly meaningNamingSubject: string;
  /** What the verb means, as the prompt says it. */
  readonly promptMeaning: string;
}

/** What a change does to the data of its subject. */
export type ChangeEffect = 'deletes data' | 'may change data' | 'changes access';

/** A namespace the contract no longer has: the fact, and the flags that settle every question about its models at once. */
export interface RemovedNamespaceParts {
  readonly namespace: string;
  readonly fact: string;
  readonly answers: readonly QuestionAnswer[];
}

/** The parts the prompt and the refusal are both built from. */
export interface QuestionParts {
  /** What the change would do, in the words of the user's contract. */
  readonly headline: string;
  /** The subject as a list of several open questions names it: `model "Bug"`, or `"User"`. */
  readonly named: string;
  /** The labels of the operations of the plan that do what the headline says. */
  readonly operations: readonly string[];
  /** Facts the user needs beside the headline. */
  readonly notes: readonly string[];
  /** Ways to keep the data that take more than one flag; a refusal's next actions start with them. */
  readonly keepDataWays: readonly string[];
  readonly answers: readonly QuestionAnswer[];
  /** What else to give when the data goes; a refusal's next actions end with them. */
  readonly whenDeleted: readonly string[];
  readonly effect: ChangeEffect;
  /** The namespace of the subject's model when the contract no longer has it. */
  readonly removedNamespaceParts?: RemovedNamespaceParts;
}

function operationLines(operations: readonly string[]): readonly string[] {
  const unique = [...new Set(operations)];
  return unique.length === 1
    ? [`The operation of the plan that does this: ${unique[0]}.`]
    : ['The operations of the plan that do this:', ...unique.map((label) => `- ${label}`)];
}

/**
 * The text the prompt shows: what the change would do, the operations that do it, the notes, and
 * what each verb means. `withNamespace` adds the removed namespace and the verbs that settle it.
 */
export function questionText(parts: QuestionParts, withNamespace = false): string {
  const namespace = withNamespace ? parts.removedNamespaceParts : undefined;
  const meanings = [
    ...parts.answers.map(({ promptMeaning }) => promptMeaning),
    ...(namespace?.answers ?? []).map(({ promptMeaning }) => promptMeaning),
  ];
  return [
    parts.headline,
    ...operationLines(parts.operations),
    ...parts.notes,
    ...(namespace === undefined ? [] : [namespace.fact]),
    ...parts.keepDataWays,
    ...parts.whenDeleted,
    `${meanings.join('; ')}.`,
  ].join('\n');
}

/** The flags a run was given that did nothing, and whether it ran with `--yes`. */
export interface FlagsThatDidNothing {
  /** Flags that name nothing in the change. */
  readonly unmatched: readonly { readonly verb: string; readonly values: readonly string[] }[];
  readonly confirm: readonly string[];
  readonly yes: boolean;
}

export interface RefusalText {
  readonly summary: string;
  readonly why: string | undefined;
  readonly nextActions: readonly string[];
}

const EFFECT_ORDER: readonly ChangeEffect[] = ['deletes data', 'may change data', 'changes access'];

const WHAT_YES_WOULD_DO: Readonly<Record<ChangeEffect, string>> = {
  'deletes data': 'it would delete data',
  'may change data': 'it can change or lose data',
  'changes access': 'it would change who can read and write data',
};

function yesLine(open: readonly QuestionParts[]): string {
  const effect =
    EFFECT_ORDER.find((each) => open.some((question) => question.effect === each)) ??
    'deletes data';
  return `--yes does not allow this: ${WHAT_YES_WOULD_DO[effect]}.`;
}

function removeFlagLines(flags: FlagsThatDidNothing): readonly string[] {
  return [
    ...flags.unmatched.map(
      ({ verb, values }) =>
        `Remove --${verb} ${values.map(shellQuoted).join(' ')}: nothing in this change is called that.`,
    ),
    ...flags.confirm.map(
      (token) => `Remove --confirm ${shellQuoted(token)}: nothing in this change needs it.`,
    ),
  ];
}

function summaryOf(open: readonly QuestionParts[]): string {
  const [only] = open;
  if (only !== undefined && open.length === 1) return only.headline;
  const losesData = open.some(({ effect }) => effect !== 'changes access');
  const changesAccess = open.some(({ effect }) => effect === 'changes access');
  const named = [...new Set(open.map((question) => question.named))].join(', ');
  if (losesData && changesAccess) return `This change would lose data and change access: ${named}.`;
  return losesData
    ? `This change would lose data: ${named}.`
    : `This change would change who can read and write data: ${named}.`;
}

function answerLines(
  answers: readonly QuestionAnswer[],
  meaning: (answer: QuestionAnswer) => string,
): readonly string[] {
  const byFlag = new Map(answers.map((answer) => [statementFlag(answer.flag), answer]));
  return [...byFlag].map(([flag, answer]) => `${meaning(answer)}: ${flag}`);
}

function removedNamespaces(open: readonly QuestionParts[]): readonly RemovedNamespaceParts[] {
  return [
    ...new Map(
      open.flatMap(({ removedNamespaceParts }) =>
        removedNamespaceParts === undefined
          ? []
          : [[removedNamespaceParts.namespace, removedNamespaceParts] as const],
      ),
    ).values(),
  ];
}

/**
 * The refusal when nobody can give the flags the open questions need: what the change would do,
 * the operations that do it, and each flag with what it means, after the lines that remove the
 * flags that did nothing. A removed namespace comes first, once, with the flags that settle all of
 * it. One question gives its headline as the summary; several are listed by what they would do,
 * and each opens its own paragraph of `why`.
 */
export function refusalText(
  open: readonly QuestionParts[],
  flags: FlagsThatDidNothing,
): RefusalText {
  const namespaces = removedNamespaces(open);
  const paragraphs = [
    ...namespaces.map(({ fact }) => [fact]),
    ...open.map((question) => [
      ...(open.length === 1 ? [] : [question.headline]),
      ...operationLines(question.operations),
      ...question.notes,
    ]),
    ...(flags.yes ? [[yesLine(open)]] : []),
  ];
  const meaning = (answer: QuestionAnswer) =>
    open.length === 1 ? answer.meaning : answer.meaningNamingSubject;
  return {
    summary: summaryOf(open),
    why:
      paragraphs.length === 0
        ? undefined
        : paragraphs.map((lines) => lines.join('\n')).join('\n\n'),
    nextActions: [
      ...removeFlagLines(flags),
      ...new Set(open.flatMap(({ keepDataWays }) => keepDataWays)),
      ...answerLines(
        namespaces.flatMap(({ answers }) => answers),
        ({ meaning: each }) => each,
      ),
      ...answerLines(
        open.flatMap(({ answers }) => answers),
        meaning,
      ),
      ...new Set(open.flatMap(({ whenDeleted }) => whenDeleted)),
    ],
  };
}
