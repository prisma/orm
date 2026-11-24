import { createIndex, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/6cef3fb9324db4f3f7163ccd61960055229d8de1f456870181fd7c897a5c2f96/contract';
import endContract from '../../snapshots/6cef3fb9324db4f3f7163ccd61960055229d8de1f456870181fd7c897a5c2f96/contract.json' with {
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
