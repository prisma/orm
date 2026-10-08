import type { ContractWithDomain } from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import {
  type MigrationSubject,
  type ModelCoordinate,
  migrationSubjectKey,
  modelDisplayName,
  type ResolvedMigrationStatement,
  type TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  errorStatementAnswersNoQuestion,
  errorStatementDidNotResolveLoss,
  STORE_ORIGIN_SNAPSHOT_STEPS,
} from '../../utils/cli-errors';
import type { ConsentVerb } from './parse-consent';
import { resolveStatements } from './resolve-statements';
import type { StatementText } from './statement-text';

/** A verb a plan question accepts. */
export type PlanQuestionVerb = 'rename' | ConsentVerb;

/**
 * What a command asks about one operation of a plan: the question, its subject written as the
 * statement names it, and the verbs that answer it. A command hands it to its prompt.
 */
export interface PlanQuestion {
  readonly question: string;
  readonly subject: string;
  readonly verbs: readonly PlanQuestionVerb[];
  readonly forms: { readonly rename?: string };
  readonly validate: (verb: PlanQuestionVerb, text: string) => string | undefined;
}

export interface PlanAnswer {
  readonly verb: PlanQuestionVerb;
  readonly text: string;
}

/**
 * Asks every question at once and returns one answer per question, in question order, with a verb
 * and text the question accepts. To refuse, throw. It is called at least once per apply, with an
 * empty list when nothing is in question, including under `acceptDataLoss: true`; return `[]`
 * then.
 */
export type AnswerPlanQuestions = (
  questions: readonly PlanQuestion[],
) => Promise<readonly PlanAnswer[]>;

/**
 * An operation of a plan with its subject and the label of that operation. `operationIndex` is
 * its position among the operations the result lists; `undefined` when the plan could not resolve
 * it.
 */
export interface PlannedSubject {
  readonly operationIndex: number | undefined;
  readonly label: string;
  readonly subject: MigrationSubject;
}

/** An operation of a plan that changes who can read or write its subject's rows. */
export interface PlannedAccessChange extends PlannedSubject {
  readonly widens: boolean;
}

/** What a plan would lose, and whose access it would change. */
export interface PlannedQuestions {
  readonly dataLoss: readonly PlannedSubject[];
  readonly accessWidening: readonly PlannedAccessChange[];
}

function modelText(contract: ContractWithDomain, coordinate: ModelCoordinate): string {
  return Object.keys(contract.domain.namespaces).length > 1
    ? modelDisplayName(coordinate)
    : coordinate.model;
}

/** The contracts a statement names things in, and the renames the plan applies so far. */
export interface StatementContracts {
  readonly origin: ContractWithDomain;
  /** The destination contract; needed only to name a field of a renamed model. */
  readonly destination?: ContractWithDomain;
  readonly renames: readonly StatementText[];
}

/** The model a rename statement of `contracts` gives `coordinate` in the destination, if any. */
function renamedModel(
  coordinate: ModelCoordinate,
  contracts: StatementContracts,
): ModelCoordinate | undefined {
  if (contracts.destination === undefined || contracts.renames.length === 0) return undefined;
  const resolved = resolveStatements({
    statements: contracts.renames,
    origin: { kind: 'contract', contract: contracts.origin },
    destination: contracts.destination,
  });
  if (!resolved.ok) return undefined;
  return resolved.value.find(
    (statement) =>
      statement.entity === 'model' &&
      statement.from.namespaceId === coordinate.namespaceId &&
      statement.from.model === coordinate.model,
  )?.to;
}

/**
 * The subject as a statement names it: `Model` or `Model.field`, with the namespace when its
 * contract has several, or the storage name when no model stores what the operation is about. A
 * field of a model the plan renames is named through the model's new name, as a rename of the
 * field is written.
 */
export function subjectText(subject: MigrationSubject, contracts: StatementContracts): string {
  switch (subject.kind) {
    case 'model':
      return modelText(contracts.origin, subject);
    case 'field': {
      const renamed = renamedModel(subject, contracts);
      const model =
        renamed === undefined || contracts.destination === undefined
          ? modelText(contracts.origin, subject)
          : modelText(contracts.destination, renamed);
      return `${model}.${subject.field}`;
    }
    case 'storage':
      return subject.name;
  }
}

