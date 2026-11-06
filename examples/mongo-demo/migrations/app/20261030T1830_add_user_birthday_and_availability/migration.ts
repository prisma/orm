#!/usr/bin/env -S node
import { collMod, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as End } from '../../snapshots/4a982736e89b99615c530abbd19d92cf955a27063db9ec4dcf0bddcc2dcc6595/contract';
import endContract from '../../snapshots/4a982736e89b99615c530abbd19d92cf955a27063db9ec4dcf0bddcc2dcc6595/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/61c3f027c298b11d22e875ed76ab6460d2b4396afa94bdf58d85e26aded3416c/contract';
import startContract from '../../snapshots/61c3f027c298b11d22e875ed76ab6460d2b4396afa94bdf58d85e26aded3416c/contract.json' with {
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
