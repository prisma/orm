import {
  type ApplicationDomainNamespace,
  asNamespaceId,
  type ContractModelBase,
  type ContractWithDomain,
} from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import {
  type FieldCoordinate,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  errorStatementInvalid,
  errorStatementOriginUnknown,
  errorStatementUnresolved,
} from '../../utils/cli-errors';
import {
  mixedSidesFix,
  type ParsedRename,
  parseRenameStatement,
  type StatementSide,
} from './parse-rename';
import type { StatementText } from './statement-text';

/**
 * The origin contract statements resolve against, or where the command looked
 * for it without finding it.
 */
export type StatementOrigin =
  | { readonly kind: 'contract'; readonly contract: ContractWithDomain }
  | {
      readonly kind: 'missing';
      readonly hash: string | null;
      readonly snapshotDirectory: string;
      /** Why the snapshot that exists for `hash` could not be read; `undefined` when there is none. */
      readonly unreadable: string | undefined;
    };

/**
 * `origin` and `destination` are the application contract space's contracts;
 * names that exist only in an extension space never resolve.
 */
export interface ResolveStatementsInput {
  /** The statements as the user wrote them, in the order given. */
  readonly statements: readonly StatementText[];
  readonly origin: StatementOrigin;
  readonly destination: ContractWithDomain;
}

type Side = 'old' | 'new';

interface NamedContract {
  readonly name: 'origin' | 'destination';
  readonly contract: ContractWithDomain;
}

interface FoundModel {
  readonly coordinate: ModelCoordinate;
  readonly model: ContractModelBase;
}

interface Refusal {
  readonly reason: string;
  readonly fix: string;
  /** Set when a field's model has no origin counterpart: the model, as the destination names it. */
  readonly modelWithoutCounterpart?: string;
}

type ModelLookup =
  | ({ readonly kind: 'found' } & FoundModel)
  | ({ readonly kind: 'missing' | 'refused' } & Refusal);

interface ModelReading extends FoundModel {
  readonly entity: 'model';
}

interface FieldReading {
  readonly entity: 'field';
  readonly coordinate: FieldCoordinate;
  readonly model: ContractModelBase;
  readonly destinationModel: ModelCoordinate | undefined;
}

type SideReading = ModelReading | FieldReading;

interface ResolutionState {
  readonly origin: NamedContract;
  readonly destination: NamedContract;
  readonly originOfRenamedModel: Map<string, ModelCoordinate>;
  readonly renamedFrom: Set<string>;
  readonly renamedTo: Set<string>;
}

const MODEL_RENAMES = 'model';
const FIELD_RENAMES = 'field';
const LISTED_LIMIT = 20;

const CHECK_NAMES_FIX =
  'The old name must exist in the origin contract and not in the destination contract, and the new name the other way round. Names match exactly, including case.';
const STORED_NAME_ONLY =
  'If only the stored name changed (@map or @@map), a statement cannot state that in this release, and a plan without it drops and creates what the model or field is stored in, with its data. With migration plan, edit the planned migration.ts to rename the stored name instead of dropping and creating it. With db update, rename it in the database yourself first, then run db update, which then finds nothing that loses data.';
const VALUE_OBJECT_FIX = 'Leave value objects and their fields out of the statements.';
const REPEATED_NAME_FIX =
  'Give each model or field at most one statement, and each new name to one model or field only.';

function qualifiedModel(coordinate: ModelCoordinate): string {
  return modelDisplayName(coordinate);
}

function displayName(namespaceId: string, name: string): string {
  return modelDisplayName({ namespaceId: asNamespaceId(namespaceId), model: name });
}

function qualifiedField(coordinate: FieldCoordinate): string {
  return `${qualifiedModel(coordinate)}.${coordinate.field}`;
}

function listed(names: readonly string[]): string {
  if (names.length === 0) return '(none)';
  const sorted = [...names].sort();
  const shown = sorted.slice(0, LISTED_LIMIT).join(', ');
  return sorted.length > LISTED_LIMIT ? `${shown} and ${sorted.length - LISTED_LIMIT} more` : shown;
}

