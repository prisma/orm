import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/3055d5ffb87a65023bf2809ae55770f7be848d798989bff1a9613474898dcd95/contract';
import endContract from '../../snapshots/3055d5ffb87a65023bf2809ae55770f7be848d798989bff1a9613474898dcd95/contract.json' with {
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
