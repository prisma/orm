#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8/contract';
import endContract from '../../snapshots/5be8fe387d72487fb21ac5a87a61984f3e4085b406b8decdab2499ef44522ce8/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  createCollection,
  createIndex,
} from '@prisma/orm-mongo/migration';

class M extends Migration<never, End> {
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
      createCollection('users', {
        validator: {
          $jsonSchema: {
            additionalProperties: false,
            bsonType: 'object',
            properties: {
              _id: { bsonType: 'objectId' },
              email: { bsonType: 'string' },
              name: { bsonType: 'string' },
            },
            required: ['_id', 'email', 'name'],
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
