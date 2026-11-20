import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { PromptSurface, StatementSurface } from '@prisma/cli-engine';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { questionText, refusalText } from '../control-api/statements/plan-question-text';
import {
  type AnsweredWithoutAsking,
  type AnswerPlanQuestions,
  matchConsents,
  type PlanAnswer,
  type PlanQuestion,
  type PlanQuestionVerb,
} from '../control-api/statements/plan-questions';
import { statementFlag } from '../control-api/statements/statement-flag';
import { errorConsentUnused } from '../utils/cli-errors';
import { chooseAction } from '../utils/next-actions';

/**
 * The answers the `--delete` values give when one of them names a namespace of the questions: the
 * engine answers a question only with a value equal to its subject, one value per question, so a
 * namespace that answers every question about its models is matched here. The values are taken
 * from the engine; `undefined` leaves them to it.
 */
function namespaceDeletes(
  questions: readonly PlanQuestion[],
  statements: StatementSurface,
): ReadonlyMap<number, PlanAnswer> | undefined {
  const deletes = statements.values().filter(({ verb }) => verb === 'delete');
  const removed = new Set(questions.flatMap(({ removedNamespace }) => removedNamespace ?? []));
  if (!deletes.some(({ text }) => removed.has(text))) return undefined;
  const taken = statements.take('delete').map(({ text }) => text);
  const deletable = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => question.verbs.includes('delete'));
  const matched = matchConsents(
    'delete',
    deletable.map(({ question }) => ({
      text: question.subject,
      removedNamespace: question.removedNamespace,
    })),
    taken,
  );
  if (matched.unused.length > 0) {
    throw errorConsentUnused(
      matched.unused,
      questions.map(({ subject }) => subject),
    );
  }
  const answered = new Map<number, PlanAnswer>();
  for (const [position] of matched.answered) {
    const entry = deletable[position];
    if (entry !== undefined)
      answered.set(entry.index, { verb: 'delete', text: entry.question.subject });
  }
  return answered;
}

/** The flag a question last refused, and why, which a `CLI.PROMPT_INVALID` from the engine is about. */
interface Refused {
  readonly question: PlanQuestion;
  readonly verb: PlanQuestionVerb;
  readonly text: string;
  readonly reason: string;
}

