import { type ContractWithDomain, valueObjectAt } from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import {
  type EnumValueCoordinate,
  enumValueStatementText,
  type FieldCoordinate,
  fieldStatementText,
  type KeepDataEdit,
  type MigrationDataLossKind,
  type MigrationPlanNamespaces,
  type MigrationSubject,
  type ModelCoordinate,
  migrationSubjectKey,
  modelStatementText,
  type ResolvedMigrationStatement,
  type ValueObjectFieldCoordinate,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  errorConsentUnused,
  errorStatementAnswersNoQuestion,
  errorStatementDidNotResolveLoss,
  STORE_ORIGIN_SNAPSHOT_STEPS,
  type UnusedConsent,
} from '../../utils/cli-errors';
import type { ConsentVerb } from './parse-consent';
import { resolveStatements } from './resolve-statements';
import { statementFlag } from './statement-flag';
import { ENTITY_WORDS, type StatementText } from './statement-text';
import { variantValueChanged } from './variants';

/** A verb a plan question accepts. */
export type PlanQuestionVerb = 'rename' | 'convert' | ConsentVerb;

/**
 * What a command asks about one operation of a plan: the question, its subject written as the
 * statement names it, and the verbs that answer it. A command hands it to its prompt.
 */
export interface PlanQuestion {
  readonly question: string;
  readonly subject: string;
  /** The namespace of a data-loss question's model or field when the destination removed it: a `delete` of it answers the question too. */
  readonly removedNamespace?: string;
  readonly verbs: readonly PlanQuestionVerb[];
  readonly forms: { readonly rename?: string; readonly convert?: string };
  readonly validate: (verb: PlanQuestionVerb, text: string) => string | undefined;
  /**
   * Whether an answer is the removed namespace's own, a `delete` or a `rename` of the namespace,
   * which answers its other questions too; `undefined` for any other answer.
   */
  readonly namespaceAnswer?: (verb: PlanQuestionVerb, text: string) => NamespaceAnswer | undefined;
  /** The ways to keep the subject's data the question names, which a refusal to answer leads with. */
  readonly keepDataWays?: readonly string[];
}

/** How an answer answers a removed namespace as a whole. */
export type NamespaceAnswer = 'delete' | 'rename';

export interface PlanAnswer {
  readonly verb: PlanQuestionVerb;
  readonly text: string;
}

/**
 * Asks every question at once and returns one answer per question, in question order, with a verb
 * and text the question accepts. To refuse, throw. It is called at least once per apply, with an
 * empty list when nothing is in question, including under `acceptDataLoss: true`; return `[]`
 * then. Beside a `rename` or `convert` answer, which plans again, a question may be left
 * `undefined`: it is asked again, as the new plan has it.
 */
export type AnswerPlanQuestions = (
  questions: readonly PlanQuestion[],
) => Promise<readonly (PlanAnswer | undefined)[]>;

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

/** An operation of a plan that loses its subject's data, how, and how to keep the data instead. */
export interface PlannedDataLoss extends PlannedSubject {
  readonly loss: MigrationDataLossKind | undefined;
  /** How to keep the data instead, in the target's words; the question ends with it. */
  readonly keepDataAdvice?: string;
  /** The edit to a planned migration.ts that keeps the data, which the command words. */
  readonly keepDataEdit?: KeepDataEdit;
}

/** An operation of a plan that changes who can read or write its subject's data. */
export interface PlannedAccessChange extends PlannedSubject {
  readonly widens: boolean;
}

/** What a plan would lose, and whose access it would change. */
export interface PlannedQuestions {
  readonly dataLoss: readonly PlannedDataLoss[];
  readonly accessChanges: readonly PlannedAccessChange[];
  /** The namespaces the planner removes and adds; absent when it reports none. */
  readonly namespaces?: MigrationPlanNamespaces;
}

/** The contracts a statement names things in, and the statements the plan carries out so far. */
export interface StatementContracts {
  readonly origin: ContractWithDomain;
  /** The destination contract; needed only to name a field of a renamed model. */
  readonly destination?: ContractWithDomain;
  /** The rename, convert and backfill statements the plan carries out, in the order given. */
  readonly statements: readonly StatementText[];
}

/** The plan's renames, resolved; empty when there are none or they do not resolve. */
function resolvedRenames(contracts: StatementContracts): readonly ResolvedMigrationStatement[] {
  const renames = contracts.statements.filter((statement) => statement.verb === 'rename');
  if (contracts.destination === undefined || renames.length === 0) return [];
  const resolved = resolveStatements({
    statements: renames,
    origin: { kind: 'contract', contract: contracts.origin },
    destination: contracts.destination,
  });
  return resolved.ok ? resolved.value : [];
}

function sameModel(left: ModelCoordinate, right: ModelCoordinate): boolean {
  return left.namespaceId === right.namespaceId && left.model === right.model;
}

/**
 * The model a rename statement of `contracts` gives `coordinate` in the destination, if any: a
 * rename of the model, or else a rename of its namespace, under which the model keeps its name when
 * the destination has it there.
 */
