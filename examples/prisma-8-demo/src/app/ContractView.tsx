import type { StorageTable } from '@prisma/orm-postgres/family-contract/types';
import type { Contract } from '../prisma/contract.d';

// Models resolve per-namespace from the domain plane (no flat top-level Models export).
type Models = Contract['domain']['namespaces']['public']['models'];
type ContractModel = Models[keyof Models];

function ModelCard({ modelName, model }: { modelName: string; model: ContractModel }) {
  const tableName = model.storage.table;
  const fieldToColumn = Object.fromEntries(
    Object.entries(model.storage.fields).map(([fieldName, mapping]) => [fieldName, mapping.column]),
  );
  const relationEntries = Object.entries(model.relations ?? {});

  return (
    <div className="table-card">
      <div className="table-name">
        <span>
          {'\u{1F9E9}'} {modelName}
        </span>
        <span className="pk-badge">table: {tableName}</span>
      </div>
      <div className="columns">
        {Object.keys(model.fields).map((fieldName) => (
          <div key={fieldName} className="column">
            <span className="col-name">{fieldName}</span>
            <span className="col-type">
              {'\u2192'} {fieldToColumn[fieldName] ?? ''}
            </span>
          </div>
        ))}
        {relationEntries.length > 0 && (
          <div className="columns">
            {relationEntries.map(([relationName, relation]) => (
              <div key={relationName} className="column">
                <span className="col-name">
                  {relation.cardinality === '1:N' ? '\u21C9' : '\u2192'} {relationName}
                </span>
                <span className="col-type">
                  {relation.cardinality} {'\u2192'} {relation.to}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TableCard({ tableName, table }: { tableName: string; table: StorageTable }) {
  const primaryKey = table.primaryKey?.columns ?? [];

  return (
    <div className="table-card">
      <div className="table-name">
        <span>
          {'\u{1F4E6}'} {tableName}
        </span>
        <span className="pk-badge">PK: {primaryKey.join(', ')}</span>
      </div>
      <div className="columns">
        {Object.entries(table.columns).map(([columnName, column]) => (
          <div key={columnName} className="column">
            <span className="col-name">
              {primaryKey.includes(columnName) ? '\u{1F511} ' : ''}
              {columnName}
            </span>
            <span className="col-type">{column.dataType}</span>
            {column.nullable && <span className="col-nullable">nullable</span>}
          </div>
        ))}
        {(table.foreignKeys ?? []).map((foreignKey) => (
          <div
            key={`${foreignKey.source.namespaceId}.${foreignKey.source.tableName}:${foreignKey.source.columns.join(',')}->${foreignKey.target.namespaceId}.${foreignKey.target.tableName}:${foreignKey.target.columns.join(',')}`}
            className="column"
          >
            <span className="col-name">
              {'\u2192'} {foreignKey.source.columns.join(', ')}
            </span>
            <span className="col-type">
              {'\u2192'} {foreignKey.target.namespaceId}.{foreignKey.target.tableName}(
              {foreignKey.target.columns.join(', ')})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function BadgeList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return (
      <div className="capabilities">
        <span className="col-type">None</span>
      </div>
    );
  }
  return (
    <div className="capabilities">
      {items.map((item) => (
        <span key={item} className="cap-badge">
          {item}
        </span>
      ))}
    </div>
  );
}

export function ContractView({ contract }: { contract: Contract }) {
  const capabilityFlags = Object.entries(contract.capabilities).flatMap(([namespace, flags]) =>
    Object.entries(flags)
      .filter(([, enabled]) => enabled)
      .map(([key]) => `${namespace}/${key}`),
  );
  const extensionNames = Object.keys(contract.extensions);

  return (
    <>
      <div className="hash">
        <span className="hash-label">Storage Hash: </span>
        <span className="hash-value">{contract.storage.storageHash}</span>
      </div>

      <Section title={`Target: ${contract.target}`}>{null}</Section>

      <Section title="Models">
        {Object.entries(contract.domain.namespaces).flatMap(([namespaceId, ns]) =>
          Object.entries(ns.models).map(([modelName, model]) => (
            <ModelCard key={`${namespaceId}.${modelName}`} modelName={modelName} model={model} />
          )),
        )}
      </Section>

      <Section title="Tables">
        {Object.values(contract.storage.namespaces).flatMap((ns) =>
          Object.entries(ns.entries.table).map(([tableName, table]) => (
            <TableCard key={`${ns.id}.${tableName}`} tableName={tableName} table={table} />
          )),
        )}
      </Section>

      <Section title="Capabilities">
        <BadgeList items={capabilityFlags} />
      </Section>

      <Section title="Extensions">
        <BadgeList items={extensionNames} />
      </Section>
    </>
  );
}
