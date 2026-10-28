#!/usr/bin/env -S node
import { collMod, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/62671fbf016c515d808ac613743fddbf3db80384c1997251eac9d6f5fc063590/contract';
import endContract from '../../snapshots/62671fbf016c515d808ac613743fddbf3db80384c1997251eac9d6f5fc063590/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/da1339e341177f79b37f765f08200844d7cb4d59d26fe27fe4d95b0112b0c2cd/contract';
import startContract from '../../snapshots/da1339e341177f79b37f765f08200844d7cb4d59d26fe27fe4d95b0112b0c2cd/contract.json' with {
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
