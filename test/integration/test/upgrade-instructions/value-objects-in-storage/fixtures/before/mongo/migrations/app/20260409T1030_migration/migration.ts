import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/da1339e341177f79b37f765f08200844d7cb4d59d26fe27fe4d95b0112b0c2cd/contract';
import endContract from '../../snapshots/da1339e341177f79b37f765f08200844d7cb4d59d26fe27fe4d95b0112b0c2cd/contract.json' with {
  type: 'json',
};

class InitialMigration extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [createIndex('users', [{ field: 'email', direction: 1 }], { unique: true })];
  }
}

export default InitialMigration;
MigrationCLI.run(import.meta.url, InitialMigration);
