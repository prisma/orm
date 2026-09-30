import { errorRuntime } from '@internal/errors/execution';
import type { ControlDriverDescriptor } from '@internal/framework-components/control';
import type { MongoControlDriverInstance } from '@internal/mongo-lowering';
import { redactDatabaseUrl } from '@internal/utils/redact-db-url';
import { type Db, MongoClient } from 'mongodb';
import { DRIVER_INFO } from '../core/driver-info';
import { MongoDriverImpl } from '../mongo-driver';

export class MongoControlDriver extends MongoDriverImpl implements MongoControlDriverInstance {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;
  override readonly db: Db;

  constructor(db: Db, mongoClient: MongoClient) {
    super(db, mongoClient);
    this.db = db;
  }

  async databaseName(): Promise<string> {
    return this.db.databaseName;
  }
}

const mongoControlDriverDescriptor: ControlDriverDescriptor<'mongo', 'mongo', MongoControlDriver> =
  {
    kind: 'driver',
    familyId: 'mongo',
    targetId: 'mongo',
    id: 'mongo',
    version: DRIVER_INFO.version,
    capabilities: {},
    async create(url: string): Promise<MongoControlDriver> {
      const client = new MongoClient(url, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        driverInfo: DRIVER_INFO,
      });
      try {
        await client.connect();
        const db = client.db();
        return new MongoControlDriver(db, client);
      } catch (error) {
        try {
          await client.close();
        } catch {
          // ignore cleanup error
        }
        const message = error instanceof Error ? error.message : String(error);
        const redacted = redactDatabaseUrl(url);
        throw errorRuntime('DRIVER.CONNECTION_FAILED', 'Database connection failed', {
          why: message,
          fix: 'Verify the MongoDB URL, ensure the database is reachable, and confirm credentials/permissions',
          meta: { ...redacted },
          cause: error,
        });
      }
    },
  };

export default mongoControlDriverDescriptor;