/** What the engine asks: the question's text, with the removed namespace and its verbs when `withNamespace`. */
function engineQuestion(
  question: PlanQuestion,
  refusals: { last: Refused | undefined },
  withNamespace = false,
) {
  const namespace = question.removedNamespaceParts;
  const shown =
    namespace === undefined
      ? question
      : {
          ...question,
          removedNamespaceParts: {
            ...namespace,
            answers: namespace.answers.filter(({ flag }) =>
              question.verbs.some((verb) => verb === flag.verb),
            ),
          },
        };
  return {
    question: questionText(shown, withNamespace),
    subject: question.subject,
    verbs: question.verbs,
    forms: question.forms,
    validate: (verb: PlanQuestionVerb, text: string) => {
      const reason = question.validate(verb, text);
      refusals.last = reason === undefined ? undefined : { question, verb, text, reason };
      return reason;
    },
  };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Whether the engine refused because nobody can answer. */
function isConsentRequired(error: unknown): boolean {
  return hasCode(error, 'CLI.CONSENT_REQUIRED');
}

/**
 * Asks the questions one at a time, so a `delete` typed for a namespace the destination removed
 * answers the rest of that namespace's questions without asking them. A `rename` of the namespace
 * answers only its own question and leaves the rest open: the command plans again with it and asks
 * what is left, such as a model of the namespace that also changed its name. When nobody can
 * answer a question, the engine is asked every question still open at once, so its refusal names
 * them all.
 */
async function askOneAtATime(
  prompt: PromptSurface,
  asked: readonly { readonly question: PlanQuestion; readonly index: number }[],
  refusals: { last: Refused | undefined },
): Promise<ReadonlyMap<number, PlanAnswer>> {
  const answered = new Map<number, PlanAnswer>();
  const namespaceDeleted = new Map<string, PlanAnswer>();
  const namespaceRenamed = new Set<string>();
  const namespaceShown = new Set<string>();
  for (const [position, { question, index }] of asked.entries()) {
    const { removedNamespace } = question;
    if (removedNamespace !== undefined && namespaceRenamed.has(removedNamespace)) continue;
    const deleted =
      removedNamespace === undefined ? undefined : namespaceDeleted.get(removedNamespace);
    if (deleted !== undefined) {
      answered.set(index, deleted);
      continue;
    }
    const withNamespace = removedNamespace !== undefined && !namespaceShown.has(removedNamespace);
    if (removedNamespace !== undefined) namespaceShown.add(removedNamespace);
    const [typed] = await prompt
      .statements([engineQuestion(question, refusals, withNamespace)])
      .catch(async (error: unknown) => {
        if (!isConsentRequired(error)) throw error;
        await prompt.statements(
          asked.slice(position).map(({ question: open }) => engineQuestion(open, refusals)),
          { last: true },
        );
        throw error;
      });
    if (typed === undefined) continue;
    const answer: PlanAnswer = { verb: typed.verb, text: typed.text };
    answered.set(index, answer);
    const ofNamespace = question.namespaceAnswer?.(answer.verb, answer.text);
    if (removedNamespace !== undefined && ofNamespace === 'delete') {
      namespaceDeleted.set(removedNamespace, answer);
    }
    if (removedNamespace !== undefined && ofNamespace === 'rename') {
      namespaceRenamed.add(removedNamespace);
    }
  }
  await prompt.statements([], { last: true });
  return answered;
}

function records(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry: unknown) =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry)
          ? [Object.fromEntries(Object.entries(entry))]
          : [],
      )
    : [];
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/**
 * The open questions the engine's refusal lists in `meta.unanswered`, in order, each known by its
 * subject and verbs. The engine answers questions that share both in order, so the unanswered ones
 * are the last ones. A listed entry no question has means the CLI and the engine disagree on what
 * was asked.
 */
function openQuestions(
  error: CliStructuredError,
  questions: readonly PlanQuestion[],
): readonly PlanQuestion[] {
  const keyOf = (subject: string, verbs: readonly string[]) => JSON.stringify([subject, verbs]);
  const listed = records(error.meta?.['unanswered']).map(({ subject, verbs }) =>
    keyOf(String(subject), strings(verbs)),
  );
  if (listed.length === 0) return questions;
  const open = new Set<PlanQuestion>();
  for (const key of new Set(listed)) {
    const count = listed.filter((each) => each === key).length;
    const matching = questions.filter(({ subject, verbs }) => keyOf(subject, verbs) === key);
    if (matching.length < count) {
      throw new InternalError(
        'The engine refused to go on without flags for questions the CLI did not ask.',
        {
          cause: {
            unanswered: error.meta?.['unanswered'],
            asked: questions.map(({ subject, verbs }) => ({ subject, verbs })),
          },
        },
      );
    }
    for (const question of matching.slice(-count)) open.add(question);
  }
  return questions.filter((question) => open.has(question));
}

/** The engine's error with its summary, `why` and next actions replaced, and the rest kept. */
function rebuilt(
  error: CliStructuredError,
  text: {
    readonly summary: string;
    readonly why: string | undefined;
    readonly nextActions: readonly string[];
  },
): CliStructuredError {
  return new CliStructuredError(error.code, text.summary, {
    severity: error.severity,
    ...ifDefined('why', text.why),
    nextActions: text.nextActions.map(chooseAction),
    diagnostics: error.diagnostics,
    ...ifDefined('where', error.where),
    ...ifDefined('meta', error.meta),
    ...ifDefined('docsUrl', error.docsUrl),
    cause: error,
  });
}

/**
 * The engine's errors about the questions, rebuilt from the questions: its refusal to go on
 * without flags says what the change would do, the operations that do it, the flags that did
 * nothing, and each flag with what it means; its refusal of a flag or typed answer a question
 * rejected says what was given, why it does not fit, and what the change would do. Code,
 * severity, docs link and meta stay the engine's.
 */
