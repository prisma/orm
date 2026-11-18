export const workspaceTypesModule = {
  postgres: '@internal/postgres/contract-types',
  sqlite: '@internal/sqlite/contract-types',
  mysql: '@internal/mysql/contract-types',
  mariadb: '@internal/mariadb/contract-types',
  mongo: '@internal/mongo/contract-types',
} as const;

export function workspaceTypesModuleFor(targetId: string): string {
  const module = new Map<string, string>(Object.entries(workspaceTypesModule)).get(targetId);
  if (module === undefined) {
    throw new Error(`No workspace target package names a contract types module for "${targetId}"`);
  }
  return module;
}
