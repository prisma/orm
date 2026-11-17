#!/usr/bin/env -S node
import { collMod, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/95332b0bd6fbbfab4462d882c037a574c92e51897249c333ba681b12c4d603c9/contract';
import endContract from '../../snapshots/95332b0bd6fbbfab4462d882c037a574c92e51897249c333ba681b12c4d603c9/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/396942f6c9ee5f946d7f67b397929bab327fe84dd8f7f80e87b8097f416fb901/contract';
import startContract from '../../snapshots/396942f6c9ee5f946d7f67b397929bab327fe84dd8f7f80e87b8097f416fb901/contract.json' with {
  type: 'json',
};

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
                address: {
                  oneOf: [
                    { bsonType: 'null' },
                    {
                      additionalProperties: false,
                      bsonType: 'object',
                      properties: {
                        city: { bsonType: 'string' },
                        country: { bsonType: 'string' },
                        street: { bsonType: 'string' },
                        zip: { bsonType: ['null', 'string'] },
                      },
                      required: ['city', 'country', 'street'],
                    },
                  ],
                },
                bio: { bsonType: ['null', 'string'] },
                email: { bsonType: 'string' },
                name: { bsonType: 'string' },
                role: { bsonType: 'string', enum: ['admin', 'author', 'reader'] },
              },
              required: ['_id', 'email', 'name', 'role'],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.users.update',
          label: 'Update validator on users',
          operationClass: 'destructive',
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
