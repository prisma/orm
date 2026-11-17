import { asNamespaceId, type ContractWithDomain, valueObjectAt } from '@internal/contract/types';
import {
  type EnumValueCoordinate,
  enumValueStatementText,
  type FieldCoordinate,
  fieldStatementText,
  type MigrationSubject,
  type ModelCoordinate,
  migrationSubjectKey,
  modelStatementText,
  type ResolvedMigrationStatement,
  type ValueObjectFieldCoordinate,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';
import { statementFlag } from './mongo-statement-flags';
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

/** A subject as the question names it: a field through the name a rename statement gives its model, as `subjectText` in the CLI's `plan-questions.ts` writes it. */
function subjectText(subject: MigrationSubject, contracts: Contracts): string {
  switch (subject.kind) {
    case 'model':
      return modelStatementText(contracts.fromContract, subject);
    case 'field': {
      const renamed = renamedModelOf(subject, contracts);
      return renamed === undefined
        ? fieldStatementText(contracts.fromContract, subject)
        : fieldStatementText(contracts.contract, { ...renamed, field: subject.field });
    }
    case 'enumValue':
      return enumValueStatementText(contracts.fromContract, subject);
    case 'valueObjectField':
      return valueObjectFieldStatementText(contracts.fromContract, subject);
    case 'storage':
      return subject.name;
  }
}

function newFieldText(subject: MigrationSubject, contract: ContractWithDomain): string {
  switch (subject.kind) {
    case 'field':
      return fieldStatementText(contract, subject);
    case 'valueObjectField':
      return valueObjectFieldStatementText(contract, subject);
    case 'model':
      return modelStatementText(contract, subject);
    case 'enumValue':
      return enumValueStatementText(contract, subject);
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

/** The model a rename statement gives an origin model, if any. */
function renamedModelOf(
  origin: ModelCoordinate,
  contracts: Contracts,
): ModelCoordinate | undefined {
  for (const statement of contracts.statements) {
    if (
      statement.kind === 'rename' &&
      statement.entity === 'model' &&
      statement.from.namespaceId === origin.namespaceId &&
      statement.from.model === origin.model
    ) {
      return statement.to;
    }
  }
  return undefined;
}

/** The destination model an origin model is, under the name a rename statement gives it, when the destination has it. */
function destinationModelOf(
  origin: ModelCoordinate,
  contracts: Contracts,
): ModelCoordinate | undefined {
  const destination = renamedModelOf(origin, contracts) ?? origin;
  return modelAt(contracts.contract, destination) === undefined ? undefined : destination;
}

function membersOf(contract: ContractWithDomain, value: EnumValueCoordinate): readonly string[] {
  return (contract.domain.namespaces[value.namespaceId]?.enum?.[value.enum]?.members ?? []).map(
    ({ name }) => name,
  );
}

function valueObjectFieldsOf(
  contract: ContractWithDomain,
  field: ValueObjectFieldCoordinate,
): readonly string[] {
  const valueObject = valueObjectAt(contract.storage, {
    plane: 'storage',
    namespaceId: field.namespaceId,
    entityKind: 'valueObject',
    entityName: field.valueObject,
  });
  return Object.keys(valueObject?.fields ?? {});
}

/** The names of `destination` that `origin` does not have and no rename statement names. */
function added(
  destination: readonly string[],
  origin: readonly string[],
  renamedTo: readonly string[],
): readonly string[] {
  return destination.filter((name) => !origin.includes(name) && !renamedTo.includes(name));
}

/** The fields of the destination model a removed field can have been renamed to: those the origin model does not have and no rename names, as `newModelFields` in the CLI's `plan-questions.ts` finds them. */
function newModelFields(subject: FieldCoordinate, contracts: Contracts): readonly string[] {
  const destination = destinationModelOf(subject, contracts);
  if (destination === undefined) return [];
  return added(
    Object.keys(modelAt(contracts.contract, destination)?.fields ?? {}),
    Object.keys(modelAt(contracts.fromContract, subject)?.fields ?? {}),
    contracts.statements.flatMap((statement) =>
      statement.kind === 'rename' &&
      statement.entity === 'field' &&
      statement.to.namespaceId === destination.namespaceId &&
      statement.to.model === destination.model
        ? [statement.to.field]
        : [],
    ),
  );
}

/** The members a removed enum value can have been renamed to, as `onlyNewMember` in the CLI's `plan-questions.ts` finds them. */
function newMembers(subject: EnumValueCoordinate, contracts: Contracts): readonly string[] {
  return added(
    membersOf(contracts.contract, subject),
    membersOf(contracts.fromContract, subject),
    contracts.statements.flatMap((statement) =>
      statement.kind === 'rename' && statement.entity === 'enumValue' ? [statement.to.member] : [],
    ),
  );
}

/** The fields a removed value object field can have been renamed to, as `newValueObjectFields` in the CLI's `plan-questions.ts` finds them. */
function newValueObjectFields(
  subject: ValueObjectFieldCoordinate,
  contracts: Contracts,
): readonly string[] {
  return added(
    valueObjectFieldsOf(contracts.contract, subject),
    valueObjectFieldsOf(contracts.fromContract, subject),
    contracts.statements.flatMap((statement) =>
      statement.kind === 'rename' && statement.entity === 'valueObjectField'
        ? [statement.to.field]
        : [],
    ),
  );
}

/** The variants a removed variant can have been renamed to, as `newVariantsOfBase` in the CLI's `variants.ts` finds them. */
function newVariants(subject: ModelCoordinate, contracts: Contracts): readonly ModelCoordinate[] {
  const base = modelAt(contracts.fromContract, subject)?.base;
  if (base === undefined) return [];
  const coordinate = { namespaceId: asNamespaceId(base.namespace), model: base.model };
  const variantsOf = (contract: ContractWithDomain) =>
    Object.values(modelAt(contract, coordinate)?.variants ?? {}).map((variant) => ({
      namespaceId: asNamespaceId(variant.namespace),
      model: variant.model,
    }));
  const key = ({ namespaceId, model }: ModelCoordinate) => `${namespaceId}\0${model}`;
  const renamedTo = contracts.statements.flatMap((statement) =>
    statement.kind === 'rename' && statement.entity === 'model' ? [key(statement.to)] : [],
  );
  const before = variantsOf(contracts.fromContract).map(key);
  return variantsOf(contracts.contract).filter(
    (variant) => !before.includes(key(variant)) && !renamedTo.includes(key(variant)),
  );
}

interface Answer {
  /** Whether the destination has a field or model a statement can keep the data in. */
  readonly canKeep: boolean;
  /** The statement that keeps the data, as the question offers it first. */
  readonly keeping: string;
}

function only<T>(candidates: readonly T[]): T | undefined {
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** The statement the question offers first for a removal, and whether the destination can keep its data, as `renameForm` in the CLI's `plan-questions.ts` writes it. */
function answerOf(subject: MigrationSubject, text: string, contracts: Contracts): Answer {
  const parent = text.slice(0, text.lastIndexOf('.'));
  const renaming = (to: string | undefined) =>
    statementFlag('rename', `${text}:${parent}.${to ?? '<new name>'}`);
  switch (subject.kind) {
    case 'field': {
      const candidates = newModelFields(subject, contracts);
      return { canKeep: candidates.length > 0, keeping: renaming(only(candidates)) };
    }
    case 'model': {
      const destination = destinationModelOf(subject, contracts);
      if (destination !== undefined) {
        return {
          canKeep: true,
          keeping: statementFlag('convert', modelStatementText(contracts.contract, destination)),
        };
      }
      const variant = only(newVariants(subject, contracts));
      return {
        canKeep: variant !== undefined,
        keeping: statementFlag(
          'rename',
          `${text}:${variant === undefined ? '<new name>' : modelStatementText(contracts.contract, variant)}`,
        ),
      };
    }
    case 'enumValue':
      return { canKeep: false, keeping: renaming(only(newMembers(subject, contracts))) };
    case 'valueObjectField':
      return { canKeep: false, keeping: renaming(only(newValueObjectFields(subject, contracts))) };
    case 'storage':
      return { canKeep: false, keeping: statementFlag('rename', `${text}:<new name>`) };
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
 * What a plan-wide refusal leads with when the plan holds changes no statement carries: those
 * changes, as their questions name them, and the statements that keep their data, as the questions
 * offer them first. The planner cannot tell an unanswered change from one answered with
 * `--delete`, so it says only that no `--rename` or `--convert` carries them. A field of a model the
 * destination does not have is left out, since no field statement can keep its data. `undefined` when no
 * removal has a field or model in the destination to keep its data in.
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
    .filter(
      ({ kind, subject }) =>
        kind === 'removed' &&
        (subject.kind !== 'field' || destinationModelOf(subject, contracts) !== undefined),
    )
    .sort((a, b) => ORDER[a.subject.kind] - ORDER[b.subject.kind])
    .map(({ subject }) => {
      const text = subjectText(subject, contracts);
      return {
        description: removalText(subject, text),
        answer: answerOf(subject, text, contracts),
      };
    });
  if (!removed.some(({ answer }) => answer.canKeep)) return undefined;
  const filled = unique
    .filter((change) => change.kind === 'newRequired')
    .map(
      ({ subject }) =>
        `new required ${subject.kind === 'valueObjectField' ? 'value object field' : 'field'} "${newFieldText(subject, contracts.contract)}", which the plan fills with a temporary value`,
    );
  const named = [...removed.map(({ description }) => description), ...filled];
  const keeping = removed.map(({ answer }) => answer.keeping);
  return `The plan holds changes that no --rename or --convert statement carries: ${named.join('; ')}. To keep their data, plan again with: ${keeping.join('; ')}.`;
}
