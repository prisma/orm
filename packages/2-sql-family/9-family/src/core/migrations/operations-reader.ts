import type { MigrationRunnerPerSpaceOptions } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { type Type, type } from 'arktype';
import { sqlFamilyError } from '../errors';
import { storageDetailsOf } from './operation-storage-name';
import { RequiredColumnJson } from './required-column';
import { EarlierRowsHoldingValueJson, RowsHoldingValueJson } from './rows-holding-value';
import type { SqlMigrationPlanOperation } from './types';
import { ConvertedColumnJson } from './unconverted-field';
import type { DocumentPlace } from './unknown-key-probe';

/** What a target tells the SQL operations reader about the parts of an operation it alone defines. */
export interface SqlTargetOperationsFormat {
  /** The strict schema of an operation's `target.details`. */
  readonly targetDetails: Type<unknown>;
  /** Turns target details that only an earlier release wrote into the current form, before they are checked. */
  readonly toCurrentTargetDetails?: (details: Readonly<Record<string, unknown>>) => unknown;
  /** The entries of a step's `meta` the target alone writes and reads, each strict; other entries stay open. */
  readonly stepMeta?: Type<unknown>;
}

/** Which migrations the operations being read belong to, in order, so a refusal can name one. */
export interface SqlOperationsLocation {
  readonly space?: string;
  readonly migrations?: readonly Pick<
    MigrationRunnerPerSpaceOptions['migrationEdges'][number],
    'dirName' | 'operationCount'
  >[];
}

/**
 * Reads the operations of an `ops.json` into the operations this release works with. It refuses
 * any key the format does not define in an operation, its target, a step, a check's expectation,
 * or a step mark a reader acts on, and turns a shape only an earlier release wrote into the current
 * one. The places Prisma does not interpret stay open: a step's `params`, an operation's `meta`,
 * the entries of a step's `meta` no reader acts on, and a codec's `typeParams` inside a mark.
 */
export type SqlOperationsReader<TTargetDetails> = (
  operations: readonly unknown[],
  location?: SqlOperationsLocation,
) => readonly SqlMigrationPlanOperation<TTargetDetails>[];

const steps = ['precheck', 'execute', 'postcheck'] as const;

/**
 * The places in an `ops.json` the SQL operations reader leaves open, for `probeUnknownKeys`.
 * A target adds the entries of a step's `meta` it writes and no reader acts on.
 */
export const SQL_OPERATIONS_OPEN_PLACES: readonly DocumentPlace[] = [
  ['*', 'meta', '**'],
  ...steps.flatMap((step): DocumentPlace[] =>
    [
      [step, '*', 'params', '**'],
      [step, '*', 'meta'],
      [step, '*', 'meta', '*', 'codecRef', 'typeParams', '**'],
    ].map((place) => ['*', ...place]),
  ),
];

const SharedStepMeta = type({
  'requiredColumn?': RequiredColumnJson,
  'convertedColumn?': ConvertedColumnJson,
  'rowsHoldingValue?': RowsHoldingValueJson,
});

const CheckExpectationJson = type({
  '+': 'reject',
  expects: "'absent' | 'present'",
  object: 'string',
});

function operationSchema(
  targetDetails: Type<unknown>,
  targetStepMeta: Type<unknown> | undefined,
): Type<unknown> {
  const stepMeta =
    targetStepMeta === undefined ? SharedStepMeta : SharedStepMeta.and(targetStepMeta);
  const step = type({
    '+': 'reject',
    description: 'string',
    sql: 'string',
    'params?': 'unknown[]',
    'meta?': stepMeta,
    'expectation?': CheckExpectationJson,
  });
  return type({
    '+': 'reject',
    id: 'string',
    label: 'string',
    operationClass: "'additive' | 'widening' | 'destructive' | 'data'",
    'invariantId?': 'string',
    'summary?': 'string',
    target: { '+': 'reject', id: 'string', 'details?': targetDetails },
    precheck: step.array(),
    execute: step.array(),
    postcheck: step.array(),
    'meta?': 'Record<string, unknown>',
  });
}

function withoutUndefinedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefinedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      entry === undefined ? [] : [[key, withoutUndefinedKeys(entry)]],
    ),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withCurrentRemovalMark(
  step: unknown,
  details: { readonly name: string; readonly table?: string } | undefined,
): unknown {
  if (!isRecord(step) || !isRecord(step['meta'])) return step;
  const { rowsHoldingValue: mark, ...otherMeta } = step['meta'];
  if (!isRecord(mark) || ['table', 'column', 'storedValue'].some((key) => key in mark)) {
    return step;
  }
  const params = step['params'];
  const storedValue: unknown = Array.isArray(params) ? params[0] : undefined;
  if (
    details?.table !== undefined &&
    (typeof storedValue === 'string' || typeof storedValue === 'number')
  ) {
    return {
      ...step,
      meta: {
        ...otherMeta,
        rowsHoldingValue: { ...mark, table: details.table, column: details.name, storedValue },
      },
    };
  }
  return EarlierRowsHoldingValueJson.allows(mark) ? { ...step, meta: otherMeta } : step;
}

function withCurrentTargetDetails(
  operation: Readonly<Record<string, unknown>>,
  toCurrentTargetDetails: SqlTargetOperationsFormat['toCurrentTargetDetails'],
): Readonly<Record<string, unknown>> {
  const target = operation['target'];
  if (toCurrentTargetDetails === undefined || !isRecord(target) || !isRecord(target['details'])) {
    return operation;
  }
  return {
    ...operation,
    target: { ...target, details: toCurrentTargetDetails(target['details']) },
  };
}

/**
 * The operation with every shape only an earlier release wrote turned into the current one, so
 * the strict schema checks the current shape and nothing after the reader sees an earlier one.
 */
function inCurrentForm(
  operation: unknown,
  toCurrentTargetDetails: SqlTargetOperationsFormat['toCurrentTargetDetails'],
): unknown {
  if (!isRecord(operation)) return operation;
  const current = withCurrentTargetDetails(operation, toCurrentTargetDetails);
  const details = storageDetailsOf(current);
  const steps = (key: string): unknown => {
    const list = current[key];
    return Array.isArray(list) ? list.map((step) => withCurrentRemovalMark(step, details)) : list;
  };
  return {
    ...current,
    precheck: steps('precheck'),
    execute: steps('execute'),
    postcheck: steps('postcheck'),
  };
}

function migrationPlaceOf(
  index: number,
  location: SqlOperationsLocation | undefined,
): { readonly position: number; readonly migration: string | undefined } {
  let start = 0;
  for (const migration of location?.migrations ?? []) {
    if (index < start + migration.operationCount) {
      return { position: index - start, migration: migration.dirName };
    }
    start += migration.operationCount;
  }
  return { position: index, migration: undefined };
}

function operationIdOf(operation: unknown): string | undefined {
  if (operation === null || typeof operation !== 'object') return undefined;
  const id: unknown = Reflect.get(operation, 'id');
  return typeof id === 'string' ? id : undefined;
}

export function createSqlOperationsReader<TTargetDetails>(
  format: SqlTargetOperationsFormat,
): SqlOperationsReader<TTargetDetails> {
  const schema = operationSchema(format.targetDetails, format.stepMeta);
  return (operations, location) =>
    operations.map((operation, index) => {
      const result = schema(
        inCurrentForm(withoutUndefinedKeys(operation), format.toCurrentTargetDetails),
      );
      if (!(result instanceof type.errors)) {
        return blindCast<
          SqlMigrationPlanOperation<TTargetDetails>,
          'the schema checked the operation, and its target details against the target details schema'
        >(result);
      }
      const { position, migration } = migrationPlaceOf(index, location);
      const operationId = operationIdOf(operation);
      const named = operationId === undefined ? '' : ` ("${operationId}")`;
      const inMigration =
        migration === undefined
          ? ''
          : `In migration "${migration}"${location?.space === undefined ? '' : ` of space "${location.space}"`}: `;
      throw sqlFamilyError(
        'MIGRATION.INVALID_OPERATION_ENTRY',
        'Migration operation entry is malformed',
        {
          why: `${inMigration}Operation ${position}${named} is not in a format this release of Prisma reads: ${result.summary}.`,
          fix: "If the migration's migration.ts builds this operation, change it so the operation holds only the fields the format defines, and emit the migration again. If ops.json was edited by hand, restore it from version control. Otherwise Prisma wrote an operation it cannot read, which is a bug in Prisma: please report it with the operation.",
          meta: {
            index: position,
            ...(operationId === undefined ? {} : { operationId }),
            ...(migration === undefined ? {} : { migration }),
            ...(location?.space === undefined ? {} : { space: location.space }),
            reason: result.summary,
          },
        },
      );
    });
}
