/** The module each target package's `defineConfig` names in `contract.typesModule` inside this repository. */
export const workspaceTypesModule = {
  postgres: '@internal/postgres/generated-types',
  sqlite: '@internal/sqlite/generated-types',
  mysql: '@internal/mysql/generated-types',
  mariadb: '@internal/mariadb/generated-types',
  mongo: '@internal/mongo/generated-types',
} as const;

/** The workspace types module of the target `targetId`. */
export function workspaceTypesModuleFor(targetId: string): string {
  const module = new Map<string, string>(Object.entries(workspaceTypesModule)).get(targetId);
  if (module === undefined) {
    throw new Error(`No workspace target package names a contract types module for "${targetId}"`);
  }
  return module;
}
