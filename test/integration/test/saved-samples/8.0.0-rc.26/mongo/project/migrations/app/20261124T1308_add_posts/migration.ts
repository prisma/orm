#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0d02e57cfb19bc2159e9838992c264133875f4d9565103d3838d91b20d95966d/contract';
import startContract from '../../snapshots/0d02e57cfb19bc2159e9838992c264133875f4d9565103d3838d91b20d95966d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ea6879cbcd8b40a55f8828cd02c5ce337f96a26e948d1d3f6444c4cf198cb33f/contract';
import endContract from '../../snapshots/ea6879cbcd8b40a55f8828cd02c5ce337f96a26e948d1d3f6444c4cf198cb33f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, createCollection, createIndex } from '@internal/mongo/migration';

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      createCollection('posts', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              authorId: { bsonType: 'objectId' },
              title: { bsonType: 'string' },
            },
            required: ['_id', 'authorId', 'title'],
          },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      createIndex('posts', [{ direction: 1, field: 'authorId' }], { name: 'authorId_1' }),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
