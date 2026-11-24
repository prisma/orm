#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6d56833967a6e635f5673044c3764af572bf5e6b064005889b780b19e1212f4d/contract';
import endContract from '../../snapshots/6d56833967a6e635f5673044c3764af572bf5e6b064005889b780b19e1212f4d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ea6879cbcd8b40a55f8828cd02c5ce337f96a26e948d1d3f6444c4cf198cb33f/contract';
import startContract from '../../snapshots/ea6879cbcd8b40a55f8828cd02c5ce337f96a26e948d1d3f6444c4cf198cb33f/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  collMod,
  dataTransform,
  placeholder,
  rawAggregate,
  rawUpdateMany,
} from '@internal/mongo/migration';

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      dataTransform('User.name', {
  invariantId: 'backfill-user-name',
        check: {
          source: () =>
            rawAggregate('users', [
              { $match: { $expr: { $in: [{ $type: '$name' }, ['missing', 'null']] } } },
              { $limit: 1 },
            ]),
        },
        run: () =>
          rawUpdateMany(
            'users',
            { $expr: { $in: [{ $type: '$name' }, ['missing', 'null']] } },
            { $set: { name: 'unnamed' } },
            { bypassDocumentValidation: true },
          ),
      }),
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
                name: { bsonType: 'string' },
                role: { bsonType: 'string', enum: ['USER', 'ADMIN'] },
              },
              required: ['_id', 'email', 'name', 'role'],
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
