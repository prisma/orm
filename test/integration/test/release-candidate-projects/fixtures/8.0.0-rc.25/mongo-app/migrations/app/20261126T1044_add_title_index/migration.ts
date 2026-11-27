#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8/contract';
import startContract from '../../snapshots/5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5/contract';
import endContract from '../../snapshots/b036dd0e7c135036292da82f8cd40937d3e210159f4dc43b3a96b48fe50a72e5/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, collMod, createIndex } from '@prisma/orm-mongo/migration';

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      createIndex('posts', [{ direction: 1, field: 'title' }], { name: 'title_1' }),
      collMod(
        'users',
        {
          validator: {
            $jsonSchema: {
              additionalProperties: false,
              bsonType: 'object',
              properties: {
                _id: { bsonType: 'objectId' },
                bio: { bsonType: ['null', 'string'] },
                email: { bsonType: 'string' },
                name: { bsonType: 'string' },
              },
              required: ['_id', 'email', 'name'],
            },
          },
          validationLevel: 'strict',
          validationAction: 'error',
        },
        {
          id: 'validator.users.update',
          label: 'Update validator on users (added: bio)',
          operationClass: 'widening',
          checkDocuments: true,
        },
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