function rebuiltError(
  error: unknown,
  questions: readonly PlanQuestion[],
  refused: Refused | undefined,
): unknown {
  if (!CliStructuredError.is(error)) return error;
  if (isConsentRequired(error)) {
    const refusal = refusalText(openQuestions(error, questions), {
      unmatched: records(error.meta?.['unmatched']).map(({ verb, values }) => ({
        verb: String(verb),
        values: strings(values),
      })),
      confirm: strings(error.meta?.['confirm']),
      yes: error.message.includes('--yes'),
    });
    return rebuilt(error, refusal);
  }
  if (hasCode(error, 'CLI.PROMPT_INVALID') && refused !== undefined) {
    return rebuilt(error, {
      summary: `${statementFlag({ verb: refused.verb, text: refused.text })} does not fit this change: ${refused.reason}`,
      why: refused.question.headline,
      nextActions: [],
    });
  }
  return error;
}

/**
 * Asks a plan's questions through the engine's statement prompt. Flags answer first; where nobody
 * can answer, the engine refuses and lists every question. A `--delete` that names a namespace
 * answers every question about a model or field of it, and so does a `delete` of the namespace
 * typed at the prompt; a typed `rename` of it plans again before the rest are asked. Without such a namespace, the questions are asked in one batch
 * that refuses a statement nothing consumed before the command acts.
 */
export function promptPlanQuestions(
  prompt: PromptSurface,
  statements: StatementSurface,
): AnswerPlanQuestions {
  return async (questions, answeredWithoutAsking = []) => {
    takeConsentsAnsweredWithoutAsking(questions, answeredWithoutAsking, statements);
    const refusals: { last: Refused | undefined } = { last: undefined };
    return answering(
      prompt,
      statements,
      refusals,
    )(questions).catch((error: unknown) => {
      throw rebuiltError(error, questions, refusals.last);
    });
  };
}

/**
 * Takes the `--delete` and `--allow` values of each verb no question asks about but the run
 * answered without asking, as a database whose data protection policy permits it does: a value
 * that names such a subject is used, and one that names nothing the run touched is unused.
 */
function takeConsentsAnsweredWithoutAsking(
  questions: readonly PlanQuestion[],
  answeredWithoutAsking: readonly AnsweredWithoutAsking[],
  statements: StatementSurface,
): void {
  for (const verb of ['delete', 'allow'] as const) {
    const answered = answeredWithoutAsking.filter((entry) => entry.verb === verb);
    if (answered.length === 0 || questions.some(({ verbs }) => verbs.includes(verb))) continue;
    const matched = matchConsents(
      verb,
      answered.map(({ subject, removedNamespace }) => ({ text: subject, removedNamespace })),
      statements.take(verb).map(({ text }) => text),
    );
    if (matched.unused.length > 0) {
      throw errorConsentUnused(
        matched.unused,
        questions.map(({ subject }) => subject),
      );
    }
  }
}

function answering(
  prompt: PromptSurface,
  statements: StatementSurface,
  refusals: { last: Refused | undefined },
): AnswerPlanQuestions {
  return async (questions): Promise<readonly (PlanAnswer | undefined)[]> => {
    const answered = namespaceDeletes(questions, statements) ?? new Map<number, PlanAnswer>();
    const asked = questions
      .map((question, index) => ({ question, index }))
      .filter(({ index }) => !answered.has(index));
    const byIndex = new Map(answered);
    if (asked.some(({ question }) => question.removedNamespace !== undefined)) {
      for (const [index, answer] of await askOneAtATime(prompt, asked, refusals)) {
        byIndex.set(index, answer);
      }
    } else {
      const answers = await prompt.statements(
        asked.map(({ question }) => engineQuestion(question, refusals)),
        { last: true },
      );
      asked.forEach(({ index }, position) => {
        const answer = answers[position];
        if (answer !== undefined) byIndex.set(index, { verb: answer.verb, text: answer.text });
      });
    }
    return questions.map((_, index) => byIndex.get(index));
  };
}
