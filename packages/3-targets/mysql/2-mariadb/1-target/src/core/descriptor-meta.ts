import mysqlTargetDescriptorMeta from '@internal/target-mysql/pack';
import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/runtime';

type MariadbOwnMeta = {
  readonly targetId: 'mariadb';
  readonly id: 'mariadb';
  readonly displayName: 'MariaDB';
};

const mariadbOwnMeta: MariadbOwnMeta = {
  targetId: 'mariadb',
  id: 'mariadb',
  displayName: 'MariaDB',
};

/**
 * MariaDB's target metadata: MySQL's, with MySQL's data types, codecs and PSL authoring under their `mysql/…` ids, which name MySQL's set of types rather than the server. Every session runs in UTC, as on MySQL.
 */
export const mariadbTargetDescriptorMeta: Omit<
  typeof mysqlTargetDescriptorMeta,
  keyof MariadbOwnMeta
> &
  MariadbOwnMeta = { ...mysqlTargetDescriptorMeta, ...mariadbOwnMeta };

/** MariaDB's runtime target metadata: MySQL's, under the MariaDB target id and display name. */
export const mariadbTargetDescriptorMetaRuntime: Omit<
  typeof mysqlTargetDescriptorMetaRuntime,
  keyof MariadbOwnMeta
> &
  MariadbOwnMeta = { ...mysqlTargetDescriptorMetaRuntime, ...mariadbOwnMeta };
