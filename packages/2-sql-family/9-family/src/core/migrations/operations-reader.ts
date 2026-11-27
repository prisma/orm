import { blindCast } from '@internal/utils/casts';
import { type Type, type } from 'arktype';
import { sqlFamilyError } from '../errors';
import { RequiredColumnJson } from './required-column';
import { RowsHoldingValueJson } from './rows-holding-value';
import type { SqlMigrationPlanOperation } from './types';
import { ConvertedColumnJson } from './unconverted-field';

/** What a target tells the SQL operations reader about the parts of an operation it alone defines. */
export interface SqlOperationsFormat {
  /** The strict schema of an operation's `target.details`. */
  readonly targetDetails: Type<unknown>;
  /** The entries of a step's `meta` the target alone writes and reads, each strict; other entries stay open. */
  readonly stepMeta?: Type<unknown>;
}

/** Which migrations the operations being read belong to, in order, so a refusal can name one. */
export interface SqlOperationsSource {
  readonly space?: string;
  readonly migrations?: readonly { readonly dirName: string; readonly operationCount: number }[];
}

/**
 * Reads the operations of an `ops.json`, refusing any key the format does not define in an
 * operation, its target, a step, a check's expectation, or a step mark a reader acts on. The places
 * Prisma does not interpret stay open: a step's `params`, an operation's `meta`, the entries of a
 * step's `meta` no reader acts on, and a codec's `typeParams` inside a mark.
 */
export type SqlOperationsReader<TTargetDetails> = (
  operations: readonly unknown[],
  source?: SqlOperationsSource,
) => readonly SqlMigrationPlanOperation<TTargetDetails>[];

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

function operationSchema(format: SqlOperationsFormat): Type<unknown> {
  const stepMeta =
    format.stepMeta === undefined ? SharedStepMeta : SharedStepMeta.and(format.stepMeta);
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
    target: { '+': 'reject', id: 'string', 'details?': format.targetDetails },
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

function placeOf(
  index: number,
  source: SqlOperationsSource | undefined,
): { readonly position: number; readonly migration: string | undefined } {
  let start = 0;
  for (const migration of source?.migrations ?? []) {
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
  format: SqlOperationsFormat,
): SqlOperationsReader<TTargetDetails> {
  const schema = operationSchema(format);
  return (operations, source) => {
    operations.forEach((operation, index) => {
      const result = schema(withoutUndefinedKeys(operation));
      if (!(result instanceof type.errors)) return;
      const { position, migration } = placeOf(index, source);
      const operationId = operationIdOf(operation);
      const named = operationId === undefined ? '' : ` ("${operationId}")`;
      const inMigration =
        migration === undefined
          ? ''
          : ` of migration "${migration}"${source?.space === undefined ? '' : ` in space "${source.space}"`}`;
      throw sqlFamilyError(
        'MIGRATION.INVALID_OPERATION_ENTRY',
        'Migration operation entry is malformed',
        {
          why: `Operation ${position}${named}${inMigration} is not in a format this release of Prisma reads: ${result.summary}.`,
          fix: "If a newer release of Prisma wrote this migration, upgrade Prisma to that release or a later one. Otherwise restore the migration's ops.json from version control.",
          meta: {
            index: position,
            ...(operationId === undefined ? {} : { operationId }),
            ...(migration === undefined ? {} : { migration }),
            ...(source?.space === undefined ? {} : { space: source.space }),
            reason: result.summary,
          },
        },
      );
    });
    return blindCast<
      readonly SqlMigrationPlanOperation<TTargetDetails>[],
      'each operation was checked against the format the SQL family and the target define'
    >(operations);
  };
}
