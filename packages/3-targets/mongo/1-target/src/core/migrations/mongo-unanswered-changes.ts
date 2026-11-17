import type { ContractWithDomain } from '@internal/contract/types';
import {
  enumValueStatementText,
  fieldStatementText,
  type MigrationSubject,
  type ModelCoordinate,
  migrationSubjectKey,
  modelStatementText,
  type ResolvedMigrationStatement,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';
import { modelAt } from './mongo-statement-planning';

interface Contracts {
  readonly fromContract: ContractWithDomain;
  readonly contract: ContractWithDomain;
  /** The statements the plan carries out. */
  readonly statements: readonly ResolvedMigrationStatement[];
}

/**
 * A change the planner makes for the contracts when no statement carries it: a removal, which a
 * statement may keep, or a new required field it fills with a temporary value.
 */
export interface UnansweredChange {
  readonly kind: 'removed' | 'newRequired';
  readonly subject: MigrationSubject;
}

const SHELL_SAFE = /^[A-Za-z0-9_.:/@%+,-]+$/;

function flag(verb: string, text: string): string {
  return `--${verb} ${SHELL_SAFE.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`}`;
}

function subjectText(subject: MigrationSubject, contract: ContractWithDomain): string {
  switch (subject.kind) {
    case 'model':
      return modelStatementText(contract, subject);
    case 'field':
      return fieldStatementText(contract, subject);
    case 'enumValue':
      return enumValueStatementText(contract, subject);
    case 'valueObjectField':
      return valueObjectFieldStatementText(contract, subject);
    case 'storage':
      return subject.name;
  }
}

function removalText(subject: MigrationSubject, text: string): string {
  switch (subject.kind) {
    case 'model':
      return `model "${text}", whose documents the plan deletes`;
    case 'field':
      return `field "${text}", which the plan removes`;
    case 'enumValue':
      return `enum value "${text}", which the plan removes from the data`;
    case 'valueObjectField':
      return `value object field "${text}", which the plan removes`;
    case 'storage':
      return `"${text}", which the plan removes`;
  }
}

/** The destination model an origin model is, under the name a rename statement gives it, when the destination has it. */
function destinationModelOf(
  origin: ModelCoordinate,
  contracts: Contracts,
): ModelCoordinate | undefined {
  const renamed = contracts.statements.find(
    (statement) =>
      statement.kind === 'rename' &&
      statement.entity === 'model' &&
      statement.from.namespaceId === origin.namespaceId &&
      statement.from.model === origin.model,
  );
  const destination =
    renamed?.kind === 'rename' && renamed.entity === 'model' ? renamed.to : origin;
  return modelAt(contracts.contract, destination) === undefined ? undefined : destination;
}

/** The fields of the destination model a removed field can have been renamed to: those the origin model does not have and no rename names. */
function renameCandidates(
  subject: Extract<MigrationSubject, { readonly kind: 'field' }>,
  contracts: Contracts,
): readonly string[] {
  const destination = destinationModelOf(subject, contracts);
  if (destination === undefined) return [];
  const originFields = Object.keys(modelAt(contracts.fromContract, subject)?.fields ?? {});
  const renamedTo = contracts.statements.flatMap((statement) =>
    statement.kind === 'rename' &&
    statement.entity === 'field' &&
    statement.to.namespaceId === destination.namespaceId &&
    statement.to.model === destination.model
      ? [statement.to.field]
      : [],
  );
  return Object.keys(modelAt(contracts.contract, destination)?.fields ?? {}).filter(
    (name) => !originFields.includes(name) && !renamedTo.includes(name),
  );
}

interface Answers {
  /** Whether the destination has a field or model a statement can keep the data in. */
  readonly canKeep: boolean;
  /** The statements, in the order the question offers them: the one that keeps the data first, then `--delete`. */
  readonly flags: readonly string[];
}

function answersOf(subject: MigrationSubject, text: string, contracts: Contracts): Answers {
  const parent = text.slice(0, text.lastIndexOf('.'));
  const deleting = flag('delete', text);
  const renaming = (to: string) => flag('rename', `${text}:${parent}.${to}`);
  switch (subject.kind) {
    case 'field': {
      const candidates = renameCandidates(subject, contracts);
      const [only] = candidates;
      return {
        canKeep: candidates.length > 0,
        flags: [
          renaming(candidates.length === 1 && only !== undefined ? only : '<new name>'),
          deleting,
        ],
      };
    }
    case 'model': {
      const destination = destinationModelOf(subject, contracts);
      return destination === undefined
        ? { canKeep: false, flags: [deleting] }
        : {
            canKeep: true,
            flags: [flag('convert', modelStatementText(contracts.contract, destination)), deleting],
          };
    }
    case 'enumValue':
    case 'valueObjectField':
      return { canKeep: false, flags: [renaming('<new name>'), deleting] };
    case 'storage':
      return { canKeep: false, flags: [deleting] };
  }
}

const ORDER: Readonly<Record<MigrationSubject['kind'], number>> = {
  field: 0,
  valueObjectField: 1,
  enumValue: 2,
  storage: 3,
  model: 4,
};

/**
 * What a plan-wide refusal says when the plan holds changes no statement answers: those changes, as
 * their questions name them, and the statements that answer each, those that keep data first.
 * `undefined` when no removal has a field or model in the destination to keep its data in, so that
 * every answer is `--delete` and leaves the plan as it is.
 */
export function unansweredChangesAdvice(
  changes: readonly UnansweredChange[],
  contracts: Contracts,
): string | undefined {
  const unique = changes.filter(
    (change, index) =>
      changes.findIndex(
        (other) =>
          other.kind === change.kind &&
          migrationSubjectKey(other.subject) === migrationSubjectKey(change.subject),
      ) === index,
  );
  const removed = unique
    .filter((change) => change.kind === 'removed')
    .sort((a, b) => ORDER[a.subject.kind] - ORDER[b.subject.kind])
    .map(({ subject }) => {
      const text = subjectText(subject, contracts.fromContract);
      return {
        description: removalText(subject, text),
        answers: answersOf(subject, text, contracts),
      };
    });
  if (!removed.some(({ answers }) => answers.canKeep)) return undefined;
  const filled = unique
    .filter((change) => change.kind === 'newRequired')
    .map(
      ({ subject }) =>
        `new required ${subject.kind === 'valueObjectField' ? 'value object field' : 'field'} "${subjectText(subject, contracts.contract)}", which the plan fills with a temporary value`,
    );
  const named = [...removed.map(({ description }) => description), ...filled];
  const answers = removed.map(({ answers: { flags } }) => flags.join(' or '));
  return `The plan holds changes that no statement answers yet: ${named.join('; ')}. Answer them and plan again: ${answers.join('; ')}.`;
}
