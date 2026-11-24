#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4e7d03e173fa39e3085a1001e4ea634a705a9df8f9cd64bfdffed0f540f7616d/contract';
import endContract from '../../snapshots/4e7d03e173fa39e3085a1001e4ea634a705a9df8f9cd64bfdffed0f540f7616d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ea6879cbcd8b40a55f8828cd02c5ce337f96a26e948d1d3f6444c4cf198cb33f/contract';
import startContract from '../../snapshots/ea6879cbcd8b40a55f8828cd02c5ce337f96a26e948d1d3f6444c4cf198cb33f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, collMod } from '@internal/mongo/migration';

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      collMod(
        'users',
        {
          validator: {
            $jsonSchema: {
              additionalProperties: false,
              bsonType: 'object',
              properties: {
                _id: { bsonType: 'objectId' },
                email: { bsonType: 'string' },
                name: { bsonType: ['null', 'string'] },
                role: { bsonType: 'string', enum: ['USER', 'ADMIN'] },
              },
              required: ['_id', 'email', 'role'],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.users.update',
          label: 'Update validator on users (added: name)',
          operationClass: 'widening',
          checkDocuments: true,
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
