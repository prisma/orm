#!/usr/bin/env -S node
import { collMod, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/fe0a449a1b2761d21173fa268ddb1d8419ff9bce3c903d42fdb899dd649addaf/contract';
import endContract from '../../snapshots/fe0a449a1b2761d21173fa268ddb1d8419ff9bce3c903d42fdb899dd649addaf/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/ff02f1a41650a33b8fb6ecd135e3469dc868d189918615470bcbc4939dcca1c3/contract';
import startContract from '../../snapshots/ff02f1a41650a33b8fb6ecd135e3469dc868d189918615470bcbc4939dcca1c3/contract.json' with {
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