/** The statement's description, written as its question names the subject: `delete field "User.nickname"`. */
export function consentDescription(
  verb: ConsentVerb,
  subject: MigrationSubject,
  text: string,
): string {
  return `${verb} ${subject.kind} "${text}"`;
}

function lossText(subject: MigrationSubject, text: string, originKnown: boolean): string {
  switch (subject.kind) {
    case 'model':
      return `would lose the data of model "${text}"`;
    case 'field':
      return `would lose the values of field "${text}"`;
    case 'storage':
      return originKnown
        ? `would lose the data in "${text}", which no model of the origin contract stores`
        : `would lose the data in "${text}", named by its storage name because the origin contract is unknown; --delete loses its rows`;
  }
}

/**
 * How to keep the rows of a storage subject that was renamed, when the origin contract is unknown:
 * store the snapshot of the contract the database is at, as `MIGRATION.STATEMENT_ORIGIN_UNKNOWN`
 * advises, then answer with a rename. The refusal gives it once, on its first storage question. The
 * engine does not put the CLI's name in a question's text, so the steps name `prisma`.
 */
export const ORIGIN_SNAPSHOT_RECOVERY = [
  'If it was renamed, keep its data instead: store the snapshot of the contract the database is at, then run this command again and answer with --rename.',
  ...STORE_ORIGIN_SNAPSHOT_STEPS.map((step) => step.replaceAll('{bin}', 'prisma')),
].join(' ');

function sameCoordinate(statement: ResolvedMigrationStatement, subject: MigrationSubject): boolean {
  if (subject.kind === 'storage') return false;
  const { from } = statement;
  if (from.namespaceId !== subject.namespaceId || from.model !== subject.model) return false;
  return subject.kind === 'field'
    ? statement.entity === 'field' && statement.from.field === subject.field
    : statement.entity === 'model';
}

function namesSubject(verb: ConsentVerb, subject: string) {
  return (text: string): string | undefined =>
    text === subject ? undefined : `${verb} names "${subject}": --${verb} ${subject}.`;
}

/**
 * How the target says to keep a subject's data by hand when its planner carries out no rename, or
 * `undefined` when it carries them out.
 */
export function keepDataByHandFor(
  migrations: { readonly renameStatements?: TargetMigrationsCapability['renameStatements'] },
  origin: ContractWithDomain,
): ((subject: MigrationSubject) => string) | undefined {
  const refused = migrations.renameStatements;
  return refused === undefined ? undefined : (subject) => refused.keepDataByHand(subject, origin);
}

/** A rename as a statement is written: a field's new name keeps the model, `User.nickname:User.<new name>`. */
function renameForm(subject: MigrationSubject, text: string): string {
  return subject.kind === 'field'
    ? `${text}:${text.slice(0, text.lastIndexOf('.'))}.<new name>`
    : `${text}:<new name>`;
}

/** Whether a rename statement of the plan already gives the subject a new name. */
function renamedByPlan(
  subject: MigrationSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): boolean {
  if (subject.kind === 'storage' || contracts.renames.length === 0) return false;
  const resolved = resolveStatements({
    statements: contracts.renames,
    origin: { kind: 'contract', contract: contracts.origin },
    destination: contracts.destination,
  });
  return resolved.ok && resolved.value.some((statement) => sameCoordinate(statement, subject));
}

/** Whether the destination still has the subject's model or field, under the name a rename gives it. */
function inDestination(
  subject: MigrationSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): boolean {
  if (subject.kind === 'storage') return false;
  const model = renamedModel(subject, contracts) ?? subject;
  const destinationModel =
    contracts.destination.domain.namespaces[model.namespaceId]?.models[model.model];
  if (destinationModel === undefined) return false;
  return subject.kind === 'model' || Object.hasOwn(destinationModel.fields, subject.field);
}

/**
 * The question for one operation that would lose data. A model or field the destination no longer
 * has, and no rename of the plan renamed, may be renamed instead of deleted; a rename is resolved
 * against the two contracts after the plan's other renames, and its old name must be the subject.
 * A subject the destination keeps, such as a field whose type changes, and data no model stores,
 * can only be deleted. Where the target's planner carries out no rename, `keepDataByHand` says how
 * to keep the data instead.
 */
