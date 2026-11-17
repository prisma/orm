/** The module each target package's `defineConfig` names in `migrations.module` inside this repository. */
export const workspaceMigrationModule = {
  postgres: '@internal/postgres/migration',
  sqlite: '@internal/sqlite/migration',
  mysql: '@internal/mysql/migration',
  mariadb: '@internal/mariadb/migration',
  mongo: '@internal/mongo/migration',
} as const;
