#!/usr/bin/env -S node
import { collMod, Migration, MigrationCLI } from '@prisma/orm-mongo/target/migration';
import type { Contract as Start } from '../../snapshots/3055d5ffb87a65023bf2809ae55770f7be848d798989bff1a9613474898dcd95/contract';
import startContract from '../../snapshots/3055d5ffb87a65023bf2809ae55770f7be848d798989bff1a9613474898dcd95/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/b6f6bd5351ad4383f8a46c585bf7f7f65483aaf898f124a130dadc46a9b373a4/contract';
import endContract from '../../snapshots/b6f6bd5351ad4383f8a46c585bf7f7f65483aaf898f124a130dadc46a9b373a4/contract.json' with {
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