export function dataLossQuestion(
  loss: PlannedSubject,
  contracts: StatementContracts & {
    readonly destination: ContractWithDomain;
    readonly originKnown: boolean;
    readonly keepDataByHand: ((subject: MigrationSubject) => string) | undefined;
  },
): PlanQuestion {
  const subject = subjectText(loss.subject, contracts);
  const renamable =
    contracts.keepDataByHand === undefined &&
    loss.subject.kind !== 'storage' &&
    !inDestination(loss.subject, contracts) &&
    !renamedByPlan(loss.subject, contracts);
  const deleteNames = namesSubject('delete', subject);
  return {
    question: [
      `${loss.label} ${lossText(loss.subject, subject, contracts.originKnown)}.`,
      ...(contracts.keepDataByHand === undefined ? [] : [contracts.keepDataByHand(loss.subject)]),
    ].join(' '),
    subject,
    verbs: renamable ? ['rename', 'delete'] : ['delete'],
    forms: renamable ? { rename: renameForm(loss.subject, subject) } : {},
    validate: (verb, text) => {
      if (verb !== 'rename') return deleteNames(text);
      const resolved = resolveStatements({
        statements: [...contracts.renames, { verb: 'rename', text }],
        origin: { kind: 'contract', contract: contracts.origin },
        destination: contracts.destination,
      });
      if (!resolved.ok) return `${resolved.failure.message}. ${resolved.failure.why ?? ''}`.trim();
      const statement = resolved.value.at(-1);
      return statement !== undefined && sameCoordinate(statement, loss.subject)
        ? undefined
        : `The rename's old name is not "${subject}". Write it as ${renameForm(loss.subject, subject)}.`;
    },
  };
}

/**
 * The question for one operation that changes who can read or write its subject's rows: it widens
 * access, as disabling row-level security does, or changes it either way, as dropping a policy
 * does. Each such operation is its own question, answered by its own `allow`.
 */
export function accessWideningQuestion(
  widening: PlannedAccessChange,
  contracts: StatementContracts,
): PlanQuestion {
  const subject = subjectText(widening.subject, contracts);
  return {
    question: `${widening.label} would ${widening.widens ? 'widen' : 'change'} who can read and write its rows.`,
    subject,
    verbs: ['allow'],
    forms: {},
    validate: (_verb, text) => namesSubject('allow', subject)(text),
  };
}

/** A subject the user consented to, with the statement's text as its question wrote it. */
export interface ConsentedSubject {
  readonly verb: ConsentVerb;
  readonly subject: MigrationSubject;
  readonly text: string;
  /** The position of the operation an `allow` consented to; a `delete` covers every loss of its subject. */
  readonly operationIndex: number | undefined;
}

const keyOf = (planned: PlannedSubject) => migrationSubjectKey(planned.subject);

/**
 * The pre-answers that answer a question about `text`: every `delete` of the subject, or the
 * first `allow` of it no earlier question took, since an `allow` answers one operation.
 */
function givenFor(
  verb: ConsentVerb,
  text: string,
  preAnswers: readonly StatementText[],
  taken: ReadonlySet<StatementText>,
): readonly StatementText[] {
  const matching = preAnswers.filter(
    (statement) => statement.verb === verb && statement.text === text,
  );
  if (verb === 'delete') return matching;
  const first = matching.find((statement) => !taken.has(statement));
  return first === undefined ? [] : [first];
}

/**
 * A `delete` answers for its subject; an `allow` for its one operation, known by its label and
 * subject, since a re-plan moves every operation's position.
 */
function questionKey(verb: ConsentVerb, entry: PlannedSubject): string {
  return verb === 'allow' ? `allow:${entry.label}:${keyOf(entry)}` : `delete:${keyOf(entry)}`;
}

