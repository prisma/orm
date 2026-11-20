import { asNamespaceId, type ContractWithDomain, valueObjectAt } from '@internal/contract/types';
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
import {
  asVariantOf,
  EMIT_COMMAND,
  missingNameReason,
  nameHadBeforeReason,
  renamedOnlyWithBase,
  runAgain,
  type VariantBase,
} from './missing-new-name';
import type { ConsentVerb } from './parse-consent';
import type {
  KeepDataWay,
  QuestionAnswer,
  QuestionParts,
  RemovedNamespaceParts,
} from './plan-question-text';
import {
  type ContractsAndRenames,
  enumMembers,
  enumValueAfterRenames,
  modelAfterRenames,
  namespaceAfterRenames,
  newModelFields,
  newModels,
  newValueObjectFields,
  possibleNewNames,
  sameModel,
  valueObjectFieldAfterRenames,
  valueObjectFields,
  variantBaseAfterRenames,
} from './possible-new-names';
import { resolveStatements } from './resolve-statements';
import { statementFlag } from './statement-flag';
import { ENTITY_WORDS, type StatementText } from './statement-text';
import { variantValue, variantValueChanged } from './variants';

/** A verb a plan question accepts. */
export type PlanQuestionVerb = 'rename' | 'convert' | ConsentVerb;

/**
 * What a command asks about one subject of a plan: the parts its prompt and its refusal are built
 * from, its subject written as a flag names it, and the verbs that answer it, which come from its
 * answers. A command hands it to its prompt.
 */
export interface PlanQuestion extends QuestionParts {
  readonly subject: string;
  /** The namespace of a data-loss question's model or field when the contract no longer has it: a `delete` of it answers the question too. */
  readonly removedNamespace?: string;
  readonly verbs: readonly PlanQuestionVerb[];
  readonly forms: { readonly rename?: string; readonly convert?: string };
  readonly validate: (verb: PlanQuestionVerb, text: string) => string | undefined;
  /**
   * Whether an answer is the removed namespace's own, a `delete` or a `rename` of the namespace,
   * which answers its other questions too; `undefined` for any other answer.
   */
  readonly namespaceAnswer?: (verb: PlanQuestionVerb, text: string) => NamespaceAnswer | undefined;
}

const VERB_ORDER: readonly PlanQuestionVerb[] = ['rename', 'convert', 'delete', 'allow'];

function isQuestionVerb(verb: string): verb is PlanQuestionVerb {
  return verb === 'rename' || verb === 'convert' || verb === 'delete' || verb === 'allow';
}

/** A question whose verbs and forms are those of its answers. */
export function planQuestion(parts: Omit<PlanQuestion, 'verbs' | 'forms'>): PlanQuestion {
  const verbs = [...new Set(parts.answers.map(({ flag }) => flag.verb).filter(isQuestionVerb))];
  const formOf = (verb: 'rename' | 'convert') =>
    parts.answers.find(({ flag }) => flag.verb === verb)?.flag.text;
  return {
    ...parts,
    verbs,
    forms: {
      ...ifDefined('rename', formOf('rename')),
      ...ifDefined('convert', formOf('convert')),
    },
  };
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
  answeredWithoutAsking?: readonly AnsweredWithoutAsking[],
) => Promise<readonly (PlanAnswer | undefined)[]>;

/**
 * A subject a run answered without asking, because `consentAll` covers its verb: a consent flag
 * the user gave for it anyway is used, not unused.
 */
export interface AnsweredWithoutAsking {
  readonly verb: ConsentVerb;
  readonly subject: string;
  readonly removedNamespace?: string;
}

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
  /** The fields the plan gives a temporary value, in the destination contract. */
  readonly temporaryValues: readonly { readonly subject: MigrationSubject }[];
}