function renamedModel(
  coordinate: ModelCoordinate,
  contracts: StatementContracts,
): ModelCoordinate | undefined {
  const renames = resolvedRenames(contracts);
  for (const statement of renames) {
    if (
      statement.kind === 'rename' &&
      statement.entity === 'model' &&
      sameModel(statement.from, coordinate)
    ) {
      return statement.to;
    }
  }
  for (const statement of renames) {
    if (
      statement.kind === 'rename' &&
      statement.entity === 'namespace' &&
      statement.from === coordinate.namespaceId
    ) {
      const moved = { namespaceId: statement.to, model: coordinate.model };
      const destinationHas =
        contracts.destination?.domain.namespaces[moved.namespaceId]?.models[moved.model] !==
        undefined;
      return destinationHas ? moved : undefined;
    }
  }
  return undefined;
}

/** The field of the origin contract at `coordinate`, as the destination names it after the plan's renames. */
function destinationField(
  coordinate: FieldCoordinate,
  contracts: StatementContracts,
): FieldCoordinate {
  for (const statement of resolvedRenames(contracts)) {
    if (
      statement.kind === 'rename' &&
      statement.entity === 'field' &&
      sameModel(statement.from, coordinate) &&
      statement.from.field === coordinate.field
    ) {
      return statement.to;
    }
  }
  return { ...(renamedModel(coordinate, contracts) ?? coordinate), field: coordinate.field };
}

/** An enum value under the namespace a namespace rename of `contracts` gives its enum, when the destination has the enum there. */
function renamedEnumValue(
  value: EnumValueCoordinate,
  contracts: StatementContracts,
): EnumValueCoordinate | undefined {
  for (const statement of resolvedRenames(contracts)) {
    if (
      statement.kind === 'rename' &&
      statement.entity === 'namespace' &&
      statement.from === value.namespaceId
    ) {
      const renamed = { ...value, namespaceId: statement.to };
      return contracts.destination?.domain.namespaces[statement.to]?.enum?.[value.enum] ===
        undefined
        ? undefined
        : renamed;
    }
  }
  return undefined;
}

/** The fields of a value object in a contract's storage; `undefined` when the contract has no such value object. */
function valueObjectFields(
  contract: ContractWithDomain,
  field: ValueObjectFieldCoordinate,
): readonly string[] | undefined {
  const valueObject = valueObjectAt(contract.storage, {
    plane: 'storage',
    namespaceId: field.namespaceId,
    entityKind: 'valueObject',
    entityName: field.valueObject,
  });
  return valueObject === undefined ? undefined : Object.keys(valueObject.fields);
}

/** A value object field under the namespace a namespace rename of `contracts` gives its value object, when the destination has the value object there. */
function renamedValueObjectField(
  field: ValueObjectFieldCoordinate,
  contracts: StatementContracts,
): ValueObjectFieldCoordinate | undefined {
  for (const statement of resolvedRenames(contracts)) {
    if (
      statement.kind === 'rename' &&
      statement.entity === 'namespace' &&
      statement.from === field.namespaceId
    ) {
      const renamed = { ...field, namespaceId: statement.to };
      return contracts.destination === undefined ||
        valueObjectFields(contracts.destination, renamed) === undefined
        ? undefined
        : renamed;
    }
  }
  return undefined;
}

/**
 * The subject as a statement names it: `Model` or `Model.field`, with the namespace when its
 * contract has several, or the storage name when no model stores what the operation is about. A
 * model the plan renames or moves, and a field of it, are named through the model's new name, as a
 * rename of the field is written.
 */
export function subjectText(subject: MigrationSubject, contracts: StatementContracts): string {
  switch (subject.kind) {
    case 'model': {
      const renamed = renamedModel(subject, contracts);
      return renamed === undefined || contracts.destination === undefined
        ? modelStatementText(contracts.origin, subject)
        : modelStatementText(contracts.destination, renamed);
    }
    case 'field': {
      const renamed = renamedModel(subject, contracts);
      const model =
        renamed === undefined || contracts.destination === undefined
          ? modelStatementText(contracts.origin, subject)
          : modelStatementText(contracts.destination, renamed);
      return `${model}.${subject.field}`;
    }
    case 'enumValue': {
      const renamed = renamedEnumValue(subject, contracts);
      return renamed === undefined || contracts.destination === undefined
        ? enumValueStatementText(contracts.origin, subject)
        : enumValueStatementText(contracts.destination, renamed);
    }
    case 'valueObjectField': {
      const renamed = renamedValueObjectField(subject, contracts);
      return renamed === undefined || contracts.destination === undefined
        ? valueObjectFieldStatementText(contracts.origin, subject)
        : valueObjectFieldStatementText(contracts.destination, renamed);
    }
    case 'storage':
      return subject.name;
  }
}

/**
 * The statement's description, written as its question names the subject: `delete field
 * "User.nickname"`, or `accept lossy type change of field "User.age"` for a delete that answers a
 * type change, which keeps the field and lets the database cast its values, cutting or rounding some.
 */
export function consentDescription(
  verb: ConsentVerb,
  subject: MigrationSubject,
  text: string,
  loss: MigrationDataLossKind | undefined,
): string {
  const kind = ENTITY_WORDS[subject.kind];
  return verb === 'delete' && loss === 'typeChange'
    ? `accept lossy type change of ${kind} "${text}"`
    : `${verb} ${kind} "${text}"`;
}

