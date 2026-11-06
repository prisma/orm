import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';

/** A document rewrite the planner plans: `renameField` or `unsetField`. */
export interface FieldRewrite {
  readonly collection: string;
  /** The field the rewrite renames or removes, by its old name. */
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

/**
 * The planner's field rewrite an operation is, if it is one: a single `updateMany` that skips
 * validation and renames or unsets one field.
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
  const operator = onlyKey(command.update);
  if (operator === undefined || !FIELD_OPERATORS.has(operator)) return undefined;
  const field = onlyKey(Reflect.get(command.update, operator));
  return field === undefined ? undefined : { collection: command.collection, field, command };
}
