import { contractError } from './contract-errors';

/** A definition's `types` key used to declare type aliases; it is refused so an old definition does not silently lose its aliases. */
export function refuseTypesKey(definition: object, subject: string): void {
  if (!Object.hasOwn(definition, 'types')) return;
  const types: unknown = Reflect.get(definition, 'types');
  throw contractError(
    'CONTRACT.TYPES_KEY_REMOVED',
    `${subject} no longer takes a "types" key. Write a type alias as a constant, such as const Slug = field.column(type.sql.String(64)), and use it as a field. Register a database type of a contract space under "databaseTypes".`,
    { meta: { keys: typeof types === 'object' && types !== null ? Object.keys(types) : [] } },
  );
}
