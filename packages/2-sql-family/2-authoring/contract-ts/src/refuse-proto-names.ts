import type { ContractDefinition, ForeignKeyNode } from './contract-definition';
import { contractError } from './contract-errors';

/**
 * `__proto__` cannot be stored as a key of a plain object: assigning it sets
 * the object's prototype and stores nothing, so a builder grouping by that
 * name writes onto `Object.prototype` and the contract comes out wrong.
 * Refuse it wherever a name becomes a key in the SQL builder — namespace,
 * table, column, model, field, enum, value object, database type and attached
 * entity — before the build groups anything by name.
 */
export function refuseProtoNames(definition: ContractDefinition): void {
  const refuse = (kind: string, name: string | undefined, subject: string): void => {
    if (name !== '__proto__') return;
    throw contractError(
      'CONTRACT.NAME_PROTO',
      `${subject}: ${kind} "__proto__" cannot be stored as a key — JavaScript reads "__proto__" as the prototype of an object rather than as a key. Rename the ${kind}.`,
      { meta: { kind, name, subject } },
    );
  };

  const refuseForeignKey = (fk: ForeignKeyNode, subject: string): void => {
    refuse('table', fk.references.table, subject);
    if ('model' in fk.references) refuse('model', fk.references.model, subject);
    refuse('namespace', fk.references.namespaceId, subject);
  };

  refuse('namespace', definition.target.defaultNamespaceId, 'target');
  for (const namespaceId of definition.namespaces ?? []) {
    refuse('namespace', namespaceId, `namespace "${namespaceId}"`);
  }
  for (const databaseType of Object.keys(definition.databaseTypes ?? {})) {
    refuse('database type', databaseType, `database type "${databaseType}"`);
  }
  for (const [enumName, handle] of Object.entries(definition.enums ?? {})) {
    refuse('enum', enumName, `enum "${enumName}"`);
    refuse('enum', handle.enumName, `enum "${handle.enumName}"`);
  }
  for (const valueObject of definition.valueObjects ?? []) {
    const subject = `value object "${valueObject.name}"`;
    refuse('value object', valueObject.name, subject);
    for (const member of valueObject.fields) {
      refuse('field', member.fieldName, subject);
    }
  }
  for (const model of definition.models) {
    const subject = `model "${model.modelName}"`;
    refuse('model', model.modelName, subject);
    refuse('table', model.tableName, subject);
    refuse('namespace', model.namespaceId, subject);
    for (const field of model.fields) {
      refuse('field', field.fieldName, subject);
      refuse('column', field.columnName, subject);
    }
    for (const relation of model.relations ?? []) {
      refuse('field', relation.fieldName, subject);
      refuse('model', relation.toModel, subject);
      refuse('table', relation.toTable, subject);
      refuse('namespace', relation.toNamespaceId, subject);
      refuse('namespace', relation.namespaceId, subject);
      refuse('table', relation.on.parentTable, subject);
      refuse('table', relation.on.childTable, subject);
      if (relation.through !== undefined) {
        refuse('table', relation.through.table, subject);
        refuse('namespace', relation.through.namespaceId, subject);
      }
    }
    if (model.discriminator !== undefined) {
      refuse('field', model.discriminator.field, subject);
    }
    for (const fk of model.foreignKeys ?? []) {
      refuseForeignKey(fk, subject);
    }
  }
  for (const table of definition.tables ?? []) {
    const subject = `table "${table.tableName}"`;
    refuse('table', table.tableName, subject);
    refuse('namespace', table.namespaceId, subject);
    for (const column of table.columns) {
      refuse('column', column.columnName, subject);
    }
    for (const fk of table.foreignKeys ?? []) {
      refuseForeignKey(fk, subject);
    }
  }
  for (const [namespaceId, byKind] of Object.entries(definition.attachedEntities ?? {})) {
    refuse('namespace', namespaceId, `namespace "${namespaceId}"`);
    for (const [kind, byName] of Object.entries(byKind)) {
      for (const name of Object.keys(byName)) {
        refuse('entity', name, `${kind} "${name}" in namespace "${namespaceId}"`);
      }
    }
  }
}
