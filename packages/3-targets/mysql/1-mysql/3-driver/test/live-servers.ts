import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/descriptor-meta-runtime';
import type { MysqlServerVariable } from '@repo/test-utils/mysql-database';
import { createMysqlControlDriverDescriptor } from '../src/core/migrations/control-driver';
import { MYSQL_CHECK_VIOLATION_ERRORS } from '../src/core/normalize-error';
import type {
  MysqlDriverCreateOptions,
  MysqlRuntimeDriver,
} from '../src/core/runtime/mysql-driver';
import { createMysqlRuntimeDriverDescriptor } from '../src/core/runtime/runtime-driver';

/** A server the driver's live tests run against, with the drivers MySQL's driver package builds for its target. */
export interface DriverServer {
  readonly displayName: string;
  readonly urlVariable: MysqlServerVariable;
  readonly runtime: RuntimeDriverDescriptor<
    'sql',
    string,
    MysqlDriverCreateOptions,
    MysqlRuntimeDriver<string>
  >;
  readonly control: ControlDriverDescriptor<'sql', string, SqlControlDriverInstance<string>>;
  /** The text the server prints for negative zero in a FLOAT, a DOUBLE or a computed column: MySQL keeps the sign, MariaDB drops it. */
  readonly negativeZero: '-0' | '0';
  /** Whether the server has the `caching_sha2_password` authentication plugin, the one whose sign-in needs the server's public key over plain TCP. MariaDB 10.11 does not. */
  readonly cachingSha2Password: boolean;
  /** Whether the server the tests run against accepts TLS: the MySQL 8.4 image generates certificates, the MariaDB 10.11 image starts without TLS. */
  readonly tls: boolean;
  /** The error numbers the server reports a failed CHECK constraint with, which the target's driver package gives the factories. */
  readonly checkViolationErrors: readonly number[];
}

function serverFor(
  target: { readonly targetId: string; readonly displayName: string },
  server: Pick<
    DriverServer,
    'urlVariable' | 'negativeZero' | 'cachingSha2Password' | 'tls' | 'checkViolationErrors'
  >,
): DriverServer {
  const { checkViolationErrors } = server;
  return {
    displayName: target.displayName,
    runtime: createMysqlRuntimeDriverDescriptor({ target, checkViolationErrors }),
    control: createMysqlControlDriverDescriptor({ target, checkViolationErrors }),
    ...server,
  };
}

/** MySQL 8.4, and MariaDB 10.11, which the MariaDB target runs MySQL's drivers against under its own target id and name. */
export const driverServers: readonly DriverServer[] = [
  serverFor(mysqlTargetDescriptorMetaRuntime, {
    urlVariable: 'MYSQL_URL',
    negativeZero: '-0',
    cachingSha2Password: true,
    tls: true,
    checkViolationErrors: MYSQL_CHECK_VIOLATION_ERRORS,
  }),
  serverFor(
    { targetId: 'mariadb', displayName: 'MariaDB' },
    {
      urlVariable: 'MARIADB_URL',
      negativeZero: '0',
      cachingSha2Password: false,
      tls: false,
      checkViolationErrors: [4025],
    },
  ),
];
