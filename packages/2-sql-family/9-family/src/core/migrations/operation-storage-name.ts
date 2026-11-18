import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';

interface StorageDetails {
  readonly objectType: string;
  readonly name: string;
  readonly schema?: string;
  readonly table?: string;
}

function isStorageDetails(details: unknown): details is StorageDetails {
  if (typeof details !== 'object' || details === null) return false;
  const [objectType, name, schema, table] = ['objectType', 'name', 'schema', 'table'].map(
    (key): unknown => Reflect.get(details, key),
  );
  return (
    typeof objectType === 'string' &&
    typeof name === 'string' &&
    (schema === undefined || typeof schema === 'string') &&
    (table === undefined || typeof table === 'string')
  );
}

function storageDetailsOf(operation: MigrationPlanOperation): StorageDetails | undefined {
  const target: unknown = Reflect.get(operation, 'target');
  if (typeof target !== 'object' || target === null) return undefined;
  const details: unknown = Reflect.get(target, 'details');
  return isStorageDetails(details) ? details : undefined;
}

/**
 * The name the database knows an operation's object by, read from the operation's target
 * details: `schema.table.column` for a column, `schema.name` for anything else, without the
 * schema in the unbound namespace. An operation without details is named by its id.
 */
export function storageNameOfOperation(operation: MigrationPlanOperation): string {
  const details = storageDetailsOf(operation);
  if (details === undefined) return operation.id;
  const schema =
    details.schema === undefined || details.schema === UNBOUND_NAMESPACE_ID ? [] : [details.schema];
  const table =
    details.objectType === 'column' && details.table !== undefined ? [details.table] : [];
  return [...schema, ...table, details.name].join('.');
}
