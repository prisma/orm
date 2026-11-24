#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0d02e57cfb19bc2159e9838992c264133875f4d9565103d3838d91b20d95966d/contract';
import endContract from '../../snapshots/0d02e57cfb19bc2159e9838992c264133875f4d9565103d3838d91b20d95966d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, createCollection, createIndex } from '@internal/mongo/migration';

class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      createCollection('users', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              email: { bsonType: 'string' },
              role: { bsonType: 'string', enum: ['USER', 'ADMIN'] },
            },
            required: ['_id', 'email', 'role'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createIndex('users', [{ direction: 1, field: 'email' }], { name: 'email_1', unique: true }),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
