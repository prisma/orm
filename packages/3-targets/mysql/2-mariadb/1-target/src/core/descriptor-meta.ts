import mysqlTargetDescriptorMeta from '@internal/target-mysql/pack';
import { type MariadbOwnMeta, mariadbOwnMeta } from './descriptor-meta-runtime';

/**
 * MariaDB's target metadata: MySQL's, with MySQL's data types, codecs and PSL authoring under their `mysql/…` ids, which name MySQL's set of types rather than the server. It adds MySQL's authoring to MariaDB's runtime metadata, as MySQL's does to its own.
 */
export const mariadbTargetDescriptorMeta: Omit<
  typeof mysqlTargetDescriptorMeta,
  keyof MariadbOwnMeta
> &
  MariadbOwnMeta = { ...mysqlTargetDescriptorMeta, ...mariadbOwnMeta };
