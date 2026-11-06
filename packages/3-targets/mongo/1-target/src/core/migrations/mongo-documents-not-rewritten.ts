import {
  type ContractField,
  type ContractValueObjectField,
  valueObjectAt,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import {
  fieldStatementText,
  type MigrationPlannerConflict,
} from '@internal/framework-components/control';
import {
  embeddedModelReason,
  type ModelMatchInput,
  modelAt,
  modelCoordinates,
  originFieldOf,
  originModelOf,
} from './mongo-statement-planning';

type AnyField = ContractField | ContractValueObjectField;

const NOT_A_STATEMENT =
  'This change is not a statement, so the plan does not rewrite the documents. Write a dataTransform in migration.ts, before the validator change, that rewrites them to fit; until they fit, the validator change checks the documents and fails the apply. With db update, plan the change with migration plan instead.';

function warning(summary: string): MigrationPlannerConflict {
  return { kind: 'documentsNotRewritten', summary, why: NOT_A_STATEMENT };
}

function typeKey(field: AnyField): string {
  const { type } = field;
  const many = field.many !== undefined && field.many !== false;
  if (type.kind === 'scalar') return JSON.stringify(['scalar', type.codecId, many]);
  if (type.kind === 'valueObject') {
    return JSON.stringify(['valueObject', type.namespaceId, type.entityName, many]);
  }
  return JSON.stringify(['union', many]);
}

function valueSetName(field: AnyField): string | undefined {
  return field.valueSet?.entityName;
}

function valueObjectName(field: AnyField): string | undefined {
  return field.type.kind === 'valueObject' ? field.type.entityName : undefined;
}

/** What changes for a field kept by both contracts that the plan does not rewrite, in words. */
function untouchedChange(name: string, before: AnyField, after: AnyField): string | undefined {
  const enumBefore = valueSetName(before);
  const enumAfter = valueSetName(after);
  if (enumAfter !== undefined && enumBefore === undefined) {
    return `Field "${name}" gains enum "${enumAfter}"`;
  }
  if (enumAfter !== undefined && enumBefore !== undefined && enumAfter !== enumBefore) {
    return `Field "${name}" changes from enum "${enumBefore}" to enum "${enumAfter}"`;
  }
  const objectBefore = valueObjectName(before);
  const objectAfter = valueObjectName(after);
  if (objectBefore !== undefined && objectAfter !== undefined && objectBefore !== objectAfter) {
    return `Field "${name}" moves from value object "${objectBefore}" to value object "${objectAfter}"`;
  }
  if (objectBefore === undefined && objectAfter !== undefined && before.type.kind === 'scalar') {
    return `Field "${name}" changes from a scalar to value object "${objectAfter}"`;
  }
  if (objectBefore !== undefined && objectAfter === undefined && after.type.kind === 'scalar') {
    return `Field "${name}" changes from value object "${objectBefore}" to a scalar`;
  }
  return undefined;
}

/**
 * What changes for each field of an embedded model, whose documents the plan does not rewrite: a
 * field removed, a field whose type changes, and a required field that is new or was optional.
 */
function embeddedModelChanges(
  fieldName: (field: string) => string,
  model: string,
  before: { readonly fields: Readonly<Record<string, AnyField>> },
  after: { readonly fields: Readonly<Record<string, AnyField>> },
): readonly string[] {
  const named = (field: string) => `Field "${fieldName(field)}" of embedded model "${model}"`;
  const kept = Object.entries(after.fields).flatMap(([field, definition]) => {
    const previous = Object.hasOwn(before.fields, field) ? before.fields[field] : undefined;
    if (previous === undefined) {
      return definition.nullable ? [] : [`${named(field)} is new and required`];
    }
    if (typeKey(previous) !== typeKey(definition)) return [`${named(field)} changes type`];
    return previous.nullable && !definition.nullable ? [`${named(field)} becomes required`] : [];
  });
  const removed = Object.keys(before.fields)
    .filter((field) => !Object.hasOwn(after.fields, field))
    .map((field) => `${named(field)} is removed`);
  return [...kept, ...removed];
}

/**
 * The changes the plan does not rewrite the documents for, and that are not statements: a change to
 * a field of an embedded model, a field of a value object whose type changes, a field that moves to
 * another value object or between a scalar and a value object, and a field that gains an enum or
 * changes enum. Each is a warning that names the field; the validator change's document check then
 * fails the apply until the documents fit.
 */
export function documentsNotRewrittenWarnings(
  input: ModelMatchInput,
): readonly MigrationPlannerConflict[] {
  const modelFields = modelCoordinates(input.contract).flatMap((model) => {
    const after = modelAt(input.contract, model);
    const origin = originModelOf(model, input);
    const before = origin === undefined ? undefined : modelAt(input.fromContract, origin);
    if (after === undefined || before === undefined) return [];
    if (embeddedModelReason(input.contract, model) !== undefined) {
      const fieldName = (field: string) => fieldStatementText(input.contract, { ...model, field });
      return embeddedModelChanges(fieldName, model.model, before, after).map(warning);
    }
    return Object.entries(after.fields).flatMap(([field, definition]) => {
      const originField = originFieldOf({ ...model, field }, input.statements);
      if (!Object.hasOwn(before.fields, originField)) return [];
      const previous = before.fields[originField];
      const change =
        previous === undefined
          ? undefined
          : untouchedChange(
              fieldStatementText(input.contract, { ...model, field }),
              previous,
              definition,
            );
      return change === undefined ? [] : [warning(change)];
    });
  });
  const valueObjectFields = valueObjectsWithCoordinates(input.contract.storage).flatMap(
    ({ coordinate, valueObject }) => {
      const before = valueObjectAt(input.fromContract.storage, coordinate);
      if (before === undefined) return [];
      return Object.entries(valueObject.fields).flatMap(([field, definition]) => {
        const previous = Object.hasOwn(before.fields, field) ? before.fields[field] : undefined;
        if (previous === undefined) return [];
        const name = `${coordinate.entityName}.${field}`;
        const change =
          untouchedChange(name, previous, definition) ??
          (typeKey(previous) === typeKey(definition)
            ? undefined
            : `Field "${name}" of a value object changes type`);
        return change === undefined ? [] : [warning(change)];
      });
    },
  );
  return [...modelFields, ...valueObjectFields];
}
