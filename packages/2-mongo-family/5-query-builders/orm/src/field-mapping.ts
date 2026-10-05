import type { MongoModelDefinition } from '@internal/mongo-contract';

export function storageFieldName(model: MongoModelDefinition | undefined, path: string): string {
  const [head, ...rest] = path.split('.');
  return head === undefined
    ? path
    : [model?.storage.fields?.[head]?.field ?? head, ...rest].join('.');
}

export function applicationFieldName(
  model: MongoModelDefinition | undefined,
  stored: string,
): string {
  return (
    Object.entries(model?.storage.fields ?? {}).find(
      ([, descriptor]) => descriptor.field === stored,
    )?.[0] ?? stored
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mapStorageRow(
  model: MongoModelDefinition | undefined,
  row: unknown,
  resolveModel?: (name: string) => MongoModelDefinition | undefined,
): unknown {
  if (!model || !isRecord(row)) return row;
  const discriminator = model.discriminator;
  const variantName =
    discriminator === undefined
      ? undefined
      : Object.entries(model.variants ?? {}).find(
          ([, variant]) => variant.value === row[storageFieldName(model, discriminator.field)],
        )?.[0];
  const variant = variantName === undefined ? undefined : resolveModel?.(variantName);
  const storage = {
    ...model.storage,
    fields: { ...model.storage.fields, ...variant?.storage.fields },
  };
  const mappingModel = { ...model, storage };
  const result: Record<string, unknown> = {};
  for (const [stored, value] of Object.entries(row)) {
    const field = applicationFieldName(mappingModel, stored);
    const relation = model.relations?.[field];
    const target = relation === undefined ? undefined : resolveModel?.(relation.to.model);
    result[field] =
      target === undefined
        ? value
        : Array.isArray(value)
          ? value.map((item) => mapStorageRow(target, item, resolveModel))
          : mapStorageRow(target, value, resolveModel);
  }
  return result;
}