/** The contracts a statement names things in, and the statements the plan carries out so far. */
export interface StatementContracts {
  readonly origin: ContractWithDomain;
  /** The destination contract; needed only to name a field of a renamed model. */
  readonly destination?: ContractWithDomain;
  /** The rename, convert and backfill statements the plan carries out, in the order given. */
  readonly statements: readonly StatementText[];
  /** The `--to` value the command plans to, when its destination is a stored contract and not the emitted one. */
  readonly destinationRef?: string;
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

function contractsAndRenames(
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): ContractsAndRenames {
  return {
    origin: contracts.origin,
    destination: contracts.destination,
    renames: resolvedRenames(contracts),
  };
}

function renamedModel(
  coordinate: ModelCoordinate,
  contracts: StatementContracts,
): ModelCoordinate | undefined {
  return modelAfterRenames(coordinate, resolvedRenames(contracts), contracts.destination);
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

function renamedEnumValue(
  value: EnumValueCoordinate,
  contracts: StatementContracts,
): EnumValueCoordinate | undefined {
  return enumValueAfterRenames(value, resolvedRenames(contracts), contracts.destination);
}

function renamedValueObjectField(
  field: ValueObjectFieldCoordinate,
  contracts: StatementContracts,
): ValueObjectFieldCoordinate | undefined {
  return valueObjectFieldAfterRenames(field, resolvedRenames(contracts), contracts.destination);
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

/** How a question's subject loses its data: the contract no longer has it, its data goes although the contract may still have it, or its values are cast to a new type. */
type LossKind = 'removed' | 'deleted' | 'retyped';

function lossKind(loss: PlannedDataLoss, contracts: DataLossContracts): LossKind {
  const { subject } = loss;
  if (loss.loss === 'typeChange') {
    if (subject.kind === 'field' || subject.kind === 'storage') return 'retyped';
    throw new InternalError(
      `A plan reported a type change of a ${ENTITY_WORDS[subject.kind]}, which the CLI has no words for.`,
      { cause: { subject } },
    );
  }
  return knownRemoved(subject, contracts) ? 'removed' : 'deleted';
}

function renamedNamespace(namespaceId: string, contracts: StatementContracts): string | undefined {
  return namespaceAfterRenames(namespaceId, resolvedRenames(contracts));
}

/**
 * Whether the contract is known to no longer have the subject: it still has the model, enum, value
 * object or namespace the subject was in, under the name a rename of the plan gives it, but not the
 * subject, and no rename of the plan names the subject. When only the place the subject was in is
 * missing, the subject may have moved with it.
 */
function knownRemoved(subject: MigrationSubject, contracts: DataLossContracts): boolean {
  if (subject.kind === 'storage') return false;
  if (inDestination(subject, contracts) || renamedByPlan(subject, contracts)) return false;
  const namespaces = contracts.destination.domain.namespaces;
  switch (subject.kind) {
    case 'model': {
      const namespaceId = renamedNamespace(subject.namespaceId, contracts) ?? subject.namespaceId;
      return Object.hasOwn(namespaces, namespaceId);
    }
    case 'field':
      return missingFieldModel(subject, contracts) === undefined;
    case 'enumValue': {
      const value = renamedEnumValue(subject, contracts) ?? subject;
      return namespaces[value.namespaceId]?.enum?.[value.enum] !== undefined;
    }
    case 'valueObjectField': {
      const field = renamedValueObjectField(subject, contracts) ?? subject;
      return valueObjectFields(contracts.destination, field) !== undefined;
    }
  }
}

/** The stored value an enum value had and has, when the contract keeps the member with a new stored value. */
function storedValueChange(
  subject: EnumValueCoordinate,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): { readonly from: string; readonly to: string } | undefined {
  const value = renamedEnumValue(subject, contracts) ?? subject;
  const from = enumMembers(contracts.origin, subject).find(
    ({ name }) => name === subject.member,
  )?.value;
  const to = enumMembers(contracts.destination, value).find(
    ({ name }) => name === subject.member,
  )?.value;
  return from === undefined || to === undefined || sameStoredValue(from, to)
    ? undefined
    : { from: JSON.stringify(from), to: JSON.stringify(to) };
}

/** What the change would do to the subject's data, in the words of the user's contract. */
function lossHeadline(
  loss: PlannedDataLoss,
  kind: LossKind,
  text: string,
  contracts: DataLossContracts,
): string {
  const { subject } = loss;
  if (subject.kind === 'storage') {
    const named = contracts.originKnown
      ? 'which no model of the contract before this change stores'
      : 'named by its storage name because the contract before this change is not known';
    return kind === 'retyped'
      ? `Changing the type of "${text}", ${named}, can change or lose its values.`
      : `This change would delete the data in "${text}", ${named}.`;
  }
  if (kind === 'retyped')
    return `Changing the type of field "${text}" can change or lose its values.`;
  const removed = kind === 'removed';
  switch (subject.kind) {
    case 'model': {
      if (removed) return `Removing model "${text}" would delete its data.`;
      const variant = changedVariant(subject, contracts);
      if (variant === undefined) return `This change would delete the data of model "${text}".`;
      const from = JSON.stringify(variantValue(contracts.origin, subject));
      const to = JSON.stringify(variantValue(contracts.destination, variant));
      return `Changing the discriminator value of model "${text}" from ${from} to ${to} would delete its data.`;
    }
    case 'field':
      return removed
        ? `Removing field "${text}" would delete its values.`
        : `This change would delete the values of field "${text}".`;
    case 'enumValue': {
      if (removed)
        return `Removing enum value "${text}" would remove it from the data that holds it.`;
      const change = storedValueChange(subject, contracts);
      if (change !== undefined) {
        return `Changing the stored value of enum value "${text}" from ${change.from} to ${change.to} would remove ${change.from} from the data that holds it.`;
      }
      return inDestination(subject, contracts)
        ? `This change would remove the stored value of enum value "${text}" from the data that holds it.`
        : `This change would remove enum value "${text}" from the data that holds it.`;
    }
    case 'valueObjectField':
      return removed
        ? `Removing value object field "${text}" would delete its values.`
        : `This change would delete the values of value object field "${text}".`;
  }
}

/** The subject as the answers name it beside other questions: `field "User.age"`, or `"public.user.age"` for storage. */
function namedSubject(subject: MigrationSubject, text: string): string {
  return subject.kind === 'storage' ? `"${text}"` : `${ENTITY_WORDS[subject.kind]} "${text}"`;
}

const KEEP_BY_EDITING = ', or to keep the data by editing migration.ts as above';

/**
 * The `--delete` of a question. `keptByEditing` when the command's way to keep the data gives this
 * same flag and then edits the migration.ts it writes, so the flag does not only let the data go.
 */
function deleteAnswer(
  loss: PlannedDataLoss,
  kind: LossKind,
  text: string,
  keptByEditing: boolean,
): QuestionAnswer {
  const flag = { verb: 'delete', text } as const;
  const named = namedSubject(loss.subject, text);
  if (kind === 'retyped') {
    return {
      flag,
      meaning: 'To let the database cast the values, which can change or lose some',
      meaningNamingSubject: `To let the database cast the values of ${named}, which can change or lose some`,
      promptMeaning: 'delete lets the database cast the values, which can change or lose some',
    };
  }
  const also = keptByEditing ? KEEP_BY_EDITING : '';
  switch (loss.subject.kind) {
    case 'model':
      return {
        flag,
        meaning: `If its data can go${also}`,
        meaningNamingSubject: `If the data of ${named} can go${also}`,
        promptMeaning: 'delete lets its data go',
      };
    case 'enumValue':
      return {
        flag,
        meaning: `If it can go from the data${also}`,
        meaningNamingSubject: `If ${named} can go from the data${also}`,
        promptMeaning: 'delete removes it from the data',
      };
    case 'storage':
      return {
        flag,
        meaning: `If the data can go${also}`,
        meaningNamingSubject: `If the data in ${named} can go${also}`,
        promptMeaning: 'delete lets the data go',
      };
    default:
      return {
        flag,
        meaning: `If the values can go${also}`,
        meaningNamingSubject: `If the values of ${named} can go${also}`,
        promptMeaning: 'delete lets the values go',
      };
  }
}

/** `"a"`, `"a" or "b"`, `"a", "b" or "c"`. */
function eitherOf(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return quoted.length < 2
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`;
}

/**
 * What a rename means, in a form a careful reader can follow: with the one new name the contract
 * can give the subject, with the names it can have and where to put the chosen one, or, when the
 * contract has none, that the contract must first have it under its new name.
 */
function renameMeaning(
  renamed: string,
  keep: string,
  newNames: readonly string[],
  placeholder: string,
  destinationRef: string | undefined,
  variantOf: VariantBase | undefined,
): string {
  const [only] = newNames;
  if (only !== undefined && newNames.length === 1)
    return `If ${renamed} was renamed to "${only}", ${keep}`;
  if (newNames.length > 1) {
    return `If ${renamed} was renamed to ${eitherOf(newNames)}, put that name in place of ${placeholder} to ${keep}`;
  }
  const add = `If ${renamed} was renamed, add it to the contract under its new name${asVariantOf(variantOf)} and run ${EMIT_COMMAND}`;
  return destinationRef === undefined
    ? `${add}; then ${keep}`
    : `${add}, then ${runAgain(destinationRef)}, and ${keep}`;
}

/** A rename as a flag writes it, and the names the contract can give the subject. */
interface RenameTarget {
  readonly form: string;
  readonly newNames: readonly string[];
}

function renameAnswer(
  subject: MigrationSubject,
  text: string,
  rename: RenameTarget,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): QuestionAnswer {
  const { destinationRef } = contracts;
  const variantOf = variantOfModel(subject, contracts);
  const kind = subject.kind === 'storage' ? 'data' : ENTITY_WORDS[subject.kind];
  const keep =
    subject.kind === 'model' || subject.kind === 'storage'
      ? 'keep its data'
      : subject.kind === 'enumValue'
        ? 'keep it in the data'
        : 'keep its values';
  const kept =
    subject.kind === 'model' || subject.kind === 'storage'
      ? 'keeps its data'
      : subject.kind === 'enumValue'
        ? 'keeps it in the data'
        : 'keeps the values';
  return {
    flag: { verb: 'rename', text: rename.form },
    meaning: renameMeaning(
      `the ${kind}`,
      keep,
      rename.newNames,
      NEW_NAME,
      destinationRef,
      variantOf,
    ),
    meaningNamingSubject: renameMeaning(
      namedSubject(subject, text),
      keep,
      rename.newNames,
      NEW_NAME,
      destinationRef,
      variantOf,
    ),
    promptMeaning:
      rename.newNames.length === 0
        ? `rename works only once the contract has the ${kind} under its new name${asVariantOf(variantOf)}: stop this command, add it to the contract, run ${EMIT_COMMAND}, and ${runAgain(destinationRef)}`
        : rename.newNames.length === 1
          ? `rename ${kept} under the new name`
          : `rename ${kept} under the new name, ${eitherOf(rename.newNames)}`,
  };
}

const NEW_NAME = '<new name>';

/** The base of a model subject that is a variant. */
function variantOfModel(
  subject: MigrationSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): VariantBase | undefined {
  return subject.kind === 'model'
    ? variantBaseAfterRenames(contractsAndRenames(contracts), subject)
    : undefined;
}

const SNAPSHOT_RECOVERY_WAY =
  'store a snapshot of the contract before this change, which is the contract the database was last updated to, then run this command again, and it gives the --rename to use.';

/**
 * How to keep the data of a storage subject that was renamed, when the contract before this change
 * is not known: store a snapshot of it, as `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` advises, and run the
 * command again, which then gives the rename. The refusal gives it once, on its first storage
 * subject.
 */
export const ORIGIN_SNAPSHOT_RECOVERY: readonly string[] = [
  `If it was renamed, keep its data: ${SNAPSHOT_RECOVERY_WAY}`,
  ...STORE_ORIGIN_SNAPSHOT_STEPS,
];

/** `ORIGIN_SNAPSHOT_RECOVERY` as ways to keep the data, naming the storage subjects it is for beside other questions. */
function originSnapshotRecovery(storage: readonly string[]): readonly KeepDataWay[] {
  const [first, ...steps] = ORIGIN_SNAPSHOT_RECOVERY;
  return [
    {
      text: first ?? '',
      textNamingSubjects: `If ${eitherOf(storage)} was renamed, keep its data: ${SNAPSHOT_RECOVERY_WAY}`,
      atPrompt: `If it was renamed, stop this command and keep its data: ${SNAPSHOT_RECOVERY_WAY}`,
    },
    ...steps.map((text) => ({ text })),
  ];
}

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
    text === subject ? undefined : `give it as ${statementFlag({ verb, text: subject })}.`;
}

/**
 * How to keep the values of a field whose model the contract does not have: say first that the model
 * was renamed, and the next run asks about the field again.
 */
function modelRenameWay(
  model: ModelCoordinate,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): KeepDataWay {
  const name = modelStatementText(contracts.origin, model);
  const newNames = newModels(model, contractsAndRenames(contracts)).map((each) =>
    modelStatementText(contracts.destination, each),
  );
  const [only] = newNames;
  const to = only !== undefined && newNames.length === 1 ? only : NEW_NAME;
  const flag = statementFlag({ verb: 'rename', text: `${name}:${to}` });
  const renamed = `If model "${name}" was renamed`;
  const variantOf = variantBaseAfterRenames(contractsAndRenames(contracts), model);
  if (variantOf?.kind === 'removed') return removedBaseWay(name, variantOf.base);
  const meaning = renameMeaning(
    `model "${name}"`,
    'say so first',
    newNames,
    NEW_NAME,
    contracts.destinationRef,
    variantOf,
  );
  return {
    text: `${meaning}: ${flag}`,
    atPrompt:
      newNames.length === 0
        ? `${renamed}, stop this command, add it to the contract under its new name${asVariantOf(variantOf)}, run ${EMIT_COMMAND}, and ${runAgain(contracts.destinationRef, flag)}.`
        : newNames.length === 1
          ? `${renamed} to "${only}", stop this command and run it again with ${flag}.`
          : `${renamed} to ${eitherOf(newNames)}, stop this command and run it again with ${flag}, putting that name in place of ${NEW_NAME}.`,
  };
}

/** That a variant whose base the change removes has no rename of its own to keep its data. */
function removedBaseWay(model: string, base: string): KeepDataWay {
  return { text: renamedOnlyWithBase(model, base) };
}

/** The plan's backfill statements, resolved; empty when they do not resolve. */
function resolvedBackfills(
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): readonly ResolvedMigrationStatement[] {
  if (!contracts.statements.some((statement) => statement.verb === 'backfill')) return [];
  const resolved = resolveStatements({
    statements: contracts.statements,
    origin: { kind: 'contract', contract: contracts.origin },
    destination: contracts.destination,
  });
  return resolved.ok ? resolved.value.filter((statement) => statement.kind === 'backfill') : [];
}

/** A rename as a flag writes it, with the new name when only one fits: a field's new name keeps the model, `User.nickname:User.<new name>`. */
function renameTarget(
  subject: MigrationSubject,
  text: string,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): RenameTarget {
  const newNames = possibleNewNames(subject, contractsAndRenames(contracts));
  const [only] = newNames;
  const parent =
    subject.kind === 'model' || subject.kind === 'storage'
      ? ''
      : `${text.slice(0, text.lastIndexOf('.'))}.`;
  const name = only !== undefined && newNames.length === 1 ? only : NEW_NAME;
  return { form: `${text}:${parent}${name}`, newNames };
}

function renameForm(
  subject: MigrationSubject,
  text: string,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): string {
  return renameTarget(subject, text, contracts).form;
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

/** Checks a flag typed at a question against the plan's other flags; a failure says why it does not fit. */
function resolvesWith(
  statement: StatementText,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): Result<ResolvedMigrationStatement | undefined, string> {
  const resolved = resolveStatements({
    statements: [...contracts.statements, statement],
    origin: { kind: 'contract', contract: contracts.origin },
    destination: contracts.destination,
    ...ifDefined('destinationRef', contracts.destinationRef),
  });
  if (!resolved.ok) return notOk(resolved.failure.why ?? resolved.failure.message);
  return ok(resolved.value.at(-1));
}

/** Each model of a contract, with the names a `--rename` can give it by. */
function modelNames(contract: ContractWithDomain): readonly {
  readonly coordinate: ModelCoordinate;
  readonly names: readonly string[];
}[] {
  return Object.entries(contract.domain.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.keys(namespace.models).map((model) => {
      const coordinate: ModelCoordinate = { namespaceId: asNamespaceId(namespaceId), model };
      return {
        coordinate,
        names: [model, `${namespaceId}.${model}`, modelStatementText(contract, coordinate)],
      };
    }),
  );
}

/**
 * Whether the contract before this change had the new name a rename gives: the field, enum value
 * or value object field beside the subject, or, for a model, the one model the name gives in the
 * contract, at the same place.
 */
function hadNameBefore(
  subject: Exclude<MigrationSubject, { readonly kind: 'storage' }>,
  name: string,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): boolean {
  if (subject.kind !== 'model') return namesBeside(subject, contracts.origin).includes(name);
  const [only, ...others] = modelNames(contracts.destination).filter(({ names }) =>
    names.includes(name),
  );
  if (only === undefined || others.length > 0) return false;
  const { namespaceId, model } = only.coordinate;
  return contracts.origin.domain.namespaces[namespaceId]?.models[model] !== undefined;
}

/** The names a contract has beside a subject, of the same kind and in the same model, enum, value object or contract, as a `--rename` writes them after the parent. */
function namesBeside(
  subject: Exclude<MigrationSubject, { readonly kind: 'storage' }>,
  contract: ContractWithDomain,
): readonly string[] {
  switch (subject.kind) {
    case 'model':
      return modelNames(contract).flatMap(({ names }) => names);
    case 'field': {
      const model = contract.domain.namespaces[subject.namespaceId]?.models[subject.model];
      return model === undefined
        ? []
        : [...Object.keys(model.fields), ...Object.keys(model.relations)];
    }
    case 'enumValue':
      return enumMembers(contract, subject).map(({ name }) => name);
    case 'valueObjectField':
      return valueObjectFields(contract, subject) ?? [];
  }
}

/**
 * Why a rename typed for `subject` names a new name that does not fit, in the CLI's words: the
 * contract has no such name, or had it before this change too. `undefined` leaves the rename to
 * the resolver, as for a new name in another model.
 */
function newNameProblem(
  subject: MigrationSubject,
  text: string,
  to: string,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): string | undefined {
  if (subject.kind === 'storage') return undefined;
  const parent = subject.kind === 'model' ? '' : text.slice(0, text.lastIndexOf('.') + 1);
  if (!to.startsWith(parent)) return undefined;
  const name = to.slice(parent.length);
  if (subject.kind !== 'model' && name.includes('.')) return undefined;
  const destinationSubject =
    subject.kind === 'field'
      ? { ...subject, ...renamedModel(subject, contracts) }
      : subject.kind === 'enumValue'
        ? { ...subject, ...renamedEnumValue(subject, contracts) }
        : subject.kind === 'valueObjectField'
          ? { ...subject, ...renamedValueObjectField(subject, contracts) }
          : subject;
  const rename = {
    entity: ENTITY_WORDS[subject.kind],
    from: text,
    to,
    candidates: possibleNewNames(subject, contractsAndRenames(contracts)).map(
      (each) => `${parent}${each}`,
    ),
    destinationRef: contracts.destinationRef,
    variantOf: variantOfModel(subject, contracts),
  };
  if (!namesBeside(destinationSubject, contracts.destination).includes(name)) {
    return missingNameReason(rename);
  }
  return hadNameBefore(subject, name, contracts) ? nameHadBeforeReason(rename) : undefined;
}

type DataLossContracts = StatementContracts & {
  readonly destination: ContractWithDomain;
  readonly originKnown: boolean;
  /** Whether the command writes a migration whose conversion the user fills in. */
  readonly canConvert: boolean;
  /** The command's words for the edits that keep a subject's data; none when it gives none. */
  readonly keepDataEditAdvice?: KeepDataEditAdvice;
  /** The subjects of the round's questions whose data the command may say how to keep, in question order. */
  readonly keptSubjects?: readonly KeptSubject[];
  /** The fields the plan gives a temporary value, in the destination contract. */
  readonly temporaryValues: readonly { readonly subject: MigrationSubject }[];
};

/** What a command says of keeping a subject's data: why its answer loses it, if anything, and each way to keep it. */
export interface KeepDataAdvice {
  readonly lead: string | undefined;
  readonly ways: readonly string[];
  /** Whether a way gives the subject's `--delete` and then edits the migration.ts the command writes, so the flag can keep the data too. */
  readonly waysGiveDelete: boolean;
}

/** A subject whose data a command may say how to keep, with its text as a statement names it and the edits the target gives to keep it. */
export interface KeptSubject {
  readonly subject: MigrationSubject;
  readonly text: string;
  readonly edits: readonly KeepDataEdit[];
}

/**
 * How a command says to keep the data of the subject `subject`: with its edits, when the target gives any, or by changing a member that keeps its name. `kept` are the subjects of the round's questions whose data the command may say how to keep, `subject` among them, in question order; a plan keeps their data together.
 */
export type KeepDataEditAdvice = (
  subject: KeptSubject,
  kept: readonly KeptSubject[],
) => KeepDataAdvice;

function booleanEnum(contract: ContractWithDomain, value: EnumValueCoordinate): boolean {
  return enumMembers(contract, value).some((member) => typeof member.value === 'boolean');
}

/**
 * Whether a command may say how to keep the subject's data: the target gives edits that keep it, or
 * it is an enum value whose member keeps its name with a new stored value, in an enum whose values
 * are not booleans, since a boolean enum has no unused value to pass through.
 */
function keepsDataByCommand(
  subject: MigrationSubject,
  edits: readonly KeepDataEdit[],
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): boolean {
  return (
    edits.length > 0 ||
    (subject.kind === 'enumValue' &&
      inDestination(subject, contracts) &&
      !booleanEnum(contracts.origin, subject))
  );
}

function sameStoredValue(left: unknown, right: unknown): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Whether an enum member takes the stored value of another member the destination still has, under
 * its name or the name a rename gives it, or gives its own stored value to one: the overlap for which
 * a target advises two migrations, since one rewrite writes a value another reads. A command's own
 * route for the members changes them all together.
 */
function sharesValueWithKeptMember(
  subject: MigrationSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): boolean {
  if (subject.kind !== 'enumValue') return false;
  const destinationEnum = renamedEnumValue(subject, contracts) ?? subject;
  const renamedTo = new Map(
    resolvedRenames(contracts).flatMap((statement) =>
      statement.kind === 'rename' &&
      statement.entity === 'enumValue' &&
      statement.from.namespaceId === subject.namespaceId &&
      statement.from.enum === subject.enum
        ? [[statement.from.member, statement.to.member] as const]
        : [],
    ),
  );
  const destinationMembers = enumMembers(contracts.destination, destinationEnum);
  const newValue = (member: string) =>
    destinationMembers.find(({ name }) => name === (renamedTo.get(member) ?? member))?.value;
  const originMembers = enumMembers(contracts.origin, subject);
  const oldValue = originMembers.find(({ name }) => name === subject.member)?.value;
  return originMembers.some(
    (other) =>
      other.name !== subject.member &&
      newValue(other.name) !== undefined &&
      (sameStoredValue(newValue(subject.member), other.value) ||
        sameStoredValue(oldValue, newValue(other.name))),
  );
}

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

/** The `--convert` that rewrites the stored discriminator value of a variant whose value changed, and keeps its data. */
function variantConvertAnswer(
  subject: ModelCoordinate,
  variant: ModelCoordinate,
  text: string,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): QuestionAnswer {
  const from = JSON.stringify(variantValue(contracts.origin, subject));
  const to = JSON.stringify(variantValue(contracts.destination, variant));
  return {
    flag: { verb: 'convert', text: modelStatementText(contracts.destination, variant) },
    meaning: `To rewrite its discriminator value from ${from} to ${to} and keep its data`,
    meaningNamingSubject: `To rewrite the discriminator value of model "${text}" from ${from} to ${to} and keep its data`,
    promptMeaning: `convert rewrites the discriminator value from ${from} to ${to} and keeps the data`,
  };
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
 * The new required fields beside a removed field of a value object or of a model another model
 * embeds, in the destination contract, without those the run backfills: the fields of its value object
 * or model that the origin does not have and no rename of the plan names.
 */
function newRequiredFieldsBeside(
  subject: MigrationSubject,
  contracts: DataLossContracts,
): readonly MigrationSubject[] {
  if (inDestination(subject, contracts)) return [];
  const backfills = contracts.canConvert ? resolvedBackfills(contracts) : [];
  if (subject.kind === 'valueObjectField') {
    const field = renamedValueObjectField(subject, contracts) ?? subject;
    const valueObject = valueObjectAt(contracts.destination.storage, {
      plane: 'storage',
      namespaceId: field.namespaceId,
      entityKind: 'valueObject',
      entityName: field.valueObject,
    });
    return newValueObjectFields(subject, contractsAndRenames(contracts))
      .filter(
        (name) =>
          valueObject?.fields[name]?.nullable === false &&
          !backfills.some(
            (backfill) =>
              backfill.kind === 'backfill' &&
              backfill.entity === 'valueObjectField' &&
              backfill.field.namespaceId === field.namespaceId &&
              backfill.field.valueObject === field.valueObject &&
              backfill.field.field === name,
          ),
      )
      .map((name): MigrationSubject => ({ ...field, kind: 'valueObjectField', field: name }));
  }
  if (subject.kind !== 'field') return [];
  const origin = contracts.origin.domain.namespaces[subject.namespaceId]?.models[subject.model];
  if (origin?.owner === undefined) return [];
  const model = renamedModel(subject, contracts) ?? subject;
  const fields =
    contracts.destination.domain.namespaces[model.namespaceId]?.models[model.model]?.fields ?? {};
  return newModelFields(subject, contractsAndRenames(contracts))
    .filter(
      (name) =>
        fields[name]?.nullable === false &&
        !backfills.some(
          (backfill) =>
            backfill.kind === 'backfill' &&
            backfill.entity === 'field' &&
            sameModel(backfill.field, model) &&
            backfill.field.field === name,
        ),
    )
    .map((name): MigrationSubject => ({ ...model, kind: 'field', field: name }));
}

function newFieldText(field: MigrationSubject, destination: ContractWithDomain): string {
  switch (field.kind) {
    case 'field':
      return fieldStatementText(destination, field);
    case 'valueObjectField':
      return valueObjectFieldStatementText(destination, field);
    default:
      throw new InternalError(
        `A new required field is a field or a value object field, not a ${field.kind}`,
      );
  }
}

/**
 * What a delete leaves in the new required fields beside a removed field of a value object or an
 * embedded model: a temporary value the plan gives, which is a fact, or none, which a backfill
 * writes, given with its flag.
 */
function newRequiredFields(
  subject: MigrationSubject,
  contracts: DataLossContracts,
): { readonly notes: readonly string[]; readonly alsoGiveWhenDeleted: readonly string[] } {
  const added = newRequiredFieldsBeside(subject, contracts);
  if (added.length === 0) return { notes: [], alsoGiveWhenDeleted: [] };
  const filledKeys = new Set(
    contracts.temporaryValues.map((value) => migrationSubjectKey(value.subject)),
  );
  const filled = (each: MigrationSubject) => filledKeys.has(migrationSubjectKey(each));
  const temporary = added.filter(filled).map((each) => newFieldText(each, contracts.destination));
  const needed = added
    .filter((each) => !filled(each))
    .map((each) => newFieldText(each, contracts.destination));
  const named = (fields: readonly string[]) =>
    `${fields.length === 1 ? 'field' : 'fields'} ${quotedList(fields)}`;
  const backfills = needed.map((each) => statementFlag({ verb: 'backfill', text: each })).join(' ');
  return {
    notes:
      temporary.length === 0
        ? []
        : [
            `If the values go, the existing objects get a temporary value in the new required ${named(temporary)}.`,
          ],
    alsoGiveWhenDeleted:
      needed.length === 0
        ? []
        : !contracts.canConvert
          ? [
              `If the values go, the new required ${named(needed)} ${needed.length === 1 ? 'gets' : 'get'} no temporary value: plan the change with migration plan ${backfills} to write ${needed.length === 1 ? 'its value' : 'their values'} in migration.ts.`,
            ]
          : needed.length === 1
            ? [
                `If the values go, the new required ${named(needed)} still needs a value: add ${backfills} to write it in migration.ts.`,
              ]
            : [
                `If the values go, the new required ${named(needed)} still need a value: add ${backfills} to write them in migration.ts.`,
              ],
  };
}

function quotedList(items: readonly string[]): string {
  const quoted = items.map((item) => `"${item}"`);
  return quoted.length === 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

/**
 * The question for the operations of a plan that would lose one subject's data. A field whose type
 * changes may be converted where the command writes a migration to fill in; the convert names the
 * field as the contract names it. A variant whose discriminator value changed may be converted by
 * any command, since the convert needs no code the user writes. A model or field the contract no
 * longer has, and no rename of the plan renamed, may be renamed instead of deleted; a rename is
 * resolved against the two contracts after the plan's other renames, and its old name must be the
 * subject. Anything else, and data no model stores, can only be deleted. A field whose model the
 * contract names differently can be renamed only after a rename of the model, so the question gives
 * that rename as a way to keep the values. The target's advice on keeping the data is a way to keep
 * it too, when it gives any, except for enum members that share stored values when the command
 * gives its own route for them. `recoveryFor` lists the storage subjects of the round when the
 * contract before this change is not known, on the first of them: the question gives the steps that
 * store that contract.
 */
export function dataLossQuestion(
  loss: PlannedDataLoss,
  contracts: DataLossContracts,
  edits: readonly KeepDataEdit[] = [],
  labels: readonly string[] = [loss.label],
  recoveryFor: readonly string[] = [],
): PlanQuestion {
  const subject = subjectText(loss.subject, contracts);
  const kind = lossKind(loss, contracts);
  const deleteNames = namesSubject('delete', subject);
  const missingModel = missingFieldModel(loss.subject, contracts);
  const keepData =
    contracts.keepDataEditAdvice === undefined ||
    !keepsDataByCommand(loss.subject, edits, contracts)
      ? undefined
      : contracts.keepDataEditAdvice(
          { subject: loss.subject, text: subject, edits },
          contracts.keptSubjects ?? [{ subject: loss.subject, text: subject, edits }],
        );
  const commandRoutesSharedValues =
    keepData !== undefined &&
    keepData.ways.length > 0 &&
    sharesValueWithKeptMember(loss.subject, contracts);
  const required = newRequiredFields(loss.subject, contracts);
  const subjectInList = namedSubject(loss.subject, subject);
  const modelWay = missingModel === undefined ? [] : [modelRenameWay(missingModel, contracts)];
  const variantOf = variantOfModel(loss.subject, contracts);
  const baseWay = variantOf?.kind === 'removed' ? [removedBaseWay(subject, variantOf.base)] : [];
  const otherWays = [
    ...(loss.keepDataAdvice === undefined || commandRoutesSharedValues
      ? []
      : [loss.keepDataAdvice]),
    ...(keepData?.ways ?? []),
  ].map((text): KeepDataWay => ({ text, forSubject: subjectInList }));
  const recovers = recoveryFor.length > 0;
  const parts = {
    headline: lossHeadline(loss, kind, subject, contracts),
    subjectInList,
    operations: [...new Set(labels)],
    notes: [...(keepData?.lead === undefined ? [] : [keepData.lead]), ...required.notes],
    keepDataWays: [
      ...modelWay,
      ...baseWay,
      ...otherWays,
      ...(recovers ? originSnapshotRecovery(recoveryFor) : []),
    ],
    alsoGiveWhenDeleted: required.alsoGiveWhenDeleted,
    effect: kind === 'retyped' ? 'may change data' : 'deletes data',
    subject,
  } as const;
  const deleting = deleteAnswer(loss, kind, subject, keepData?.waysGiveDelete === true);
  if (kind === 'retyped' && loss.subject.kind === 'field') {
    if (!contracts.canConvert) {
      return planQuestion({
        ...parts,
        answers: [deleting],
        validate: (_verb, text) => deleteNames(text),
      });
    }
    const field = destinationField(loss.subject, contracts);
    const convert = fieldStatementText(contracts.destination, field);
    return planQuestion({
      ...parts,
      answers: [
        {
          flag: { verb: 'convert', text: convert },
          meaning: 'To write the conversion yourself',
          meaningNamingSubject: `To write the conversion of field "${subject}" yourself`,
          promptMeaning: 'convert writes a conversion for you to fill in',
        },
        deleting,
      ],
      validate: (verb, text) => {
        if (verb !== 'convert') return deleteNames(text);
        if (text !== convert) {
          return `convert names the field as the contract names it: ${statementFlag({ verb: 'convert', text: convert })}.`;
        }
        const resolved = resolvesWith({ verb: 'convert', text }, contracts);
        return resolved.ok ? undefined : resolved.failure;
      },
    });
  }
  const variant = changedVariant(loss.subject, contracts);
  if (variant !== undefined && loss.subject.kind === 'model') {
    const convert = modelStatementText(contracts.destination, variant);
    return planQuestion({
      ...parts,
      answers: [variantConvertAnswer(loss.subject, variant, subject, contracts), deleting],
      validate: (verb, text) => {
        if (verb !== 'convert') return deleteNames(text);
        if (text !== convert) {
          return `convert names the variant as the contract names it: ${statementFlag({ verb: 'convert', text: convert })}.`;
        }
        const resolved = resolvesWith({ verb: 'convert', text }, contracts);
        return resolved.ok ? undefined : resolved.failure;
      },
    });
  }
  const renamable =
    missingModel === undefined &&
    baseWay.length === 0 &&
    loss.subject.kind !== 'storage' &&
    !inDestination(loss.subject, contracts) &&
    !renamedByPlan(loss.subject, contracts);
  const rename = renamable ? renameTarget(loss.subject, subject, contracts) : undefined;
  return planQuestion({
    ...parts,
    answers:
      rename === undefined
        ? [deleting]
        : [renameAnswer(loss.subject, subject, rename, contracts), deleting],
    validate: (verb, text) => {
      if (verb !== 'rename') return deleteNames(text);
      if (!text.includes(':')) {
        return `rename needs the new name: type rename ${renameForm(loss.subject, subject, contracts)}.`;
      }
      const [from, to = ''] = text.split(':');
      const notTheSubject = `To rename "${subject}", type rename ${renameForm(loss.subject, subject, contracts)}.`;
      const problem =
        from === subject ? newNameProblem(loss.subject, subject, to, contracts) : undefined;
      if (problem !== undefined) return problem;
      const resolved = resolvesWith({ verb: 'rename', text }, contracts);
      if (!resolved.ok) return from === subject ? resolved.failure : notTheSubject;
      return resolved.value !== undefined && sameCoordinate(resolved.value, loss.subject)
        ? undefined
        : notTheSubject;
    },
  });
}

/**
 * The question for the operations of a plan that change who can read or write one subject's data:
 * they widen access when any of them does, or else change it in a way that can go either way. One
 * `allow` allows them all.
 */
export function accessChangeQuestion(
  changes: readonly PlannedAccessChange[],
  contracts: StatementContracts,
): PlanQuestion {
  const [first] = changes;
  if (first === undefined) {
    throw new InternalError('An access change question needs at least one access change.');
  }
  const subject = subjectText(first.subject, contracts);
  const named = namedSubject(first.subject, subject);
  const several = new Set(changes.map(({ label }) => label)).size > 1;
  const them = several ? (changes.length === 2 ? 'both changes' : 'these changes') : 'it';
  return planQuestion({
    headline: `Access to the data of "${subject}" would ${changes.some(({ widens }) => widens) ? 'widen' : 'change'}.`,
    subjectInList: named,
    operations: changes.map(({ label }) => label),
    notes: [],
    keepDataWays: [],
    answers: [
      {
        flag: { verb: 'allow', text: subject },
        meaning: `To allow ${them}`,
        meaningNamingSubject: `To allow ${several ? them : 'the change'} to ${named}`,
        promptMeaning: `allow lets the plan make ${several ? 'these changes' : 'this change'}`,
      },
    ],
    alsoGiveWhenDeleted: [],
    effect: 'changes access',
    subject,
    validate: (_verb, text) => namesSubject('allow', subject)(text),
  });
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
      `answerQuestions left "${questions[open]?.headline}" open, which it may do only beside a rename or convert answer that plans again.`,
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
        `answerQuestions answered "${question.headline}" with ${answer.verb}, which it does not accept; it accepts ${question.verbs.join(' or ')}.`,
        cause,
      );
    }
    const rejected = question.validate(answer.verb, answer.text);
    if (rejected !== undefined) {
      throw new InternalError(
        `answerQuestions answered "${question.headline}" wrongly: ${rejected}`,
        cause,
      );
    }
  });
}

/**
 * The namespace the contract no longer has: the fact, a `delete` of it, and, when the contract adds
 * namespaces, a `rename` of it to one of them.
 */
function removedNamespaceParts(removed: string, added: readonly string[]): RemovedNamespaceParts {
  const [only] = added;
  const to = only !== undefined && added.length === 1 ? only : '<new namespace>';
  const form = `${removed}:${to}`;
  const renameMeant = renameMeaning(
    `namespace "${removed}"`,
    'keep its data',
    added,
    '<new namespace>',
    undefined,
    undefined,
  );
  const rename: readonly QuestionAnswer[] =
    only === undefined
      ? []
      : [
          {
            flag: { verb: 'rename', text: form },
            meaning: renameMeant,
            meaningNamingSubject: renameMeant,
            promptMeaning: `rename ${form} keeps the data of namespace "${removed}" under namespace ${eitherOf(added)}`,
          },
        ];
  const deleting: QuestionAnswer = {
    flag: { verb: 'delete', text: removed },
    meaning: `If the data of everything in namespace "${removed}" can go`,
    meaningNamingSubject: `If the data of everything in namespace "${removed}" can go`,
    promptMeaning: `delete ${removed} lets the data of every model and field of namespace "${removed}" go`,
  };
  return {
    namespace: removed,
    fact: `The contract no longer has namespace "${removed}".`,
    answers: [deleting, ...rename],
  };
}

/**
 * A question about a model or field of a namespace the contract no longer has, which carries the
 * namespace's own answers and accepts them: a `delete` of the namespace, or a `rename` of it to
 * another one.
 */
function acceptingNamespaceAnswers(
  question: PlanQuestion,
  removedNamespace: string | undefined,
  added: readonly string[],
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): PlanQuestion {
  if (removedNamespace === undefined) return question;
  const renamedTo = (text: string) =>
    text.startsWith(`${removedNamespace}:`) ? text.slice(removedNamespace.length + 1) : undefined;
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
  const namespaceParts = removedNamespaceParts(removedNamespace, added);
  const namespaceForm = (verb: 'rename') =>
    namespaceParts.answers.find(({ flag }) => flag.verb === verb)?.flag.text;
  return {
    ...question,
    verbs: VERB_ORDER.filter(
      (verb) =>
        question.verbs.includes(verb) ||
        namespaceParts.answers.some(({ flag }) => flag.verb === verb),
    ),
    forms: {
      ...question.forms,
      ...ifDefined('rename', question.forms.rename ?? namespaceForm('rename')),
    },
    removedNamespace,
    removedNamespaceParts: namespaceParts,
    namespaceAnswer,
    validate: (verb, text) => {
      if (namespaceAnswer(verb, text) !== undefined) return undefined;
      const to = verb === 'rename' ? renamedTo(text) : undefined;
      if (to !== undefined && !Object.hasOwn(contracts.destination.domain.namespaces, to)) {
        return missingNameReason({
          entity: 'namespace',
          from: removedNamespace,
          to,
          candidates: added,
          destinationRef: contracts.destinationRef,
          variantOf: undefined,
        });
      }
      return question.validate(verb, text);
    },
  };
}

/** The entries grouped by subject, in the order each subject first appears. */
function bySubject<TEntry extends PlannedSubject>(
  entries: readonly TEntry[],
): readonly (readonly TEntry[])[] {
  const groups = new Map<string, TEntry[]>();
  for (const entry of entries) {
    const group = groups.get(keyOf(entry)) ?? [];
    group.push(entry);
    groups.set(keyOf(entry), group);
  }
  return [...groups.values()];
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
  /** The `--to` value the command plans to, when the destination is a stored contract and not the emitted one. */
  readonly destinationRef?: string;
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
  const alreadyAnswered = new Map<StatementText, UnusedConsent>();
  for (let round = 0; ; round += 1) {
    const answeredWithoutAsking: AnsweredWithoutAsking[] = [];
    const contracts = {
      origin: input.origin,
      originKnown: input.originKnown,
      destination: input.destination,
      ...ifDefined('destinationRef', input.destinationRef),
      canConvert: input.canConvert,
      statements,
      ...ifDefined('keepDataEditAdvice', input.keepDataEditAdvice),
      temporaryValues: plan.temporaryValues,
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
      const given = input.preAnswers.filter((statement) => statement.verb === verb);
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
      const unusedGiven = given.filter((_, position) => !matched.used.has(position));
      unusedGiven.forEach((statement, index) => {
        const unused = matched.unused[index];
        if (unused?.alreadyAnsweredBy !== undefined) alreadyAnswered.set(statement, unused);
      });
      entries.forEach((entry, index) => {
        if (!input.consentAll[verb] && !matched.answered.has(index)) return;
        consent(verb, entry, texts[index] ?? '');
        if (!matched.answered.has(index)) {
          answeredWithoutAsking.push({
            verb,
            subject: texts[index] ?? '',
            ...ifDefined('removedNamespace', removedNamespaceOf(entry.subject, plan.namespaces)),
          });
        }
      });
    }
    if (round === 0 && alreadyAnswered.size > 0) {
      return notOk(
        errorConsentUnused(
          [...alreadyAnswered.values()],
          questionSubjects(plan, input.askAccess, contracts),
        ),
      );
    }
    const losses = pending('delete', plan.dataLoss);
    const sameSubject = (loss: PlannedDataLoss) =>
      plan.dataLoss.filter((entry) => questionKey('delete', entry) === questionKey('delete', loss));
    const editsOf = (loss: PlannedDataLoss) =>
      sameSubject(loss).flatMap((entry) =>
        entry.keepDataEdit === undefined ? [] : [entry.keepDataEdit],
      );
    const roundContracts = {
      ...contracts,
      keptSubjects: losses
        .filter((loss) => keepsDataByCommand(loss.subject, editsOf(loss), contracts))
        .map((loss) => ({
          subject: loss.subject,
          text: subjectText(loss.subject, contracts),
          edits: editsOf(loss),
        })),
    };
    const accessChanges = input.askAccess ? bySubject(pending('allow', plan.accessChanges)) : [];
    if (losses.length + accessChanges.length === 0 && round > 0) break;
    const storageTexts = input.originKnown
      ? []
      : losses.flatMap((loss) =>
          loss.subject.kind === 'storage' ? [subjectText(loss.subject, contracts)] : [],
        );
    const firstStorage = losses.findIndex((loss) => loss.subject.kind === 'storage');
    const questions = [
      ...losses.map((loss, index) =>
        acceptingNamespaceAnswers(
          dataLossQuestion(
            loss,
            roundContracts,
            editsOf(loss),
            sameSubject(loss).map(({ label }) => label),
            index === firstStorage ? storageTexts : [],
          ),
          removedNamespaceOf(loss.subject, plan.namespaces),
          plan.namespaces?.added ?? [],
          contracts,
        ),
      ),
      ...accessChanges.map((changes) => accessChangeQuestion(changes, contracts)),
    ];
    const answers = await input.answer(questions, answeredWithoutAsking);
    checkAnswers(questions, answers);
    const typed: {
      readonly statement: StatementText;
      readonly loss: PlannedSubject;
      readonly ofNamespace: boolean;
    }[] = [];
    const asked: readonly (readonly PlannedSubject[])[] = [
      ...losses.map((loss) => [loss]),
      ...accessChanges,
    ];
    answers.forEach((answer, index) => {
      const entries = asked[index] ?? [];
      const [entry] = entries;
      const question = questions[index];
      if (answer === undefined || entry === undefined || question === undefined) return;
      if (answer.verb === 'rename' || answer.verb === 'convert') {
        typed.push({
          statement: { verb: answer.verb, text: answer.text },
          loss: entry,
          ofNamespace: question.namespaceAnswer?.(answer.verb, answer.text) === 'rename',
        });
      } else {
        for (const each of entries) consent(answer.verb, each, question.subject);
      }
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
  const subjects = questionSubjects(plan, input.askAccess, { ...input, statements });
  const answersNothing = unused.filter((statement) => !alreadyAnswered.has(statement));
  if (answersNothing.length > 0) {
    return notOk(errorStatementAnswersNoQuestion(answersNothing, subjects));
  }
  const repeated = unused.flatMap((statement) => alreadyAnswered.get(statement) ?? []);
  if (repeated.length > 0) return notOk(errorConsentUnused(repeated, subjects));
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
 * Matches `--delete` or `--allow` flags to questions as an apply does, whatever their order. A flag
 * naming a subject answers every question about it, so one `--allow` allows every access change of
 * its subject; then a `delete` naming a removed namespace answers the questions of the namespace
 * still open. A flag no question took is unused, and says what had already answered its question,
 * if anything had. Every path that matches consent flags asks this, so a dry run and an apply
 * refuse the same flags.
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
    const position = texts.indexOf(question.text);
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