function checkAnswers(questions: readonly PlanQuestion[], answers: readonly PlanAnswer[]): void {
  if (answers.length !== questions.length) {
    const noun = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    throw new InternalError(
      `answerQuestions gave ${noun(answers.length, 'answer')} for ${noun(questions.length, 'question')}; answer each question in order, or throw to refuse.`,
      { cause: { questions: questions.map(({ subject }) => subject), answers } },
    );
  }
  questions.forEach((question, index) => {
    const answer = answers[index];
    if (answer === undefined) return;
    const cause = { cause: { question: question.subject, verbs: question.verbs, answer } };
    if (!question.verbs.includes(answer.verb)) {
      throw new InternalError(
        `answerQuestions answered "${question.question}" with ${answer.verb}, which it does not accept; it accepts ${question.verbs.join(' or ')}.`,
        cause,
      );
    }
    const rejected = question.validate(answer.verb, answer.text);
    if (rejected !== undefined) {
      throw new InternalError(
        `answerQuestions answered "${question.question}" wrongly: ${rejected}`,
        cause,
      );
    }
  });
}

function withRecoveryOnFirstStorageQuestion(
  asked: readonly { readonly loss: PlannedSubject; readonly question: PlanQuestion }[],
  recoveryApplies: boolean,
): readonly PlanQuestion[] {
  const first = recoveryApplies
    ? asked.findIndex(({ loss }) => loss.subject.kind === 'storage')
    : -1;
  return asked.map(({ question }, index) =>
    index === first
      ? { ...question, question: `${question.question} ${ORIGIN_SNAPSHOT_RECOVERY}` }
      : question,
  );
}

/**
 * Asks about every operation of a plan that would lose data and, when `askAccess`, every one that
 * would widen access, until each is answered. A `delete` or `allow` text in `preAnswers`, or
 * `consentAll` for its verb, answers its question without asking. A rename typed at the prompt is a statement
 * the plan did not have, so the plan is made again with it, and the operation it answered must be
 * gone; a loss the new plan has on the same subject, such as a type change on the renamed field,
 * is asked in the next round. The first round asks even when nothing is in question, so a statement no question consumed is
 * refused before anything is done.
 */
export async function askPlanQuestions<TPlan extends PlannedQuestions, TFailure>(input: {
  readonly plan: TPlan;
  readonly askAccess: boolean;
  readonly renames: readonly StatementText[];
  readonly preAnswers: readonly StatementText[];
  readonly consentAll: { readonly [verb in ConsentVerb]: boolean };
  readonly origin: ContractWithDomain;
  readonly originKnown: boolean;
  readonly keepDataByHand: ((subject: MigrationSubject) => string) | undefined;
  readonly destination: ContractWithDomain;
  readonly answer: AnswerPlanQuestions;
  readonly replan: (renames: readonly StatementText[]) => Promise<Result<TPlan, TFailure>>;
}): Promise<
  Result<
    {
      readonly plan: TPlan;
      readonly renames: readonly StatementText[];
      readonly consented: readonly ConsentedSubject[];
    },
    TFailure | CliStructuredError
  >
