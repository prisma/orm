export const workspaceMigrationModule = {
  postgres: '@internal/postgres/migration',
  sqlite: '@internal/sqlite/migration',
  mysql: '@internal/mysql/migration',
  mariadb: '@internal/mariadb/migration',
  mongo: '@internal/mongo/migration',
} as const;
