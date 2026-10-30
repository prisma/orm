import { asNamespaceId, type ContractWithDomain, type NamespaceId } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '../ir/namespace';

/** A model: its namespace and its name as the contract source writes it, never a table name. */
export interface ModelCoordinate {
  readonly namespaceId: NamespaceId;
  readonly model: string;
}

/**
 * A field of a model, named as the contract's model keys it in `fields`. Whether that is the
 * field's name in the contract source or its stored name in every family is not settled yet.
 */
export interface FieldCoordinate extends ModelCoordinate {
  readonly field: string;
}

/** A member of an enum the contract declares, named as the contract source names it, never by its stored value. */
export interface EnumValueCoordinate {
  readonly namespaceId: NamespaceId;
  readonly enum: string;
  readonly member: string;
}

/** A field of a value object; `namespaceId` is the storage namespace the value object lives in. */
export interface ValueObjectFieldCoordinate {
  readonly namespaceId: NamespaceId;
  readonly valueObject: string;
  readonly field: string;
}

export interface ResolvedModelRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'model';
  readonly from: ModelCoordinate;
  readonly to: ModelCoordinate;
}

export interface ResolvedFieldRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'field';
  readonly from: FieldCoordinate;
  readonly to: FieldCoordinate;
}

/** A member of an enum renamed: `from` names it in the origin contract and `to` in the destination, in the same enum. */
export interface ResolvedEnumValueRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'enumValue';
  readonly from: EnumValueCoordinate;
  readonly to: EnumValueCoordinate;
}

/** A field of a value object renamed: `from` names it in the origin contract and `to` in the destination, in the same value object. */
export interface ResolvedValueObjectFieldRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'valueObjectField';
  readonly from: ValueObjectFieldCoordinate;
  readonly to: ValueObjectFieldCoordinate;
}

/** A namespace renamed: `from` is a namespace of the origin contract and `to` one of the destination. */
export interface ResolvedNamespaceRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'namespace';
  readonly from: NamespaceId;
  readonly to: NamespaceId;
}

/** A rename: `from` is a coordinate of the origin contract and `to` one of the destination contract. */
export type ResolvedRenameStatement =
  | ResolvedNamespaceRenameStatement
  | ResolvedModelRenameStatement
  | ResolvedFieldRenameStatement
  | ResolvedEnumValueRenameStatement
  | ResolvedValueObjectFieldRenameStatement;

/** A field whose values the migration converts to its new type with code the user writes. */
export interface ResolvedFieldConvertStatement {
  readonly kind: 'convert';
  readonly entity: 'field';
  /** The field as the destination contract names it. */
  readonly field: FieldCoordinate;
}

/** A required field whose values in existing rows the migration fills with code the user writes. */
export interface ResolvedFieldBackfillStatement {
  readonly kind: 'backfill';
  readonly entity: 'field';
  /** The field as the destination contract names it. */
  readonly field: FieldCoordinate;
}

/** A required field of a value object whose values in existing data the migration fills with a value the user writes. */
export interface ResolvedValueObjectFieldBackfillStatement {
  readonly kind: 'backfill';
  readonly entity: 'valueObjectField';
  /** The field as the destination contract names it. */
  readonly field: ValueObjectFieldCoordinate;
}

/** A variant whose discriminator value changed, whose stored discriminator values the migration rewrites to the new one. */
export interface ResolvedVariantConvertStatement {
  readonly kind: 'convert';
  readonly entity: 'model';
  /** The variant as the destination contract names it. */
  readonly model: ModelCoordinate;
}

/**
 * A statement resolved against the origin and destination contracts into domain coordinates. `kind`
 * names what the statement asks the plan to do, and `entity` the kind of coordinate it names.
 */
export type ResolvedMigrationStatement =
  | ResolvedRenameStatement
  | ResolvedFieldConvertStatement
  | ResolvedFieldBackfillStatement
  | ResolvedValueObjectFieldBackfillStatement
  | ResolvedVariantConvertStatement;

export function isRenameStatement(
  statement: ResolvedMigrationStatement,
): statement is ResolvedRenameStatement {
  return statement.kind === 'rename';
}

/**
 * What an operation of a plan is about, in the contract's terms where the family can say: a model
 * or a field of the origin contract, or, when no model of the origin contract stores it, the name
 * the database knows it by. Told apart by `kind`, not by a statement's `entity`, because a storage
 * name is not an entity of the contract.
 */
export type MigrationSubject =
  | ({ readonly kind: 'model' } & ModelCoordinate)
  | ({ readonly kind: 'field' } & FieldCoordinate)
  | ({ readonly kind: 'enumValue' } & EnumValueCoordinate)
  | ({ readonly kind: 'valueObjectField' } & ValueObjectFieldCoordinate)
  | { readonly kind: 'storage'; readonly name: string };

