#!/usr/bin/env -S node
import { collMod, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as Start } from '../../snapshots/406b672b68a6b01f04c0d6f910f5fefa4ac16d48b26e6c91b43856cd42c8cc5d/contract';
import startContract from '../../snapshots/406b672b68a6b01f04c0d6f910f5fefa4ac16d48b26e6c91b43856cd42c8cc5d/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/ac97950fd013936ab02a4f2621a388e6ebb16d7baf3d0c262d87c28fb299162a/contract';
import endContract from '../../snapshots/ac97950fd013936ab02a4f2621a388e6ebb16d7baf3d0c262d87c28fb299162a/contract.json' with {
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
                availableFrom: { bsonType: ['null', 'string'] },
                bio: { bsonType: ['null', 'string'] },
                birthday: { bsonType: ['null', 'date'] },
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
          label: 'Update validator on users (added: availableFrom, birthday)',
          operationClass: 'widening',
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
