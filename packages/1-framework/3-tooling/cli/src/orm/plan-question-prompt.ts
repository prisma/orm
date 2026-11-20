import { ifDefined } from '@internal/utils/defined';
import type { PromptSurface, StatementSurface } from '@prisma/cli-engine';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { refusalText } from '../control-api/statements/plan-question-text';
import {
  type AnsweredWithoutAsking,
  type AnswerPlanQuestions,
  matchConsents,
  type PlanAnswer,
  type PlanQuestion,
} from '../control-api/statements/plan-questions';
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

function engineQuestion(question: PlanQuestion) {
  return {
    question: question.question,
    subject: question.subject,
    verbs: question.verbs,
    forms: question.forms,
    validate: question.validate,
  };
}

/** Whether the engine refused because nobody can answer. */
function isConsentRequired(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'CLI.CONSENT_REQUIRED'
  );
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
): Promise<ReadonlyMap<number, PlanAnswer>> {
  const answered = new Map<number, PlanAnswer>();
  const namespaceDeleted = new Map<string, PlanAnswer>();
  const namespaceRenamed = new Set<string>();
  for (const [position, { question, index }] of asked.entries()) {
    const { removedNamespace } = question;
    if (removedNamespace !== undefined && namespaceRenamed.has(removedNamespace)) continue;
    const deleted =
      removedNamespace === undefined ? undefined : namespaceDeleted.get(removedNamespace);
    if (deleted !== undefined) {
      answered.set(index, deleted);
      continue;
    }
    const [typed] = await prompt
      .statements([engineQuestion(question)])
      .catch(async (error: unknown) => {
        if (!isConsentRequired(error)) throw error;
        await prompt.statements(
          asked.slice(position).map(({ question: open }) => engineQuestion(open)),
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
 * The open questions the engine's refusal lists in `meta.unanswered`, in order. The engine answers
 * questions that share a subject in order, so the unanswered ones of a subject are its last ones.
 */
function openQuestions(
  error: CliStructuredError,
  questions: readonly PlanQuestion[],
): readonly PlanQuestion[] {
  const listed = records(error.meta?.['unanswered']).map(({ subject }) => String(subject));
  if (listed.length === 0) return questions;
  const open = new Set<PlanQuestion>();
  for (const subject of new Set(listed)) {
    const count = listed.filter((each) => each === subject).length;
    for (const question of questions.filter((each) => each.subject === subject).slice(-count)) {
      open.add(question);
    }
  }
  return questions.filter((question) => open.has(question));
}

/**
 * The engine's refusal to answer, rebuilt from the open questions: what the change would do, what
 * the plan would run, the flags that answered nothing, and each answer with what it means. Its code,
 * severity, docs link and meta stay the engine's.
 */
function refusalFrom(error: unknown, questions: readonly PlanQuestion[]): unknown {
  if (!isConsentRequired(error) || !CliStructuredError.is(error)) return error;
  const open = openQuestions(error, questions);
  if (open.length === 0) return error;
  const refusal = refusalText(open, {
    unmatched: records(error.meta?.['unmatched']).map(({ verb, values }) => ({
      verb: String(verb),
      values: strings(values),
    })),
    confirm: strings(error.meta?.['confirm']),
    yes: error.message.includes('--yes'),
  });
  return new CliStructuredError(error.code, refusal.summary, {
    severity: error.severity,
    ...ifDefined('why', refusal.why),
    nextActions: refusal.nextActions.map(chooseAction),
    diagnostics: error.diagnostics,
    ...ifDefined('where', error.where),
    ...ifDefined('meta', error.meta),
    ...ifDefined('docsUrl', error.docsUrl),
    cause: error,
  });
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
  const answer = answering(prompt, statements);
  return async (questions, answeredWithoutAsking = []) => {
    takeConsentsAnsweredWithoutAsking(questions, answeredWithoutAsking, statements);
    return answer(questions).catch((error: unknown) => {
      throw refusalFrom(error, questions);
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

function answering(prompt: PromptSurface, statements: StatementSurface): AnswerPlanQuestions {
  return async (questions): Promise<readonly (PlanAnswer | undefined)[]> => {
    const answered = namespaceDeletes(questions, statements) ?? new Map<number, PlanAnswer>();
    const asked = questions
      .map((question, index) => ({ question, index }))
      .filter(({ index }) => !answered.has(index));
    const byIndex = new Map(answered);
    if (asked.some(({ question }) => question.removedNamespace !== undefined)) {
      for (const [index, answer] of await askOneAtATime(prompt, asked)) byIndex.set(index, answer);
    } else {
      const answers = await prompt.statements(
        asked.map(({ question }) => engineQuestion(question)),
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
