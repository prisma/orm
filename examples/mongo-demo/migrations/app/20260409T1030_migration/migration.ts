import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/396942f6c9ee5f946d7f67b397929bab327fe84dd8f7f80e87b8097f416fb901/contract';
import endContract from '../../snapshots/396942f6c9ee5f946d7f67b397929bab327fe84dd8f7f80e87b8097f416fb901/contract.json' with {
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