function lossText(
  subject: MigrationSubject,
  text: string,
  originKnown: boolean,
  loss: MigrationDataLossKind | undefined,
): string {
  switch (subject.kind) {
    case 'model':
      return `would lose the data of model "${text}"`;
    case 'field':
      return loss === 'typeChange'
        ? `would change the type of field "${text}" and can change or lose its values`
        : `would lose the values of field "${text}"`;
    case 'enumValue':
      return `would lose enum value "${text}" from the data that holds it`;
    case 'valueObjectField':
      return `would lose the values of value object field "${text}"`;
    case 'storage':
      return originKnown
        ? `would lose the data in "${text}", which no model of the origin contract stores`
        : `would lose the data in "${text}", named by its storage name because the origin contract is unknown; --delete loses that data`;
  }
}

/**
 * How to keep the data of a storage subject that was renamed, when the origin contract is unknown:
 * store the snapshot of the contract the database is at, as `MIGRATION.STATEMENT_ORIGIN_UNKNOWN`
 * advises, then answer with a rename. The refusal gives it once, on its first storage question. The
 * engine does not put the CLI's name in a question's text, so the steps name `prisma`.
 */
export const ORIGIN_SNAPSHOT_RECOVERY = [
  'If it was renamed, keep its data instead: store the snapshot of the contract the database is at, then run this command again and answer with --rename.',
  ...STORE_ORIGIN_SNAPSHOT_STEPS.map((step) => step.replaceAll('{bin}', 'prisma')),
].join('\n');

