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
  readonly subjectInList: string;
  /** The labels of the operations of the plan that do what the headline says. */
  readonly operations: readonly string[];
  /** Facts the user needs beside the headline. */
  readonly notes: readonly string[];
  /** Ways to keep the data other than this question's own flags; a refusal's next actions start with them. */
  readonly keepDataWays: readonly string[];
  /** `keepDataWays` as a refusal with several questions open gives them, each naming its subject. */
  readonly keepDataWaysNamingSubject: readonly string[];
  readonly answers: readonly QuestionAnswer[];
  /** What else to give when the data goes; a refusal's next actions end with them. */
  readonly alsoGiveWhenDeleted: readonly string[];
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
 * what each verb means. `withNamespace` adds the removed namespace and the verbs that settle it, in
 * the places the refusal gives them: the fact after the headline, its verbs before the question's.
 */
export function questionText(parts: QuestionParts, withNamespace = false): string {
  const namespace = withNamespace ? parts.removedNamespaceParts : undefined;
  const meanings = [
    ...(namespace?.answers ?? []).map(({ promptMeaning }) => promptMeaning),
    ...parts.answers.map(({ promptMeaning }) => promptMeaning),
  ];
  return [
    parts.headline,
    ...(namespace === undefined ? [] : [namespace.fact]),
    ...operationLines(parts.operations),
    ...parts.notes,
    ...parts.keepDataWays,
    ...parts.alsoGiveWhenDeleted,
    `${meanings.join('; ')}.`,
  ].join('\n');
}

/** A flag that names a subject of the change with a verb its question does not take. */
export interface MisdirectedFlag {
  readonly verb: string;
  readonly text: string;
  /** The subject the flag names, as a list names it. */
  readonly subjectInList: string;
}

/** The flags a run was given that did nothing, and whether it ran with `--yes`. */
export interface FlagsThatDidNothing {
  /** Flags that name nothing in the change. */
  readonly unmatched: readonly { readonly verb: string; readonly values: readonly string[] }[];
  readonly misdirected: readonly MisdirectedFlag[];
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
  'deletes data': 'would delete data',
  'may change data': 'can change or lose data',
  'changes access': 'would change who can read and write data',
};

/** `a`, `a and b`, `a, b and c`. */
function joinedWithAnd(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function effectsOf(open: readonly QuestionParts[]): readonly ChangeEffect[] {
  return EFFECT_ORDER.filter((each) => open.some((question) => question.effect === each));
}

function yesLine(open: readonly QuestionParts[]): string {
  const done = effectsOf(open).map((effect) => WHAT_YES_WOULD_DO[effect]);
  return `--yes does not allow this: it ${joinedWithAnd(done)}.`;
}

function misdirectedLine({ verb, text, subjectInList }: MisdirectedFlag): string {
  const flag = `--${verb} ${shellQuoted(text)}`;
  switch (verb) {
    case 'allow':
      return `Remove ${flag}: this change does not change access to ${subjectInList}.`;
    case 'delete':
      return `Remove ${flag}: this change does not delete the data of ${subjectInList}.`;
    default:
      return `Remove ${flag}: ${subjectInList} does not take --${verb}.`;
  }
}

function removeFlagLines(flags: FlagsThatDidNothing): readonly string[] {
  return [
    ...flags.unmatched.map(
      ({ verb, values }) =>
        `Remove --${verb} ${values.map(shellQuoted).join(' ')}: nothing in this change is called that.`,
    ),
    ...flags.misdirected.map(misdirectedLine),
    ...flags.confirm.map(
      (token) => `Remove --confirm ${shellQuoted(token)}: nothing in this change needs it.`,
    ),
  ];
}

/** What the open questions would do to the data, the strongest first; `undefined` when they only change access. */
function toTheData(effects: readonly ChangeEffect[]): string | undefined {
  if (effects.includes('deletes data')) return 'would lose data';
  return effects.includes('may change data') ? 'would change or lose data' : undefined;
}

function summaryOf(open: readonly QuestionParts[]): string {
  const [only] = open;
  if (only !== undefined && open.length === 1) return only.headline;
  const effects = effectsOf(open);
  const toData = toTheData(effects);
  const listed = [...new Set(open.map((question) => question.subjectInList))].join(', ');
  if (toData === undefined)
    return `This change would change who can read and write data: ${listed}.`;
  return effects.includes('changes access')
    ? `This change ${toData} and change access: ${listed}.`
    : `This change ${toData}: ${listed}.`;
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
 * The paragraphs of `why`, one per open question: its headline when several are open, the fact of
 * its removed namespace on the first question of that namespace, the operations and the notes.
 */
function questionParagraphs(open: readonly QuestionParts[]): readonly (readonly string[])[] {
  const shown = new Set<string>();
  return open.map((question) => {
    const namespace = question.removedNamespaceParts;
    const firstOfNamespace = namespace !== undefined && !shown.has(namespace.namespace);
    if (namespace !== undefined) shown.add(namespace.namespace);
    return [
      ...(open.length === 1 ? [] : [question.headline]),
      ...(firstOfNamespace ? [namespace.fact] : []),
      ...operationLines(question.operations),
      ...question.notes,
    ];
  });
}

/**
 * The refusal when nobody can give the flags the open questions need: what the change would do,
 * the operations that do it, and each flag with what it means, after the lines that remove the
 * flags that did nothing. A removed namespace is said once, beside the first question about it,
 * and its flags come before the questions' own. One question gives its headline as the summary;
 * several are listed by what they would do, each opens its own paragraph of `why`, and each way to
 * keep the data and each flag names its subject.
 */
export function refusalText(
  open: readonly QuestionParts[],
  flags: FlagsThatDidNothing,
): RefusalText {
  const several = open.length > 1;
  const paragraphs = [...questionParagraphs(open), ...(flags.yes ? [[yesLine(open)]] : [])];
  const meaning = (answer: QuestionAnswer) =>
    several ? answer.meaningNamingSubject : answer.meaning;
  return {
    summary: summaryOf(open),
    why:
      paragraphs.length === 0
        ? undefined
        : paragraphs.map((lines) => lines.join('\n')).join('\n\n'),
    nextActions: [
      ...removeFlagLines(flags),
      ...new Set(
        open.flatMap((question) =>
          several ? question.keepDataWaysNamingSubject : question.keepDataWays,
        ),
      ),
      ...answerLines(
        removedNamespaces(open).flatMap(({ answers }) => answers),
        ({ meaning: each }) => each,
      ),
      ...answerLines(
        open.flatMap(({ answers }) => answers),
        meaning,
      ),
      ...new Set(open.flatMap(({ alsoGiveWhenDeleted }) => alsoGiveWhenDeleted)),
    ],
  };
}