function sentence(reason: string): string {
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}

function unresolved(statement: StatementText, refusal: Refusal): CliStructuredError {
  return errorStatementUnresolved(statement, sentence(refusal.reason), refusal.fix);
}

function modelIn(
  namespace: ApplicationDomainNamespace,
  name: string,
): ContractModelBase | undefined {
  return Object.hasOwn(namespace.models, name) ? namespace.models[name] : undefined;
}

function hasValueObject(namespace: ApplicationDomainNamespace, name: string): boolean {
  return namespace.valueObjects !== undefined && Object.hasOwn(namespace.valueObjects, name);
}

function modelAt(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ContractModelBase | undefined {
  const namespaces = contract.domain.namespaces;
  const namespace = Object.hasOwn(namespaces, coordinate.namespaceId)
    ? namespaces[coordinate.namespaceId]
    : undefined;
  return namespace === undefined ? undefined : modelIn(namespace, coordinate.model);
}

function fieldNames(model: ContractModelBase): readonly string[] {
  return [...Object.keys(model.fields), ...Object.keys(model.relations)];
}

function hasField(model: ContractModelBase, field: string): boolean {
  return Object.hasOwn(model.fields, field) || Object.hasOwn(model.relations, field);
}

function missing(reason: string): Refusal {
  return { reason, fix: CHECK_NAMES_FIX };
}

function valueObjectRefusal(name: string): Refusal {
  return {
    reason: `"${name}" is a value object, and value object renames are not supported in this release`,
    fix: VALUE_OBJECT_FIX,
  };
}

function lookupModelInNamespace(
  contract: NamedContract,
  namespaceId: string,
  namespace: ApplicationDomainNamespace,
  name: string,
): ModelLookup {
  const model = modelIn(namespace, name);
  if (model !== undefined) {
    return {
      kind: 'found',
      coordinate: { namespaceId: asNamespaceId(namespaceId), model: name },
      model,
    };
  }
  if (hasValueObject(namespace, name)) {
    return { kind: 'refused', ...valueObjectRefusal(displayName(namespaceId, name)) };
  }
  return {
    kind: 'missing',
    ...missing(
      `the ${contract.name} contract has no model "${name}" in namespace "${namespaceId}" (models there: ${listed(Object.keys(namespace.models))})`,
    ),
  };
}

function lookupModel(
  contract: NamedContract,
  namespaceId: string | undefined,
  name: string,
): ModelLookup {
  const namespaces = contract.contract.domain.namespaces;
  if (namespaceId !== undefined) {
    const namespace = Object.hasOwn(namespaces, namespaceId) ? namespaces[namespaceId] : undefined;
    if (namespace === undefined) {
      const named = Object.keys(namespaces).filter((id) => id !== UNBOUND_NAMESPACE_ID);
      return {
        kind: 'missing',
        ...missing(
          named.length === 0
            ? `the ${contract.name} contract has no namespaces`
            : `the ${contract.name} contract has no namespace "${namespaceId}" (namespaces: ${listed(named)})`,
        ),
      };
    }
    return lookupModelInNamespace(contract, namespaceId, namespace, name);
  }
  const declaring = Object.entries(namespaces).filter(
    ([, namespace]) => modelIn(namespace, name) !== undefined,
  );
  const [only] = declaring;
  if (only !== undefined && declaring.length === 1) {
    return lookupModelInNamespace(contract, only[0], only[1], name);
  }
  if (declaring.length > 1) {
    // The only way to name a model of the unbound namespace here is its namespace id.
    const candidates = declaring.map(([id]) => `${id}.${name}`).sort();
    return {
      kind: 'refused',
      reason: `"${name}" is a model in more than one namespace of the ${contract.name} contract (${listed(candidates)})`,
      fix: `Name the model with its namespace, for example ${candidates[0]}.`,
    };
  }
  if (Object.values(namespaces).some((namespace) => hasValueObject(namespace, name))) {
    return { kind: 'refused', ...valueObjectRefusal(name) };
  }
  const models = Object.entries(namespaces).flatMap(([id, namespace]) =>
    Object.keys(namespace.models).map((model) => displayName(id, model)),
  );
  return {
    kind: 'missing',
    ...missing(`the ${contract.name} contract has no model "${name}" (models: ${listed(models)})`),
  };
}

function readModel(
  state: ResolutionState,
  side: Side,
  namespaceId: string | undefined,
  name: string,
): Result<ModelReading, Refusal> {
  const lookup = lookupModel(side === 'old' ? state.origin : state.destination, namespaceId, name);
  if (lookup.kind !== 'found') return notOk(lookup);
  return ok({ entity: 'model', coordinate: lookup.coordinate, model: lookup.model });
}

function readFieldOf(
  contract: NamedContract,
  found: FoundModel,
  field: string,
  destinationModel: ModelCoordinate | undefined,
): Result<FieldReading, Refusal> {
  if (!hasField(found.model, field)) {
    return notOk(
      missing(
        `the ${contract.name} model "${qualifiedModel(found.coordinate)}" has no field "${field}" (fields: ${listed(fieldNames(found.model))})`,
      ),
    );
  }
  return ok({
    entity: 'field',
    coordinate: { ...found.coordinate, field },
    model: found.model,
    destinationModel,
  });
}

function originCounterpart(
  state: ResolutionState,
  destinationModel: ModelCoordinate,
): FoundModel | undefined {
  const coordinate =
    state.originOfRenamedModel.get(qualifiedModel(destinationModel)) ?? destinationModel;
  const model = modelAt(state.origin.contract, coordinate);
  return model === undefined ? undefined : { coordinate, model };
}

/**
 * The old side of a field rename names the model as the destination spells
 * it, and the field as the origin counterpart of that model has it. When the
 * model is not in the destination but the origin has it with that field, the
 * reading still resolves so the caller can say the field would move between
 * models.
 */
function readOldField(
  state: ResolutionState,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, Refusal> {
  const destination = lookupModel(state.destination, namespaceId, modelName);
  if (destination.kind === 'found') {
    const counterpart = originCounterpart(state, destination.coordinate);
    if (counterpart === undefined) {
      const name = qualifiedModel(destination.coordinate);
      return notOk({
        reason: `the destination model "${name}" has no counterpart in the origin contract: the origin has no model "${name}" and no earlier statement renames a model to it`,
        fix: `Rename the origin model to "${name}" with its own --rename statement before this one, or check the names.`,
        modelWithoutCounterpart: name,
      });
    }
    return readFieldOf(state.origin, counterpart, field, destination.coordinate);
  }
  if (destination.kind === 'refused') return notOk(destination);
  const origin = lookupModel(state.origin, namespaceId, modelName);
  if (origin.kind === 'found' && hasField(origin.model, field)) {
    return readFieldOf(state.origin, origin, field, undefined);
  }
  return notOk(destination);
}

function readNewField(
  state: ResolutionState,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, Refusal> {
  const destination = lookupModel(state.destination, namespaceId, modelName);
  if (destination.kind !== 'found') return notOk(destination);
  return readFieldOf(state.destination, destination, field, destination.coordinate);
}

function readField(
  state: ResolutionState,
  side: Side,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, Refusal> {
  return side === 'old'
    ? readOldField(state, namespaceId, modelName, field)
    : readNewField(state, namespaceId, modelName, field);
}

function readSide(
  state: ResolutionState,
  side: Side,
  segments: StatementSide,
): Result<SideReading, Refusal> {
  if (segments.length === 1) return readModel(state, side, undefined, segments[0]);
  if (segments.length === 3) return readField(state, side, ...segments);
  const [first, second] = segments;
  const asModel = readModel(state, side, first, second);
  const asField = readField(state, side, undefined, first, second);
  if (asModel.ok && asField.ok) {
    return notOk({
      reason: `"${first}.${second}" resolves both as namespace "${first}" model "${second}" and as model "${first}" field "${second}"`,
      fix: 'Write the field as namespace.Model.field if you mean the field.',
    });
  }
  if (asModel.ok) return asModel;
  if (asField.ok) return asField;
  const contract = side === 'old' ? state.origin : state.destination;
  const hasNamespaces = Object.keys(contract.contract.domain.namespaces).some(
    (id) => id !== UNBOUND_NAMESPACE_ID,
  );
  if (!hasNamespaces) return asField;
  return notOk({
    ...missing(
      `"${first}.${second}" resolves neither as namespace.Model (${asModel.failure.reason}) nor as Model.field (${asField.failure.reason})`,
    ),
    ...ifDefined('modelWithoutCounterpart', asField.failure.modelWithoutCounterpart),
  });
}

function resolveModelRename(
  state: ResolutionState,
  statement: ParsedRename,
  from: ModelCoordinate,
  to: ModelCoordinate,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const fromKey = `${MODEL_RENAMES}:${qualifiedModel(from)}`;
  const toKey = `${MODEL_RENAMES}:${qualifiedModel(to)}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames "${qualifiedModel(from)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames a model to "${qualifiedModel(to)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (qualifiedModel(from) === qualifiedModel(to)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `The statement renames model "${qualifiedModel(from)}" to itself.`,
        `Leave out --${statement.verb} ${statement.text}. ${STORED_NAME_ONLY}`,
      ),
    );
  }
  if (
    modelAt(state.origin.contract, to) !== undefined &&
    modelAt(state.destination.contract, from) !== undefined
  ) {
    return notOk(swapRefusal(statement, 'model', qualifiedModel(from), qualifiedModel(to)));
  }
  if (modelAt(state.origin.contract, to) !== undefined) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `"${qualifiedModel(to)}" already exists in the origin contract, so it cannot be the new name of a model.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  if (modelAt(state.destination.contract, from) !== undefined) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `"${qualifiedModel(from)}" still exists in the destination contract, so it was not renamed.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  state.originOfRenamedModel.set(qualifiedModel(to), from);
  return ok({ kind: 'rename', entity: 'model', from, to });
}

function modelPart(side: StatementSide): string {
  return side.slice(0, -1).join('.');
}

/**
 * The old side names a model the destination contract does not have. The
 * user most likely named the field's model by its old name, so the error
 * writes the statement with the model named as the destination names it.
 */
function oldModelNotInDestination(
  state: ResolutionState,
  statement: ParsedRename,
  from: FieldReading,
  toModel: string,
): CliStructuredError {
  const oldModel = modelPart(statement.from);
  const newModel = modelPart(statement.to);
  const corrected = `${newModel}.${from.coordinate.field}:${statement.to.join('.')}`;
  const renamedEarlier = state.originOfRenamedModel.get(toModel);
  const modelRenamed =
    renamedEarlier !== undefined &&
    qualifiedModel(renamedEarlier) === qualifiedModel(from.coordinate);
  const modelStatement = `${oldModel}:${newModel}`;
  const why = [
    `"${qualifiedModel(from.coordinate)}" is not a model of the destination contract, and a field cannot move between models.`,
    `Name a field's model as the destination contract names it: --${statement.verb} ${corrected}.`,
    ...(modelRenamed
      ? []
      : [`The model also needs its own statement, --rename ${modelStatement}, before it.`]),
  ].join(' ');
  const fix = modelRenamed
    ? `Write the statement as --${statement.verb} ${corrected}.`
    : `Write the statements as --rename ${modelStatement} --${statement.verb} ${corrected}.`;
  return errorStatementInvalid(statement, why, fix);
}

function fieldMovesBetweenModels(
  statement: StatementText,
  fromModel: string,
  toModel: string,
): CliStructuredError {
  return errorStatementInvalid(
    statement,
    `The old name is a field of "${fromModel}" and the new name a field of "${toModel}"; a field cannot move between models.`,
    'Rename a field within one model, and name that model as the destination contract names it.',
  );
}

/**
 * True when the old side most likely names the new side's model by its old
 * name: no earlier statement renamed the old model to some other model or
 * some other model to the new model, and the origin does not have the new
 * model.
 */
function oldSideNamesNewModel(
  state: ResolutionState,
  from: FieldReading,
  to: FieldReading,
): boolean {
  const oldModel = qualifiedModel(from.coordinate);
  const renamedTo = [...state.originOfRenamedModel.entries()].find(
    ([, origin]) => qualifiedModel(origin) === oldModel,
  )?.[0];
  if (renamedTo !== undefined) return renamedTo === qualifiedModel(to.coordinate);
  if (state.originOfRenamedModel.has(qualifiedModel(to.coordinate))) return false;
  return modelAt(state.origin.contract, to.coordinate) === undefined;
}

function resolveFieldRename(
  state: ResolutionState,
  statement: ParsedRename,
  from: FieldReading,
  to: FieldReading,
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const toModel = qualifiedModel(to.coordinate);
  if (from.destinationModel === undefined) {
    return notOk(
      oldSideNamesNewModel(state, from, to)
        ? oldModelNotInDestination(state, statement, from, toModel)
        : fieldMovesBetweenModels(statement, qualifiedModel(from.coordinate), toModel),
    );
  }
  if (qualifiedModel(from.destinationModel) !== toModel) {
    return notOk(
      fieldMovesBetweenModels(statement, qualifiedModel(from.destinationModel), toModel),
    );
  }
  const fromKey = `${FIELD_RENAMES}:${qualifiedField(from.coordinate)}`;
  const toKey = `${FIELD_RENAMES}:${qualifiedField(to.coordinate)}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames "${qualifiedField(from.coordinate)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        statement,
        `An earlier statement already renames a field to "${qualifiedField(to.coordinate)}".`,
        REPEATED_NAME_FIX,
      ),
    );
  }
  if (from.coordinate.field === to.coordinate.field) {
    return notOk(
      errorStatementInvalid(
        statement,
        `The statement renames field "${toModel}.${to.coordinate.field}" to itself.`,
        `Leave out --${statement.verb} ${statement.text}. ${STORED_NAME_ONLY}`,
      ),
    );
  }
  if (hasField(from.model, to.coordinate.field) && hasField(to.model, from.coordinate.field)) {
    return notOk(
      swapRefusal(
        statement,
        'field',
        `${toModel}.${from.coordinate.field}`,
        `${toModel}.${to.coordinate.field}`,
      ),
    );
  }
  if (hasField(from.model, to.coordinate.field)) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `The field "${to.coordinate.field}" already exists on the origin model "${qualifiedModel(from.coordinate)}", so it cannot be the new name of a field.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  if (hasField(to.model, from.coordinate.field)) {
    return notOk(
      errorStatementUnresolved(
        statement,
        `The field "${from.coordinate.field}" still exists on the destination model "${toModel}", so it was not renamed.`,
        CHECK_NAMES_FIX,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  return ok({ kind: 'rename', entity: 'field', from: from.coordinate, to: to.coordinate });
}

/**
 * Two names that trade places: each is an old name and a new name, which one plan cannot do.
 * Statements resolve against contracts, so the swap takes three plans through a temporary name.
 */
function swapRefusal(
  statement: ParsedRename,
  entity: 'model' | 'field',
  first: string,
  second: string,
): CliStructuredError {
  const verb = statement.verb;
  const oldName = statement.from.join('.');
  const newName = statement.to.join('.');
  const temporary =
    entity === 'field'
      ? `${statement.to.slice(0, -1).join('.')}.<temporary name>`
      : '<temporary name>';
  return errorStatementInvalid(
    statement,
    `"${first}" and "${second}" swap names: each is both an old name and a new name, and statements cannot swap names in one plan.`,
    `Make the swap in three plans. First change the contract so that "${first}" has a temporary name, and plan it with --${verb} ${oldName}:${temporary}. Then give "${second}" the name "${first}", and plan it with --${verb} ${newName}:${oldName}. Then give the temporary name the name "${second}", and plan it with --${verb} ${temporary}:${newName}.`,
  );
}

/**
 * The old side does not resolve. Says so in terms of what the user can do next when the statement
 * is the wrong way round, when the rename has already happened, or when a later statement renames
 * the field's model.
 */
function oldSideRefusal(
  state: ResolutionState,
  statement: ParsedRename,
  later: readonly ParsedRename[],
  refusal: Refusal,
): CliStructuredError {
  const oldText = statement.from.join('.');
  const newText = statement.to.join('.');
  const newIsInOrigin = readSide(state, 'old', statement.to).ok;
  const newIsInDestination = readSide(state, 'new', statement.to).ok;
  const oldIsInDestination = readSide(state, 'new', statement.from).ok;
  if (newIsInOrigin && oldIsInDestination && !newIsInDestination) {
    return errorStatementUnresolved(
      statement,
      `The statement is the wrong way round: "${newText}" is the old name, in the origin contract, and "${oldText}" the new name, in the destination contract.`,
      `Write the old name first: --${statement.verb} ${newText}:${oldText}.`,
    );
  }
  if (newIsInOrigin && newIsInDestination && !oldIsInDestination) {
    return errorStatementUnresolved(
      statement,
      `The origin contract already has "${newText}" and has no "${oldText}", so this rename has already happened. For db update, the database is already at the new name.`,
      `Leave out --${statement.verb} ${statement.text}.`,
    );
  }
  const model = refusal.modelWithoutCounterpart;
  const renamesModel =
    model === undefined
      ? undefined
      : later.find(
          (candidate) =>
            candidate.to.length < 3 &&
            readSide(state, 'new', candidate.to).ok &&
            [model, model.split('.').pop()].includes(candidate.to.join('.')),
        );
  if (renamesModel !== undefined) {
    return errorStatementUnresolved(
      statement,
      `${sentence(refusal.reason)} A later statement, --${renamesModel.verb} ${renamesModel.text}, renames it, and statements apply in the order given.`,
      `Put --${renamesModel.verb} ${renamesModel.text} before --${statement.verb} ${statement.text}.`,
    );
  }
  return unresolved(statement, refusal);
}

function resolveStatement(
  state: ResolutionState,
  statement: ParsedRename,
  later: readonly ParsedRename[],
): Result<ResolvedMigrationStatement, CliStructuredError> {
  const from = readSide(state, 'old', statement.from);
  if (!from.ok) return notOk(oldSideRefusal(state, statement, later, from.failure));
  const to = readSide(state, 'new', statement.to);
  if (!to.ok) return notOk(unresolved(statement, to.failure));
  if (from.value.entity === 'model' && to.value.entity === 'model') {
    return resolveModelRename(state, statement, from.value.coordinate, to.value.coordinate);
  }
  if (from.value.entity === 'field' && to.value.entity === 'field') {
    return resolveFieldRename(state, statement, from.value, to.value);
  }
  return notOk(
    errorStatementInvalid(
      statement,
      'The statement names a model on one side and a field on the other.',
      mixedSidesFix(statement.verb, statement.from, statement.to),
    ),
  );
}

/**
 * Resolves the statements a user gave, in order, against the origin and
 * destination contracts. Each resolved statement names its old and new entity
 * by namespace, model and field.
 */
export function resolveStatements(
  input: ResolveStatementsInput,
): Result<readonly ResolvedMigrationStatement[], CliStructuredError> {
  if (input.statements.length === 0) return ok([]);
  if (input.origin.kind === 'missing') {
    return notOk(errorStatementOriginUnknown(input.origin));
  }
  const state: ResolutionState = {
    origin: { name: 'origin', contract: input.origin.contract },
    destination: { name: 'destination', contract: input.destination },
    originOfRenamedModel: new Map(),
    renamedFrom: new Set(),
    renamedTo: new Set(),
  };
  const parsed: ParsedRename[] = [];
  for (const entry of input.statements) {
    const statement = parseRenameStatement(entry);
    if (!statement.ok) return statement;
    parsed.push(statement.value);
  }
  const resolved: ResolvedMigrationStatement[] = [];
  for (const [index, statement] of parsed.entries()) {
    const result = resolveStatement(state, statement, parsed.slice(index + 1));
    if (!result.ok) return result;
    resolved.push(result.value);
  }
  return ok(resolved);
}