> {
  let plan = input.plan;
  let renames = input.renames;
  const consented = new Map<string, ConsentedSubject>();
  const usedPreAnswers = new Set<StatementText>();
  for (let round = 0; ; round += 1) {
    const contracts = {
      origin: input.origin,
      originKnown: input.originKnown,
      keepDataByHand: input.keepDataByHand,
      destination: input.destination,
      renames,
    };
    const pending = <TEntry extends PlannedSubject>(
      verb: ConsentVerb,
      planned: readonly TEntry[],
    ): readonly TEntry[] => [
      ...new Map(
        planned
          .filter((entry) => !consented.has(questionKey(verb, entry)))
          .map((entry) => [questionKey(verb, entry), entry]),
      ).values(),
    ];
    const consent = (verb: ConsentVerb, entry: PlannedSubject, text: string) =>
      consented.set(questionKey(verb, entry), {
        verb,
        subject: entry.subject,
        text,
        operationIndex: entry.operationIndex,
      });
    for (const [verb, entries] of [
      ['delete', pending('delete', plan.dataLoss)],
      ['allow', input.askAccess ? pending('allow', plan.accessWidening) : []],
    ] as const) {
      for (const entry of entries) {
        const text = subjectText(entry.subject, contracts);
        const given = givenFor(verb, text, input.preAnswers, usedPreAnswers);
        for (const statement of given) usedPreAnswers.add(statement);
        if (input.consentAll[verb] || given.length > 0) consent(verb, entry, text);
      }
    }
    const losses = pending('delete', plan.dataLoss);
    const widenings = input.askAccess ? pending('allow', plan.accessWidening) : [];
    if (losses.length + widenings.length === 0 && round > 0) break;
    const questions = [
      ...withRecoveryOnFirstStorageQuestion(
        losses.map((loss) => ({ loss, question: dataLossQuestion(loss, contracts) })),
        !input.originKnown && input.keepDataByHand === undefined,
      ),
      ...widenings.map((widening) => accessWideningQuestion(widening, contracts)),
    ];
    const answers = await input.answer(questions);
    checkAnswers(questions, answers);
    const typedRenames: { readonly text: string; readonly loss: PlannedSubject }[] = [];
    answers.forEach((answer, index) => {
      const entry = [...losses, ...widenings][index];
      const question = questions[index];
      if (entry === undefined || question === undefined) return;
      if (answer.verb === 'rename') typedRenames.push({ text: answer.text, loss: entry });
      else consent(answer.verb, entry, question.subject);
    });
    if (typedRenames.length === 0) {
      if (losses.length + widenings.length === 0) break;
      continue;
    }
    renames = [...renames, ...typedRenames.map(({ text }) => ({ verb: 'rename' as const, text }))];
    const replanned = await input.replan(renames);
    if (!replanned.ok) return replanned;
    plan = replanned.value;
    for (const entry of plan.accessWidening) {
      const allowed = consented.get(questionKey('allow', entry));
      if (allowed !== undefined) {
        consented.set(questionKey('allow', entry), {
          ...allowed,
          operationIndex: entry.operationIndex,
        });
      }
    }
    const operationOf = (entry: PlannedSubject) => `${entry.label}:${keyOf(entry)}`;
    const stillPlanned = new Set(plan.dataLoss.map(operationOf));
    const unresolved = typedRenames.find(({ loss }) => stillPlanned.has(operationOf(loss)));
    if (unresolved !== undefined) {
      return notOk(
        errorStatementDidNotResolveLoss(
          { verb: 'rename', text: unresolved.text },
          subjectText(unresolved.loss.subject, contracts),
        ),
      );
    }
  }
  const unused = input.preAnswers.filter((statement) => !usedPreAnswers.has(statement));
  if (unused.length > 0) {
    return notOk(
      errorStatementAnswersNoQuestion(
        unused,
        questionSubjects(plan, input.askAccess, { ...input, renames }),
      ),
    );
  }
  return ok({ plan, renames, consented: [...consented.values()] });
}

function questionSubjects(
  plan: PlannedQuestions,
  askAccess: boolean,
  contracts: StatementContracts,
): readonly string[] {
  const subjects = [...plan.dataLoss, ...(askAccess ? plan.accessWidening : [])].map((entry) =>
    subjectText(entry.subject, contracts),
  );
  return [...new Set(subjects)];
}

/**
 * Refuses the `delete` and `allow` statements that name no subject a plan asks about, without
 * asking anything: a run that only plans still says which statements would consent to nothing.
 */
export function refuseUnusedConsents(input: {
  readonly plan: PlannedQuestions;
  readonly statements: readonly StatementText[];
  readonly contracts: StatementContracts;
}): Result<void, CliStructuredError> {
  const subjects = questionSubjects(input.plan, true, input.contracts);
  const used = new Set<StatementText>();
  for (const [verb, entries] of [
    ['delete', input.plan.dataLoss],
    ['allow', input.plan.accessWidening],
  ] as const) {
    for (const entry of entries) {
      const text = subjectText(entry.subject, input.contracts);
      for (const statement of givenFor(verb, text, input.statements, used)) used.add(statement);
    }
  }
  const unused = input.statements.filter(
    (statement) => statement.verb !== 'rename' && !used.has(statement),
  );
  return unused.length === 0
    ? ok(undefined)
    : notOk(errorStatementAnswersNoQuestion(unused, subjects));
}
