const sourcesGivenNoCapabilitiesKey = Symbol.for(
  'prisma.orm.sql.contractSourcesGivenNoCapabilities',
);

/** Kept on `globalThis`, as `validateContractOnce` keeps its record, so that two copies of this package in one process, such as the one that builds the source and the one a target's config reads it with, share it. Prisma 8.0 removes it. */
function sourcesGivenNoCapabilities(): WeakSet<object> {
  const existing: unknown = Reflect.get(globalThis, sourcesGivenNoCapabilitiesKey);
  if (existing instanceof WeakSet) return existing;
  const created = new WeakSet<object>();
  Object.defineProperty(globalThis, sourcesGivenNoCapabilitiesKey, { value: created });
  return created;
}

/** Records that `source` was built with no `capabilities` option, so that a target's config can give it a default. A stopgap for configs written before the required list existed: Prisma 8.0 removes it. */
export function recordSourceGivenNoCapabilities(source: object): void {
  sourcesGivenNoCapabilities().add(source);
}

/** Whether `source` was built by `prismaContract` or `prisma7Contract` with no `capabilities` option. A stopgap for configs written before the required list existed: Prisma 8.0 removes it. */
export function isSourceGivenNoCapabilities(source: object): boolean {
  return sourcesGivenNoCapabilities().has(source);
}
