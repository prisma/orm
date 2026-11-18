import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/descriptor-meta-runtime';

export type MariadbOwnMeta = {
  readonly targetId: 'mariadb';
  readonly id: 'mariadb';
  readonly displayName: 'MariaDB';
};

export const mariadbOwnMeta: MariadbOwnMeta = {
  targetId: 'mariadb',
  id: 'mariadb',
  displayName: 'MariaDB',
};

/** MariaDB's runtime target metadata: MySQL's, under the MariaDB target id and display name, which every MariaDB package reads them from. Every session runs in UTC, as on MySQL. */
export const mariadbTargetDescriptorMetaRuntime: Omit<
  typeof mysqlTargetDescriptorMetaRuntime,
  keyof MariadbOwnMeta
> &
  MariadbOwnMeta = { ...mysqlTargetDescriptorMetaRuntime, ...mariadbOwnMeta };
