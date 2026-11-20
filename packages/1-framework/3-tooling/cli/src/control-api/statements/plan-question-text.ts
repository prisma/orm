import { shellQuoted, statementFlag } from './statement-flag';
import type { StatementText } from './statement-text';

/**
 * A flag that settles a question, with what it means: `ifOnly` when it is the one question open,
 * `ifNamed` beside other questions, `typed` as the prompt says it, and `ifEach` for a flag several
 * open questions need once each.
 */
export interface QuestionAnswer {
  readonly flag: StatementText;
  readonly ifOnly: string;
  readonly ifNamed: string;
  readonly typed: string;
  readonly ifEach?: (count: number) => string;
}

/** What answering with `--yes` would agree to, which it never does. */
export type WhatYesWouldDo = 'delete data' | 'change or lose data' | 'change access';

/** The parts the prompt and the refusal are both built from. */
export interface QuestionParts {
  /** What the change would do, in the words of the user's contract. */
  readonly headline: string;
  /** The labels of the operations the plan would run. */
  readonly operations: readonly string[];
  readonly notes: readonly string[];
  /** The ways to keep the data, which a refusal leads its next actions with. */
  readonly keepDataWays?: readonly string[];
  readonly answers: readonly QuestionAnswer[];
  readonly yesWould: WhatYesWouldDo;
}

function planRunLines(operations: readonly string[]): readonly string[] {
  const unique = [...new Set(operations)];
  return unique.length === 1
    ? [`The plan would run: ${unique[0]}.`]
    : ['The plan would run:', ...unique.map((label) => `- ${label}`)];
}

/** The text the prompt asks: what the change would do, what the plan would run, the notes, and what each answer means. */
export function questionText(parts: QuestionParts): string {
  return [
    parts.headline,
    ...planRunLines(parts.operations),
    ...parts.notes,
    ...(parts.keepDataWays ?? []),
    `${parts.answers.map(({ typed }) => typed).join('; ')}.`,
  ].join('\n');
}

/** Flags a run was given that answered nothing it asked, and whether it ran with `--yes`. */
export interface UnansweringFlags {
  readonly unmatched: readonly { readonly verb: string; readonly values: readonly string[] }[];
  readonly confirm: readonly string[];
  readonly yes: boolean;
}

export interface RefusalText {
  readonly summary: string;
  readonly why: string | undefined;
  readonly nextActions: readonly string[];
}

const YES_ORDER: readonly WhatYesWouldDo[] = [
  'delete data',
  'change or lose data',
  'change access',
];

function yesLine(open: readonly QuestionParts[]): string {
  const would = YES_ORDER.find((each) => open.some(({ yesWould }) => yesWould === each));
  return would === 'change or lose data'
    ? '--yes does not answer this: it can change or lose data.'
    : `--yes does not answer this: it would ${would ?? 'delete data'}.`;
}

function flagsNamingNothing(flags: UnansweringFlags): readonly string[] {
  return [
    ...flags.unmatched.map(
      ({ verb, values }) =>
        `--${verb} ${values.map(shellQuoted).join(' ')} names nothing this change asks about.`,
    ),
    ...flags.confirm.map((token) => `--confirm ${shellQuoted(token)} does not answer this.`),
  ];
}

function summaryOf(open: readonly (QuestionParts & { readonly subject: string })[]): string {
  const [only] = open;
  if (only !== undefined && open.length === 1) return only.headline;
  const subjects = [...new Set(open.map(({ subject }) => `"${subject}"`))];
  return subjects.length === open.length
    ? `This change needs ${open.length} answers: ${subjects.join(', ')}.`
    : `This change needs ${open.length} answers about ${subjects.join(', ')}.`;
}

function answerLines(open: readonly QuestionParts[]): readonly string[] {
  const grouped = new Map<string, { answer: QuestionAnswer; count: number }>();
  for (const answer of open.flatMap(({ answers }) => answers)) {
    const key = statementFlag(answer.flag);
    const seen = grouped.get(key);
    grouped.set(key, { answer, count: (seen?.count ?? 0) + 1 });
  }
  return [...grouped].map(([flag, { answer, count }]) => {
    if (count > 1) {
      return `${answer.ifEach?.(count) ?? answer.ifNamed}: ${Array(count).fill(flag).join(' ')}`;
    }
    return `${open.length === 1 ? answer.ifOnly : answer.ifNamed}: ${flag}`;
  });
}

/**
 * The refusal when nobody can answer the open questions: what the change would do, what the plan
 * would run, the flags that answered nothing, and each answer with what it means. One question
 * gives its headline as the summary; several are counted, each opening its paragraph of `why`.
 */
export function refusalText(
  open: readonly (QuestionParts & { readonly subject: string })[],
  flags: UnansweringFlags,
): RefusalText {
  const paragraphs = open.flatMap((question) => [
    ...(open.length === 1 ? [] : [question.headline]),
    ...planRunLines(question.operations),
    ...question.notes,
  ]);
  const why = [...paragraphs, ...flagsNamingNothing(flags), ...(flags.yes ? [yesLine(open)] : [])];
  return {
    summary: summaryOf(open),
    why: why.length === 0 ? undefined : why.join('\n'),
    nextActions: [
      ...new Set(open.flatMap(({ keepDataWays }) => keepDataWays ?? [])),
      ...answerLines(open),
    ],
  };
}
