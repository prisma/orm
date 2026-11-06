import ormPostgresRuntime, {
  type PostgresBinding as PostgresConnection,
  type PostgresOptionsBase,
} from '@prisma/orm-postgres/runtime';
import type { OrmContractOf, PostgresContract } from './contract-types';

function buildClient<C extends PostgresContract>(
  contract: C,
  connection: PostgresConnection,
  options: PostgresOptionsBase,
) {
  return ormPostgresRuntime<OrmContractOf<C>>({
    ...options,
    contractJson: contract.__cmp.contractJson,
    binding: connection,
  });
}

export const clientOf = buildClient;
