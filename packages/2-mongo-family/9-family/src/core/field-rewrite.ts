import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';

/** A document rewrite the planner plans: `renameField`, `unsetField` or `castField`. */
export interface FieldRewrite {
  readonly collection: string;
  /** The field the rewrite renames, removes or casts, by its old name. */
  readonly field: string;
  readonly command: RawUpdateManyCommand;
}

const FIELD_OPERATORS: ReadonlySet<string> = new Set(['$rename', '$unset']);

function onlyKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  const [key] = keys;
  return keys.length === 1 ? key : undefined;
}

/** The field an update sets or changes: one `$rename` or `$unset` of one field, or a pipeline of one `$set` of one field. */
function rewrittenField(update: RawUpdateManyCommand['update']): string | undefined {
  if (Array.isArray(update)) {
    const [stage, ...others] = update;
    return others.length === 0 && onlyKey(stage) === '$set'
      ? onlyKey(Reflect.get(stage ?? {}, '$set'))
      : undefined;
  }
  const operator = onlyKey(update);
  if (operator === undefined || !FIELD_OPERATORS.has(operator)) return undefined;
  return onlyKey(Reflect.get(update, operator));
}

/**
 * The field rewrite an operation's run has the shape of, if it has one: a single `updateMany` that
 * skips validation and renames, unsets or sets one field. A data transform the user filled can have
 * this shape too, so a caller tells the two apart by the operation's class.
 */
export function fieldRewriteOf(operation: MigrationPlanOperation): FieldRewrite | undefined {
  const run: unknown = Reflect.get(operation, 'run');
  if (!Array.isArray(run) || run.length !== 1) return undefined;
  const [step]: readonly unknown[] = run;
  const command: unknown =
    typeof step === 'object' && step !== null ? Reflect.get(step, 'command') : undefined;
  if (!(command instanceof RawUpdateManyCommand) || command.bypassDocumentValidation !== true) {
    return undefined;
  }
  const field = rewrittenField(command.update);
  return field === undefined ? undefined : { collection: command.collection, field, command };
}
