import mysqlTargetDescriptorMeta from '@internal/target-mysql/pack';

type MariadbOwnMeta = {
  readonly targetId: 'mariadb';
  readonly id: 'mariadb';
  readonly displayName: 'MariaDB';
  readonly sessionSettings: { readonly time_zone: string; readonly tx_isolation: 'READ-COMMITTED' };
};

/**
 * MariaDB's target metadata: MySQL's, with MySQL's data types, codecs and PSL authoring under their `mysql/…` ids, which name MySQL's set of types rather than the server. Every session runs in UTC and at READ COMMITTED, as on MySQL, through `tx_isolation`, since MariaDB 10.11 has no `transaction_isolation`.
 */
export const mariadbTargetDescriptorMeta: Omit<
  typeof mysqlTargetDescriptorMeta,
  keyof MariadbOwnMeta
> &
  MariadbOwnMeta = {
  ...mysqlTargetDescriptorMeta,
  targetId: 'mariadb',
  id: 'mariadb',
  displayName: 'MariaDB',
  sessionSettings: {
    time_zone: mysqlTargetDescriptorMeta.sessionSettings.time_zone,
    tx_isolation: 'READ-COMMITTED',
  },
};