/** A key that is equal for two subjects exactly when they name the same thing. */
export function migrationSubjectKey(subject: MigrationSubject): string {
  switch (subject.kind) {
    case 'model':
      return JSON.stringify(['model', subject.namespaceId, subject.model]);
    case 'field':
      return JSON.stringify(['field', subject.namespaceId, subject.model, subject.field]);
    case 'enumValue':
      return JSON.stringify(['enumValue', subject.namespaceId, subject.enum, subject.member]);
    case 'valueObjectField':
      return JSON.stringify([
        'valueObjectField',
        subject.namespaceId,
        subject.valueObject,
        subject.field,
      ]);
    case 'storage':
      return JSON.stringify(['storage', subject.name]);
  }
}

/** An operation of a plan, by its position in the plan's `operations`, and its subject. */
export interface MigrationOperationSubject {
  readonly operationIndex: number;
  readonly subject: MigrationSubject;
}

/** An operation that changes who can read or write its subject's data. */
export interface MigrationAccessChange extends MigrationOperationSubject {
  /** True when it lets more people read or write; false when the change can go either way. */
  readonly widens: boolean;
}

/**
 * How an operation loses its subject's data: `drop` removes the subject, and `typeChange` keeps the
 * field but changes its type, which loses the values that do not fit the new one.
 */
export type MigrationDataLossKind = 'drop' | 'typeChange';

/** An operation that loses data: its subject, how it loses that subject's data, and how to keep it. */
export interface MigrationDataLoss extends MigrationOperationSubject {
  /** How the operation loses the data; absent for an operation of a recorded migration, which does not say. */
  readonly loss?: MigrationDataLossKind;
  /** The label of the operation that loses the data, which names it while a slot of the plan is unfilled. */
  readonly label: string;
  /** How to keep the data instead, in the target's words, when no statement can say so. */
  readonly keepDataAdvice?: string;
  /** The edit to a planned `migration.ts` that keeps the data instead, when no statement can say so. */
  readonly keepDataEdit?: KeepDataEdit;
}

/** An edit to a `migration.ts`: the call `remove`, as the target writes it, replaced by `replaceWith`. */
export interface KeepDataEdit {
  readonly remove: string;
  readonly replaceWith: string;
  /** Whether the edit moves stored values between members that trade them, through a temporary value. */
  readonly swapsValues?: boolean;
}

/**
 * A required field a plan adds to a table that may have rows, which every existing row gets one temporary value for. A
 * backfill statement for the field fills them instead.
 */
export interface MigrationTemporaryValue extends MigrationOperationSubject {
  /** The value as the target writes it, such as `''` or `0`. */
  readonly value: string;
}

/**
 * What the operations of a plan lose, whose access they change, and which new required fields they
 * give a temporary value, each by its position in the plan.
 */
export interface MigrationPlanSubjects<
  TLoss extends MigrationDataLoss = MigrationDataLoss,
  TAccess extends MigrationAccessChange = MigrationAccessChange,
  TTemporary = MigrationTemporaryValue,
> {
  /** Each operation that loses data, in plan order, with what it loses. */
  readonly dataLoss: readonly TLoss[];
  /** Each operation that changes who can read or write data, in plan order, with what it is about. */
  readonly accessChanges: readonly TAccess[];
  /** Each new required field whose existing rows the plan gives a temporary value, in plan order. */
  readonly temporaryValues: readonly TTemporary[];
}

/**
 * The namespaces a plan changes, by namespace id: `removed` are those of the origin contract whose
 * tables the plan drops with them because the destination no longer declares them, and `added`
 * are those the destination declares and the origin does not. A planner without namespaces reports
 * neither.
 */