function sameCoordinate(statement: ResolvedMigrationStatement, subject: MigrationSubject): boolean {
  if (statement.kind !== 'rename' || statement.entity === 'namespace' || subject.kind === 'storage')
    return false;
  if (statement.entity === 'valueObjectField' || subject.kind === 'valueObjectField') {
    return (
      statement.entity === 'valueObjectField' &&
      subject.kind === 'valueObjectField' &&
      statement.from.namespaceId === subject.namespaceId &&
      statement.from.valueObject === subject.valueObject &&
      statement.from.field === subject.field
    );
  }
  if (statement.entity === 'enumValue' || subject.kind === 'enumValue') {
    return (
      statement.entity === 'enumValue' &&
      subject.kind === 'enumValue' &&
      statement.from.namespaceId === subject.namespaceId &&
      statement.from.enum === subject.enum &&
      statement.from.member === subject.member
    );
  }
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

function modelRenameAdvice(model: ModelCoordinate, contracts: StatementContracts): string {
  const name = modelStatementText(contracts.origin, model);
  return `The destination contract has no model "${name}"; to keep the values instead, also pass --rename ${name}:<new model name>, naming the model that stores them now, and the question then offers to rename the field.`;
}

/** A rename as a statement is written: a field's new name keeps the model, `User.nickname:User.<new name>`. */
/**
 * The member an enum value can only have been renamed to: the one member of the destination enum
 * that the origin enum does not have and no rename of the plan names.
 */
function onlyNewMember(
  subject: EnumValueCoordinate,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): string | undefined {
  const value = renamedEnumValue(subject, contracts) ?? subject;
  const originMembers =
    contracts.origin.domain.namespaces[subject.namespaceId]?.enum?.[subject.enum]?.members ?? [];
  const renamedTo = new Set(
    resolvedRenames(contracts).flatMap((statement) =>
      statement.kind === 'rename' && statement.entity === 'enumValue' ? [statement.to.member] : [],
    ),
  );
  const added = (
    contracts.destination.domain.namespaces[value.namespaceId]?.enum?.[value.enum]?.members ?? []
  ).filter(
    ({ name }) => !renamedTo.has(name) && !originMembers.some((member) => member.name === name),
  );
  return added.length === 1 ? added[0]?.name : undefined;
}

/**
 * The field a value object field can only have been renamed to: the one field of the destination
 * value object that the origin one does not have and no rename of the plan names.
 */
function onlyNewValueObjectField(
  subject: ValueObjectFieldCoordinate,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): string | undefined {
  const field = renamedValueObjectField(subject, contracts) ?? subject;
  const originFields = valueObjectFields(contracts.origin, subject) ?? [];
  const renamedTo = new Set(
    resolvedRenames(contracts).flatMap((statement) =>
      statement.kind === 'rename' && statement.entity === 'valueObjectField'
        ? [statement.to.field]
        : [],
    ),
  );
  const added = (valueObjectFields(contracts.destination, field) ?? []).filter(
    (name) => !renamedTo.has(name) && !originFields.includes(name),
  );
  return added.length === 1 ? added[0] : undefined;
}

function renameForm(
  subject: MigrationSubject,
  text: string,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): string {
  if (subject.kind === 'model' || subject.kind === 'storage') return `${text}:<new name>`;
  const parent = text.slice(0, text.lastIndexOf('.'));
  const only =
    subject.kind === 'enumValue'
      ? onlyNewMember(subject, contracts)
      : subject.kind === 'valueObjectField'
        ? onlyNewValueObjectField(subject, contracts)
        : undefined;
  return `${text}:${parent}.${only ?? '<new name>'}`;
}

/** The labels of the operations a question is about, as one phrase. */
export function labelsText(labels: readonly string[]): string {
  const [first, ...rest] = [...new Set(labels)];
  const lowered = rest.map((label) => label.charAt(0).toLowerCase() + label.slice(1));
  const all = [first ?? '', ...lowered];
  return all.length === 1 ? all.join('') : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}

/** Whether a rename statement of the plan already gives the subject a new name. */
function renamedByPlan(subject: MigrationSubject, contracts: StatementContracts): boolean {
  if (subject.kind === 'storage') return false;
  return resolvedRenames(contracts).some((statement) => sameCoordinate(statement, subject));
}

/** Whether the destination still has the subject's model or field, under the name a rename gives it. */
function inDestination(
  subject: MigrationSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): boolean {
  if (subject.kind === 'storage') return false;
  if (subject.kind === 'enumValue') {
    const value = renamedEnumValue(subject, contracts) ?? subject;
    const destinationEnum =
      contracts.destination.domain.namespaces[value.namespaceId]?.enum?.[value.enum];
    return destinationEnum?.members.some(({ name }) => name === subject.member) === true;
  }
  if (subject.kind === 'valueObjectField') {
    const field = renamedValueObjectField(subject, contracts) ?? subject;
    return valueObjectFields(contracts.destination, field)?.includes(subject.field) === true;
  }
  const model = renamedModel(subject, contracts) ?? subject;
  const destinationModel =
    contracts.destination.domain.namespaces[model.namespaceId]?.models[model.model];
  if (destinationModel === undefined) return false;
  return subject.kind === 'model' || Object.hasOwn(destinationModel.fields, subject.field);
}

/** Checks a statement typed at a question against the plan's other statements. */
function resolvesWith(
  statement: StatementText,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): Result<ResolvedMigrationStatement | undefined, string> {
  const resolved = resolveStatements({
    statements: [...contracts.statements, statement],
    origin: { kind: 'contract', contract: contracts.origin },
    destination: contracts.destination,
  });
  if (!resolved.ok)
    return notOk(`${resolved.failure.message}. ${resolved.failure.why ?? ''}`.trim());
  return ok(resolved.value.at(-1));
}

type DataLossContracts = StatementContracts & {
  readonly destination: ContractWithDomain;
  readonly originKnown: boolean;
  /** Whether the command writes a migration whose conversion the user fills in. */
  readonly canConvert: boolean;
  /** The command's words for the edits that keep a subject's data; none when it gives none. */
  readonly keepDataEditAdvice?: KeepDataEditAdvice;
  /** The subjects of the round's questions that carry edits that keep their data. */
  readonly keptSubjects?: readonly string[];
};

/** What a command says of keeping a subject's data: why its answer loses it, if anything, and each way to keep it. */
export interface KeepDataAdvice {
  readonly lead: string | undefined;
  readonly ways: readonly string[];
}

/**
 * How a command says to make `edits` to keep the data of the subject `subject`. `others` are the
 * other subjects asked about with edits of their own, whose data a plan keeps together with it.
 */
export type KeepDataEditAdvice = (
  subject: string,
  edits: readonly KeepDataEdit[],
  others: readonly string[],
) => KeepDataAdvice;

/**
 * The model of a field subject, under the name a rename of the plan gives it, when the destination
 * has no model of that name: a rename of the field cannot be written until a statement renames the
 * model.
 */
function missingFieldModel(
  subject: MigrationSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): ModelCoordinate | undefined {
  if (subject.kind !== 'field') return undefined;
  const model = renamedModel(subject, contracts) ?? subject;
  return contracts.destination.domain.namespaces[model.namespaceId]?.models[model.model] ===
    undefined
    ? model
    : undefined;
}

/**
 * The variant a model subject is in the destination, under the name a rename of the plan gives it,
 * when it is a variant in both contracts whose discriminator value changed: a convert rewrites its
 * stored value instead of deleting its rows.
 */
function changedVariant(
  subject: MigrationSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): ModelCoordinate | undefined {
  if (subject.kind !== 'model') return undefined;
  const model = renamedModel(subject, contracts) ?? subject;
  return variantValueChanged(contracts.origin, subject, contracts.destination, model)
    ? model
    : undefined;
}

/**
 * The question for one operation that would lose data. A field whose type changes may be converted
 * where the command writes a migration to fill in; the convert names the field as the destination
 * names it. A variant whose discriminator value changed may be converted by any command, since
 * the convert needs no code the user writes. A model or field the destination no longer has, and no rename of the plan renamed, may
 * be renamed instead of deleted; a rename is resolved against the two contracts after the plan's
 * other renames, and its old name must be the subject. Anything else, and data no model stores,
 * can only be deleted. A field whose model the destination names differently can be renamed only
 * after a statement renames the model, so the question says to pass one. The question ends with
 * the planner's advice on keeping the data, when it gives any.
 */
export function dataLossQuestion(
  loss: PlannedDataLoss,
  contracts: DataLossContracts,
  edits: readonly KeepDataEdit[] = [],
  labels: readonly string[] = [loss.label],
): PlanQuestion {
  const subject = subjectText(loss.subject, contracts);
  const deleteNames = namesSubject('delete', subject);
  const missingModel = missingFieldModel(loss.subject, contracts);
  const keepData =
    edits.length === 0 || contracts.keepDataEditAdvice === undefined
      ? undefined
      : contracts.keepDataEditAdvice(
          subject,
          edits,
          (contracts.keptSubjects ?? []).filter((other) => other !== subject),
        );
  const question = [
    `${labelsText(labels)} ${lossText(loss.subject, subject, contracts.originKnown, loss.loss)}.`,
    ...(missingModel === undefined ? [] : [modelRenameAdvice(missingModel, contracts)]),
    ...(loss.keepDataAdvice === undefined ? [] : [loss.keepDataAdvice]),
    ...(keepData?.lead === undefined ? [] : [keepData.lead]),
    ...(keepData?.ways ?? []),
  ].join(' ');
  if (loss.loss === 'typeChange' && loss.subject.kind === 'field') {
    if (!contracts.canConvert) {
      return {
        question,
        ...ifDefined('keepDataWays', keepData?.ways),
        subject,
        verbs: ['delete'],
        forms: {},
        validate: (_verb, text) => deleteNames(text),
      };
    }
    const field = destinationField(loss.subject, contracts);
    const convert = fieldStatementText(contracts.destination, field);
    return {
      question,
      ...ifDefined('keepDataWays', keepData?.ways),
      subject,
      verbs: ['convert', 'delete'],
      forms: { convert },
      validate: (verb, text) => {
        if (verb !== 'convert') return deleteNames(text);
        if (text !== convert) {
          return `convert names the field as the destination contract names it: ${statementFlag({ verb: 'convert', text: convert })}.`;
        }
        const resolved = resolvesWith({ verb: 'convert', text }, contracts);
        return resolved.ok ? undefined : resolved.failure;
      },
    };
  }
  const variant = changedVariant(loss.subject, contracts);
  if (variant !== undefined) {
    const convert = modelStatementText(contracts.destination, variant);
    return {
      question,
      ...ifDefined('keepDataWays', keepData?.ways),
      subject,
      verbs: ['convert', 'delete'],
      forms: { convert },
      validate: (verb, text) => {
        if (verb !== 'convert') return deleteNames(text);
        if (text !== convert) {
          return `convert names the variant as the destination contract names it: ${statementFlag({ verb: 'convert', text: convert })}.`;
        }
        const resolved = resolvesWith({ verb: 'convert', text }, contracts);
        return resolved.ok ? undefined : resolved.failure;
      },
    };
  }
  const renamable =
    missingModel === undefined &&
    loss.subject.kind !== 'storage' &&
    !inDestination(loss.subject, contracts) &&
    !renamedByPlan(loss.subject, contracts);
  return {
    question,
    ...ifDefined('keepDataWays', keepData?.ways),
    subject,
    verbs: renamable ? ['rename', 'delete'] : ['delete'],
    forms: renamable ? { rename: renameForm(loss.subject, subject, contracts) } : {},
    validate: (verb, text) => {
      if (verb !== 'rename') return deleteNames(text);
      const resolved = resolvesWith({ verb: 'rename', text }, contracts);
      if (!resolved.ok) return resolved.failure;
      return resolved.value !== undefined && sameCoordinate(resolved.value, loss.subject)
        ? undefined
        : `The rename's old name is not "${subject}". Write it as ${renameForm(loss.subject, subject, contracts)}.`;
    },
  };
}

/**
 * The question for one operation that changes who can read or write its subject's data: it widens
 * access, or changes it in a way that can go either way. Each such operation is its own question,
 * answered by its own `allow`.
 */
export function accessChangeQuestion(
  change: PlannedAccessChange,
  contracts: StatementContracts,
): PlanQuestion {
  const subject = subjectText(change.subject, contracts);
  return {
    question: `${change.label} would ${change.widens ? 'widen' : 'change'} who can read and write its data.`,
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
  /** How the operations a `delete` answered lose the data; `undefined` for an `allow`. */
  readonly loss: MigrationDataLossKind | undefined;
}

const keyOf = (planned: PlannedSubject) => migrationSubjectKey(planned.subject);

/**
 * The namespace of the model or field a subject names, when the planner removes that namespace: a
 * `delete` of the namespace answers the question too.
 */
export function removedNamespaceOf(
  subject: MigrationSubject,
  namespaces: MigrationPlanNamespaces | undefined,
): string | undefined {
  if (subject.kind === 'storage') return undefined;
  return namespaces?.removed.includes(subject.namespaceId) === true
    ? subject.namespaceId
    : undefined;
}

/** A question as a consent statement can answer it: by its subject, or by a namespace the planner removes. */
export interface ConsentQuestion {
  readonly text: string;
  readonly removedNamespace: string | undefined;
}

/**
 * A `delete` answers for its subject; an `allow` for its one operation, known by its label and
 * subject, since a re-plan moves every operation's position.
 */
function questionKey(verb: ConsentVerb, entry: PlannedSubject): string {
  return verb === 'allow' ? `allow:${entry.label}:${keyOf(entry)}` : `delete:${keyOf(entry)}`;
}

function checkAnswers(
  questions: readonly PlanQuestion[],
  answers: readonly (PlanAnswer | undefined)[],
): void {
  const plansAgain = answers.some(
    (answer) => answer?.verb === 'rename' || answer?.verb === 'convert',
  );
  const open = answers.findIndex((answer) => answer === undefined);
  if (open !== -1 && !plansAgain) {
    throw new InternalError(
      `answerQuestions left "${questions[open]?.question}" open, which it may do only beside a rename or convert answer that plans again.`,
      { cause: { questions: questions.map(({ subject }) => subject), answers } },
    );
  }
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

function namespaceRenameAdvice(removed: string, added: readonly string[]): string | undefined {
  const [only] = added;
  if (only === undefined) return undefined;
  const lead = `If namespace "${removed}" was renamed, --rename ${removed}:`;
  if (added.length === 1) return `${lead}${only} renames it instead.`;
  const choices = `${added.slice(0, -1).join(', ')} or ${added.at(-1)}`;
  return `${lead}<new namespace> renames it instead, where <new namespace> is ${choices}.`;
}

/**
 * The first question about a model or field of a namespace the destination contract no longer has
 * says that a `delete` of the namespace answers every question about it, and, when the destination
 * adds a namespace, how to rename the namespace instead.
 */
function withNamespaceDeleteOnFirstQuestion(
  questions: readonly PlanQuestion[],
  added: readonly string[],
): readonly PlanQuestion[] {
  const told = new Set<string>();
  return questions.map((question) => {
    const { removedNamespace } = question;
    if (removedNamespace === undefined || told.has(removedNamespace)) return question;
    told.add(removedNamespace);
    const lines = [
      question.question,
      `--delete ${removedNamespace} answers this question and every other about a model or field of namespace "${removedNamespace}", which the destination contract no longer has.`,
      namespaceRenameAdvice(removedNamespace, added),
    ];
    return { ...question, question: lines.filter((line) => line !== undefined).join('\n') };
  });
}

/**
 * A question about a model or field of a namespace the destination removed, which also accepts the
 * namespace's own answers: a `delete` of the namespace, or a `rename` of it to another one.
 */
function acceptingNamespaceAnswers(
  question: PlanQuestion,
  removedNamespace: string | undefined,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): PlanQuestion {
  if (removedNamespace === undefined) return question;
  const namespaceAnswer = (verb: PlanQuestionVerb, text: string): NamespaceAnswer | undefined => {
    if (verb === 'delete') return text === removedNamespace ? 'delete' : undefined;
    if (verb !== 'rename') return undefined;
    const resolved = resolvesWith({ verb, text }, contracts);
    return resolved.ok &&
      resolved.value?.kind === 'rename' &&
      resolved.value.entity === 'namespace' &&
      resolved.value.from === removedNamespace
      ? 'rename'
      : undefined;
  };
  return {
    ...question,
    removedNamespace,
    namespaceAnswer,
    validate: (verb, text) =>
      namespaceAnswer(verb, text) !== undefined ? undefined : question.validate(verb, text),
  };
}

function withRecoveryOnFirstStorageQuestion(
  asked: readonly { readonly loss: PlannedDataLoss; readonly question: PlanQuestion }[],
  recoveryApplies: boolean,
): readonly PlanQuestion[] {
  const first = recoveryApplies
    ? asked.findIndex(({ loss }) => loss.subject.kind === 'storage')
    : -1;
  return asked.map(({ question }, index) =>
    index === first
      ? { ...question, question: `${question.question}\n${ORIGIN_SNAPSHOT_RECOVERY}` }
      : question,
  );
}

/**
 * Asks about every operation of a plan that would lose data and, when `askAccess`, every one that
 * would change access, until each is answered. A `delete` or `allow` text in `preAnswers`, or
 * `consentAll` for its verb, answers its question without asking. A rename or convert typed at the
 * prompt is a statement the plan did not have, so the plan is made again with every statement, and
 * the operation it answered must be gone; a loss the new plan has on the same subject, such as a
 * type change on the renamed field, is asked in the next round. The first round asks even when
 * nothing is in question, so a statement no question consumed is refused before anything is done.
 */
export async function askPlanQuestions<TPlan extends PlannedQuestions, TFailure>(input: {
  readonly plan: TPlan;
  readonly askAccess: boolean;
  /** Whether a type change may be answered with `convert`: the command writes a migration to fill in. */
  readonly canConvert: boolean;
  /** The rename, convert and backfill statements the plan carries out, in the order given. */
  readonly statements: readonly StatementText[];
  readonly preAnswers: readonly StatementText[];
  readonly consentAll: { readonly [verb in ConsentVerb]: boolean };
  readonly origin: ContractWithDomain;
  readonly originKnown: boolean;
  readonly destination: ContractWithDomain;
  readonly answer: AnswerPlanQuestions;
  readonly replan: (statements: readonly StatementText[]) => Promise<Result<TPlan, TFailure>>;
  /** The command's words for the edits that keep a subject's data. */
  readonly keepDataEditAdvice?: KeepDataEditAdvice;
}): Promise<
  Result<
    {
      readonly plan: TPlan;
      readonly statements: readonly StatementText[];
      readonly consented: readonly ConsentedSubject[];
    },
    TFailure | CliStructuredError
  >
> {
  let plan = input.plan;
  let statements = input.statements;
  const consented = new Map<string, ConsentedSubject>();
  const usedPreAnswers = new Set<StatementText>();
  for (let round = 0; ; round += 1) {
    const contracts = {
      origin: input.origin,
      originKnown: input.originKnown,
      destination: input.destination,
      canConvert: input.canConvert,
      statements,
      ...ifDefined('keepDataEditAdvice', input.keepDataEditAdvice),
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
    const consent = (verb: ConsentVerb, entry: PlannedSubject | PlannedDataLoss, text: string) =>
      consented.set(questionKey(verb, entry), {
        verb,
        subject: entry.subject,
        text,
        operationIndex: entry.operationIndex,
        loss: verb === 'delete' && 'loss' in entry ? entry.loss : undefined,
      });
    for (const [verb, entries] of [
      ['delete', pending('delete', plan.dataLoss)],
      ['allow', input.askAccess ? pending('allow', plan.accessChanges) : []],
    ] as const) {
      const texts = entries.map((entry) => subjectText(entry.subject, contracts));
      const given = input.preAnswers.filter(
        (statement) =>
          statement.verb === verb && (verb === 'delete' || !usedPreAnswers.has(statement)),
      );
      const matched = matchConsents(
        verb,
        entries.map((entry, index) => ({
          text: texts[index] ?? '',
          removedNamespace: removedNamespaceOf(entry.subject, plan.namespaces),
        })),
        given.map(({ text }) => text),
      );
      for (const position of matched.used) {
        const statement = given[position];
        if (statement !== undefined) usedPreAnswers.add(statement);
      }
      entries.forEach((entry, index) => {
        if (input.consentAll[verb] || matched.answered.has(index)) {
          consent(verb, entry, texts[index] ?? '');
        }
      });
    }
    const losses = pending('delete', plan.dataLoss);
    const sameSubject = (loss: PlannedDataLoss) =>
      plan.dataLoss.filter((entry) => questionKey('delete', entry) === questionKey('delete', loss));
    const roundContracts = {
      ...contracts,
      keptSubjects: losses
        .filter((loss) => sameSubject(loss).some(({ keepDataEdit }) => keepDataEdit !== undefined))
        .map((loss) => subjectText(loss.subject, contracts)),
    };
    const accessChanges = input.askAccess ? pending('allow', plan.accessChanges) : [];
    if (losses.length + accessChanges.length === 0 && round > 0) break;
    const questions = [
      ...withNamespaceDeleteOnFirstQuestion(
        withRecoveryOnFirstStorageQuestion(
          losses.map((loss) => ({
            loss,
            question: acceptingNamespaceAnswers(
              dataLossQuestion(
                loss,
                roundContracts,
                sameSubject(loss).flatMap((entry) =>
                  entry.keepDataEdit === undefined ? [] : [entry.keepDataEdit],
                ),
                loss.subject.kind === 'enumValue' || loss.subject.kind === 'valueObjectField'
                  ? sameSubject(loss).map(({ label }) => label)
                  : [loss.label],
              ),
              removedNamespaceOf(loss.subject, plan.namespaces),
              contracts,
            ),
          })),
          !input.originKnown,
        ),
        plan.namespaces?.added ?? [],
      ),
      ...accessChanges.map((change) => accessChangeQuestion(change, contracts)),
    ];
    const answers = await input.answer(questions);
    checkAnswers(questions, answers);
    const typed: {
      readonly statement: StatementText;
      readonly loss: PlannedSubject;
      readonly ofNamespace: boolean;
    }[] = [];
    answers.forEach((answer, index) => {
      const entry = [...losses, ...accessChanges][index];
      const question = questions[index];
      if (answer === undefined || entry === undefined || question === undefined) return;
      if (answer.verb === 'rename' || answer.verb === 'convert') {
        typed.push({
          statement: { verb: answer.verb, text: answer.text },
          loss: entry,
          ofNamespace: question.namespaceAnswer?.(answer.verb, answer.text) === 'rename',
        });
      } else consent(answer.verb, entry, question.subject);
    });
    if (typed.length === 0) {
      if (losses.length + accessChanges.length === 0) break;
      continue;
    }
    const given = new Set(statements.map(({ verb, text }) => `${verb} ${text}`));
    for (const { statement } of typed) {
      const key = `${statement.verb} ${statement.text}`;
      if (given.has(key)) continue;
      given.add(key);
      statements = [...statements, statement];
    }
    const replanned = await input.replan(statements);
    if (!replanned.ok) return replanned;
    plan = replanned.value;
    for (const entry of plan.accessChanges) {
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
    const unresolved = typed.find(
      ({ loss, ofNamespace }) => !ofNamespace && stillPlanned.has(operationOf(loss)),
    );
    if (unresolved !== undefined) {
      return notOk(
        errorStatementDidNotResolveLoss(
          unresolved.statement,
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
        questionSubjects(plan, input.askAccess, { ...input, statements }),
      ),
    );
  }
  return ok({ plan, statements, consented: [...consented.values()] });
}

function questionSubjects(
  plan: PlannedQuestions,
  askAccess: boolean,
  contracts: StatementContracts,
): readonly string[] {
  const subjects = [...plan.dataLoss, ...(askAccess ? plan.accessChanges : [])].map((entry) =>
    subjectText(entry.subject, contracts),
  );
  return [...new Set(subjects)];
}

/**
 * Refuses the `delete` and `allow` statements that name no subject a plan asks about, without
 * asking anything: a run that only plans still says which statements would consent to nothing.
 * The plan carries out its other statements, so they are not checked here.
 */
export function refuseUnusedConsents(input: {
  readonly plan: PlannedQuestions;
  readonly statements: readonly StatementText[];
  readonly contracts: StatementContracts;
}): Result<void, CliStructuredError> {
  const subjects = questionSubjects(input.plan, true, input.contracts);
  const unused: UnusedConsent[] = [];
  for (const [verb, entries] of [
    ['delete', input.plan.dataLoss],
    ['allow', input.plan.accessChanges],
  ] as const) {
    const questions = entries.map((entry) => ({
      text: subjectText(entry.subject, input.contracts),
      removedNamespace:
        verb === 'delete' ? removedNamespaceOf(entry.subject, input.plan.namespaces) : undefined,
    }));
    const given = input.statements.filter((statement) => statement.verb === verb);
    unused.push(
      ...matchConsents(
        verb,
        verb === 'delete' ? [...new Map(questions.map((q) => [q.text, q])).values()] : questions,
        given.map(({ text }) => text),
      ).unused,
    );
  }
  const answersNothing = unused.filter(({ alreadyAnsweredBy }) => alreadyAnsweredBy === undefined);
  if (answersNothing.length > 0) {
    return notOk(errorStatementAnswersNoQuestion(answersNothing, subjects));
  }
  return unused.length === 0 ? ok(undefined) : notOk(errorConsentUnused(unused, subjects));
}

/**
 * The subjects the `delete` and `allow` flags a run was given consent to, or every subject of a
 * verb `consentAll` names: what an apply would consent to without asking, which a dry run reports.
 */
export function givenConsents(input: {
  readonly plan: PlannedQuestions;
  readonly statements: readonly StatementText[];
  readonly consentAll: { readonly [verb in ConsentVerb]: boolean };
  readonly contracts: StatementContracts;
}): readonly ConsentedSubject[] {
  const consented: ConsentedSubject[] = [];
  for (const [verb, planned] of [
    ['delete', input.plan.dataLoss],
    ['allow', input.plan.accessChanges],
  ] as const) {
    const entries: readonly (PlannedSubject | PlannedDataLoss)[] = [
      ...new Map(planned.map((entry) => [questionKey(verb, entry), entry])).values(),
    ];
    const texts = entries.map((entry) => subjectText(entry.subject, input.contracts));
    const matched = matchConsents(
      verb,
      entries.map((entry, index) => ({
        text: texts[index] ?? '',
        removedNamespace: removedNamespaceOf(entry.subject, input.plan.namespaces),
      })),
      input.statements.filter((statement) => statement.verb === verb).map(({ text }) => text),
    );
    entries.forEach((entry, index) => {
      if (!input.consentAll[verb] && !matched.answered.has(index)) return;
      consented.push({
        verb,
        subject: entry.subject,
        text: texts[index] ?? '',
        operationIndex: entry.operationIndex,
        loss: verb === 'delete' && 'loss' in entry ? entry.loss : undefined,
      });
    });
  }
  return consented;
}

/** Which question each consent flag answered, by position, and the flags no question took. */
export interface ConsentMatch {
  /** The flag text that answers each question, by the question's position. */
  readonly answered: ReadonlyMap<number, string>;
  /** The positions of the flags some question took. */
  readonly used: ReadonlySet<number>;
  readonly unused: readonly UnusedConsent[];
}

/**
 * Matches `--delete` or `--allow` flags to questions as an apply does, whatever their order. A
 * `delete` naming a subject answers every question about it; then a `delete` naming a removed
 * namespace answers the questions of the namespace still open. An `allow` answers one operation,
 * so each question takes a flag of its own. A flag no question took is unused, and says what had
 * already answered its question, if anything had. Every path that matches consent flags asks this,
 * so a dry run and an apply refuse the same flags.
 */
export function matchConsents(
  verb: ConsentVerb,
  questions: readonly ConsentQuestion[],
  texts: readonly string[],
): ConsentMatch {
  const answered = new Map<number, string>();
  const used = new Set<number>();
  const take = (index: number, position: number) => {
    const text = texts[position];
    if (text === undefined) return;
    answered.set(index, text);
    used.add(position);
  };
  questions.forEach((question, index) => {
    const position = texts.findIndex(
      (text, at) => text === question.text && (verb === 'delete' || !used.has(at)),
    );
    if (position !== -1) take(index, position);
  });
  if (verb === 'delete') {
    questions.forEach((question, index) => {
      if (answered.has(index) || question.removedNamespace === undefined) return;
      const position = texts.indexOf(question.removedNamespace);
      if (position !== -1) take(index, position);
    });
  }
  const unused = texts.flatMap((text, position): UnusedConsent[] => {
    if (used.has(position)) return [];
    const subject = questions.find((question) => question.text === text);
    return [
      {
        verb,
        text,
        alreadyAnsweredBy:
          subject !== undefined
            ? { kind: 'subject', subject: text, flag: { verb, text } }
            : questions.some(({ removedNamespace }) => removedNamespace === text)
              ? { kind: 'namespace', namespace: text }
              : undefined,
      },
    ];
  });
  return { answered, used, unused };
}