export interface MigrationPlanNamespaces {
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

/**
 * A statement as a plan applied it: `operationIndexes` are the positions, in the plan's
 * `operations`, of the operations the statement accounts for, in plan order, and empty when the
 * storage did not change. Statements refer to operations by position because operation ids are
 * not unique within a plan.
 */
export interface AppliedMigrationStatement {
  readonly statement: ResolvedMigrationStatement;
  readonly operationIndexes: readonly number[];
}

/**
 * A model's name in messages: `namespace.Model`, or `Model` alone in the unbound namespace, whose
 * id is internal.
 */
export function modelDisplayName(coordinate: ModelCoordinate): string {
  return coordinate.namespaceId === UNBOUND_NAMESPACE_ID
    ? coordinate.model
    : `${coordinate.namespaceId}.${coordinate.model}`;
}

/** A model as a statement names it: with its namespace only when the contract has several. */
export function modelStatementText(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): string {
  return Object.keys(contract.domain.namespaces).length > 1
    ? modelDisplayName(coordinate)
    : coordinate.model;
}

/** A field as a statement names it, through its model: `User.age`, or `app.User.age` when the contract has several namespaces. */
export function fieldStatementText(contract: ContractWithDomain, field: FieldCoordinate): string {
  return `${modelStatementText(contract, field)}.${field.field}`;
}

/** An enum member as a statement names it, through its enum: `Status.ARCHIVED`, or `app.Status.ARCHIVED` when the contract has several namespaces. */
export function enumValueStatementText(
  contract: ContractWithDomain,
  value: EnumValueCoordinate,
): string {
  return `${modelStatementText(contract, { namespaceId: value.namespaceId, model: value.enum })}.${value.member}`;
}

/** A value object field as a statement names it, through its value object: `GeoPoint.lat`, or `app.GeoPoint.lat` when the contract has several namespaces. */
export function valueObjectFieldStatementText(
  contract: ContractWithDomain,
  field: ValueObjectFieldCoordinate,
): string {
  return `${modelStatementText(contract, { namespaceId: field.namespaceId, model: field.valueObject })}.${field.field}`;
}

/** A model coordinate in JSON output: `namespaceId` is left out for the unbound namespace. */
export interface ModelCoordinateJson {
  readonly namespaceId?: NamespaceId;
  readonly model: string;
}

/** A field coordinate in JSON output: `namespaceId` is left out for the unbound namespace. */
export interface FieldCoordinateJson extends ModelCoordinateJson {
  readonly field: string;
}

/** An enum member coordinate in JSON output: `namespaceId` is left out for the unbound namespace. */
export interface EnumValueCoordinateJson {
  readonly namespaceId?: NamespaceId;
  readonly enum: string;
  readonly member: string;
}

/** A value object field coordinate in JSON output: `namespaceId` is left out for the unbound namespace. */
export interface ValueObjectFieldCoordinateJson {
  readonly namespaceId?: NamespaceId;
  readonly valueObject: string;
  readonly field: string;
}

/** A resolved statement in JSON output, with each coordinate written as `*CoordinateJson`. */
export type MigrationStatementJson =
  | {
      readonly kind: 'rename';
      readonly entity: 'namespace';
      readonly from: { readonly namespaceId: NamespaceId };
      readonly to: { readonly namespaceId: NamespaceId };
    }
  | {
      readonly kind: 'rename';
      readonly entity: 'model';
      readonly from: ModelCoordinateJson;
      readonly to: ModelCoordinateJson;
    }
  | {
      readonly kind: 'rename';
      readonly entity: 'field';
      readonly from: FieldCoordinateJson;
      readonly to: FieldCoordinateJson;
    }
  | {
      readonly kind: 'rename';
      readonly entity: 'enumValue';
      readonly from: EnumValueCoordinateJson;
      readonly to: EnumValueCoordinateJson;
    }
  | {
      readonly kind: 'rename';
      readonly entity: 'valueObjectField';
      readonly from: ValueObjectFieldCoordinateJson;
      readonly to: ValueObjectFieldCoordinateJson;
    }
  | {
      readonly kind: 'convert' | 'backfill';
      readonly entity: 'field';
      readonly field: FieldCoordinateJson;
    }
  | {
      readonly kind: 'backfill';
      readonly entity: 'valueObjectField';
      readonly field: ValueObjectFieldCoordinateJson;
    }
  | {
      readonly kind: 'convert';
      readonly entity: 'model';
      readonly model: ModelCoordinateJson;
    };

/** A subject in JSON output: `namespaceId` is left out for the unbound namespace. */
export type MigrationSubjectJson =
  | ({ readonly kind: 'model' } & ModelCoordinateJson)
  | ({ readonly kind: 'field' } & FieldCoordinateJson)
  | ({ readonly kind: 'enumValue' } & EnumValueCoordinateJson)
  | ({ readonly kind: 'valueObjectField' } & ValueObjectFieldCoordinateJson)
  | { readonly kind: 'storage'; readonly name: string };

/** An enum value coordinate read from its JSON form, in which the unbound namespace is left out. */
export function enumValueCoordinateFromJson(json: EnumValueCoordinateJson): EnumValueCoordinate {
  return {
    namespaceId: json.namespaceId ?? asNamespaceId(UNBOUND_NAMESPACE_ID),
    enum: json.enum,
    member: json.member,
  };
}

/** An enum value coordinate in its JSON form, which leaves out the unbound namespace. */
export function enumValueCoordinateJson(value: EnumValueCoordinate): EnumValueCoordinateJson {
  return coordinateJson(value);
}

function coordinateJson<T extends { readonly namespaceId: NamespaceId }>(
  coordinate: T,
): Omit<T, 'namespaceId'> & { readonly namespaceId?: NamespaceId } {
  if (coordinate.namespaceId !== UNBOUND_NAMESPACE_ID) return coordinate;
  const { namespaceId: _unbound, ...rest } = coordinate;
  return rest;
}

/** The statement as JSON output writes it. */
export function migrationStatementJson(
  statement: ResolvedMigrationStatement,
): MigrationStatementJson {
  switch (statement.kind) {
    case 'convert':
      return statement.entity === 'model'
        ? { ...statement, model: coordinateJson(statement.model) }
        : { ...statement, field: coordinateJson(statement.field) };
    case 'backfill':
      return statement.entity === 'field'
        ? { ...statement, field: coordinateJson<FieldCoordinate>(statement.field) }
        : { ...statement, field: coordinateJson<ValueObjectFieldCoordinate>(statement.field) };
    case 'rename':
      return renameStatementJson(statement);
  }
}

function renameStatementJson(statement: ResolvedRenameStatement): MigrationStatementJson {
  switch (statement.entity) {
    case 'namespace':
      return {
        ...statement,
        from: { namespaceId: statement.from },
        to: { namespaceId: statement.to },
      };
    case 'model':
      return {
        ...statement,
        from: coordinateJson(statement.from),
        to: coordinateJson(statement.to),
      };
    case 'field':
      return {
        ...statement,
        from: coordinateJson(statement.from),
        to: coordinateJson(statement.to),
      };
    case 'enumValue':
      return {
        ...statement,
        from: coordinateJson(statement.from),
        to: coordinateJson(statement.to),
      };
    case 'valueObjectField':
      return {
        ...statement,
        from: coordinateJson(statement.from),
        to: coordinateJson(statement.to),
      };
  }
}

/** The subject as JSON output writes it. */
export function migrationSubjectJson(subject: MigrationSubject): MigrationSubjectJson {
  switch (subject.kind) {
    case 'model':
      return {
        kind: 'model',
        ...coordinateJson({ namespaceId: subject.namespaceId, model: subject.model }),
      };
    case 'field':
      return {
        kind: 'field',
        ...coordinateJson({
          namespaceId: subject.namespaceId,
          model: subject.model,
          field: subject.field,
        }),
      };
    case 'enumValue':
      return {
        kind: 'enumValue',
        ...coordinateJson({
          namespaceId: subject.namespaceId,
          enum: subject.enum,
          member: subject.member,
        }),
      };
    case 'valueObjectField':
      return {
        kind: 'valueObjectField',
        ...coordinateJson({
          namespaceId: subject.namespaceId,
          valueObject: subject.valueObject,
          field: subject.field,
        }),
      };
    case 'storage':
      return subject;
  }
}

function qualifiedModelText(coordinate: ModelCoordinate): string {
  return coordinate.namespaceId === UNBOUND_NAMESPACE_ID
    ? coordinate.model
    : `${coordinate.namespaceId}.${coordinate.model}`;
}

/**
 * The text that reports a statement, in domain names: a model or field is named with its
 * namespace only when its contract has more than one, and a model moved to another namespace always
 * is. A renamed field is named through its model as
 * the destination contract names it, as the statement itself is written.
 */
export function describeMigrationStatement(
  statement: ResolvedMigrationStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): string {
  if (statement.kind !== 'rename') return describeDataStatement(statement, contract);
  if (statement.entity === 'namespace') {
    return `rename namespace "${statement.from}" to "${statement.to}"`;
  }
  if (statement.entity === 'enumValue') {
    return `rename enum value "${enumValueStatementText(fromContract, statement.from)}" to "${enumValueStatementText(contract, statement.to)}"`;
  }
  if (statement.entity === 'valueObjectField') {
    return `rename value object field "${valueObjectFieldStatementText(fromContract, statement.from)}" to "${valueObjectFieldStatementText(contract, statement.to)}"`;
  }
  if (statement.entity === 'model') {
    const { from, to } = statement;
    if (from.namespaceId === to.namespaceId) {
      return `rename model "${modelStatementText(fromContract, from)}" to "${modelStatementText(contract, to)}"`;
    }
    if (from.model === to.model) {
      return `move model "${qualifiedModelText(from)}" to namespace "${to.namespaceId}"`;
    }
    return `rename model "${qualifiedModelText(from)}" to "${qualifiedModelText(to)}"`;
  }
  const model = modelStatementText(contract, statement.to);
  return `rename field "${model}.${statement.from.field}" to "${model}.${statement.to.field}"`;
}

function describeDataStatement(
  statement: Exclude<ResolvedMigrationStatement, ResolvedRenameStatement>,
  contract: ContractWithDomain,
): string {
  switch (statement.entity) {
    case 'field':
      return `${statement.kind} field "${fieldStatementText(contract, statement.field)}"`;
    case 'valueObjectField':
      return `${statement.kind} value object field "${valueObjectFieldStatementText(contract, statement.field)}"`;
    case 'model':
      return `${statement.kind} model "${modelStatementText(contract, statement.model)}"`;
  }
}
