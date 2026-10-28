import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { computeStorageHash } from '@internal/contract/hashing';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFixture,
  editJson,
  fixturesDir,
  fixtureTree,
  readTree,
  removeWorkDirs,
  runScript,
} from './test-helpers';

afterAll(removeWorkDirs);

const SQL_BEFORE = '58888a20cba5529ede90056ecd1318183f0e5cf280c88cd58aeadd94bbf52c1b';
const SQL_AFTER = '1cb334a7b32d249d4fea0934dbbaa48c473b5946cd77ee1ce7442272479d6cf3';
const SQL_SNAPSHOT = `sql/migrations/snapshots/${SQL_BEFORE}/contract.json`;

interface StoredContract {
  readonly targetFamily: string;
  readonly target: string;
  readonly storage: Record<string, unknown> & { readonly storageHash: string };
}

function readContract(path: string): StoredContract {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function recomputedHash(contract: StoredContract): string {
  const { storageHash: _stored, ...storage } = contract.storage;
  return computeStorageHash({
    target: contract.target,
    targetFamily: contract.targetFamily,
    storage,
    ...(contract.targetFamily === 'mongo'
      ? mongoContractCanonicalizationHooks
      : sqlContractCanonicalizationHooks),
  });
}

describe('a project whose contracts keep value objects in the domain plane', () => {
  const root = copyFixture('before');
  const run = runScript(root);

  it('moves the value objects into storage and renames each snapshot to its new storage hash', () => {
    expect({ run, tree: readTree(root) }).toEqual({
      run: {
        status: 0,
        stdout: [
          'Rewrote 10 files and renamed 4 snapshot directories. Storage hashes changed (old -> new):',
          `  ${SQL_BEFORE} -> ${SQL_AFTER}`,
          '  62671fbf016c515d808ac613743fddbf3db80384c1997251eac9d6f5fc063590 -> 95332b0bd6fbbfab4462d882c037a574c92e51897249c333ba681b12c4d603c9',
          '  d264cabd6a02546054a776ed3c04438b9a22989f406c49f5590f7f2101156eb0 -> 406b672b68a6b01f04c0d6f910f5fefa4ac16d48b26e6c91b43856cd42c8cc5d',
          '  da1339e341177f79b37f765f08200844d7cb4d59d26fe27fe4d95b0112b0c2cd -> 396942f6c9ee5f946d7f67b397929bab327fe84dd8f7f80e87b8097f416fb901',
          '',
        ].join('\n'),
        stderr: '',
      },
      tree: fixtureTree('after'),
    });
  });

  it('changes nothing on a second run', () => {
    expect(runScript(root)).toEqual({
      status: 0,
      stdout: 'No contract keeps value objects in the domain plane; nothing changed.\n',
      stderr: '',
    });
  });
});

describe('an old MongoDB contract whose value object members leave nullable out or say dict false', () => {
  it('is written with nullable false and without dict, as this release reads it', () => {
    const path = 'mongo/src/contract.json';
    const root = copyFixture('before');
    editJson(root, path, (json) => {
      const contract = json as {
        domain: {
          namespaces: {
            __unbound__: {
              valueObjects: {
                Address: { fields: Record<string, { nullable?: boolean; dict?: boolean }> };
              };
            };
          };
        };
      };
      const fields = contract.domain.namespaces.__unbound__.valueObjects.Address.fields;
      if (fields['city'] !== undefined) delete fields['city'].nullable;
      if (fields['street'] !== undefined) fields['street'].dict = false;
      return contract;
    });
    runScript(root);
    expect(readContract(join(root, path))).toEqual(readContract(join(fixturesDir, 'after', path)));
  });

  it('keeps a nullable that is not a boolean, so validation refuses it', () => {
    const path = 'mongo/src/contract.json';
    const root = copyFixture('before');
    editJson(root, path, (json) => {
      const contract = json as {
        domain: {
          namespaces: {
            __unbound__: {
              valueObjects: { Address: { fields: Record<string, { nullable?: unknown }> } };
            };
          };
        };
      };
      const city = contract.domain.namespaces.__unbound__.valueObjects.Address.fields['city'];
      if (city !== undefined) city.nullable = 'yes';
      return contract;
    });
    runScript(root);
    const rewritten = JSON.parse(readFileSync(join(root, path), 'utf8')) as {
      storage: {
        namespaces: Record<
          string,
          { entries: { valueObject: { Address: { fields: { city: unknown } } } } }
        >;
      };
    };
    const city = Object.values(rewritten.storage.namespaces)
      .map((namespace) => namespace.entries.valueObject?.Address?.fields.city)
      .find((member) => member !== undefined);
    expect(city).toMatchObject({ nullable: 'yes' });
  });
});

describe('a contract.d.ts whose contract the script leaves unchanged', () => {
  it('gains the storage namespaces argument of FieldTypesFromDomain, which is now required', () => {
    const root = copyFixture('after');
    const path = join(
      root,
      'mongo/migrations/snapshots/95332b0bd6fbbfab4462d882c037a574c92e51897249c333ba681b12c4d603c9/contract.d.ts',
    );
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replaceAll(",\n  ContractBase['storage']['namespaces']\n>", '\n>'),
    );
    expect({ run: runScript(root), tree: readTree(root) }).toEqual({
      run: {
        status: 0,
        stdout: 'Rewrote 1 file and renamed 0 snapshot directories.\n',
        stderr: '',
      },
      tree: fixtureTree('after'),
    });
  });
});

describe('the rewritten contracts', () => {
  const after = fixtureTree('after');
  const contracts = Object.keys(after)
    .filter((path) => path.endsWith('contract.json'))
    .map((path) => ({ path, contract: readContract(join(fixturesDir, 'after', path)) }));

  it('store the hash their storage recomputes to, and each snapshot sits under it', () => {
    expect(
      contracts.map(({ path, contract }) => ({
        path,
        stored: contract.storage.storageHash,
        recomputed: recomputedHash(contract),
        directory: path.includes('/snapshots/') ? path.split('/').at(-2) : undefined,
      })),
    ).toEqual(
      contracts.map(({ path, contract }) => ({
        path,
        stored: contract.storage.storageHash,
        recomputed: contract.storage.storageHash,
        directory: path.includes('/snapshots/') ? contract.storage.storageHash : undefined,
      })),
    );
  });

  it('are read by this release', () => {
    const read = contracts.map(({ path, contract }) => {
      const json: unknown = contract;
      const deserialized =
        contract.targetFamily === 'mongo'
          ? new MongoContractSerializer().deserializeContract(json)
          : new PostgresContractSerializer().deserializeContract(json);
      return { path, storageHash: deserialized.storage.storageHash };
    });
    expect(read).toEqual(
      contracts.map(({ path, contract }) => ({ path, storageHash: contract.storage.storageHash })),
    );
  });

  it('give the SQL discriminator a value set and point its column at it', () => {
    const sql = readContract(
      join(fixturesDir, 'after', `sql/migrations/snapshots/${SQL_AFTER}/contract.json`),
    );
    expect(sql.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            valueSet: { 'Task.type': { kind: 'valueSet', values: ['bug', 'feature'] } },
            table: {
              task: {
                columns: {
                  type: {
                    valueSet: {
                      plane: 'storage',
                      namespaceId: 'public',
                      entityKind: 'valueSet',
                      entityName: 'Task.type',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});

describe('a project the script refuses to rewrite', () => {
  function refused(edit: (root: string) => void) {
    const root = copyFixture('before');
    edit(root);
    const before = readTree(root);
    const run = runScript(root);
    return { run, unchanged: JSON.stringify(readTree(root)) === JSON.stringify(before) };
  }

  it('stops on a snapshot whose stored hash does not match its content', () => {
    const result = refused((root) =>
      editJson(root, SQL_SNAPSHOT, (json) => {
        const contract = json as {
          storage: {
            namespaces: {
              public: {
                entries: {
                  table: Record<string, { columns: Record<string, { nullable: boolean }> }>;
                };
              };
            };
          };
        };
        const column = contract.storage.namespaces.public.entries.table['task']?.columns['title'];
        if (column !== undefined) column.nullable = true;
        return contract;
      }),
    );
    expect(result).toMatchObject({
      run: {
        status: 1,
        stdout: '',
        stderr: expect.stringContaining(
          `${SQL_SNAPSHOT}: the stored storage hash ${SQL_BEFORE} does not match the contract's content`,
        ),
      },
      unchanged: true,
    });
  });

  it('stops on a field that holds a value object the contract does not declare', () => {
    const result = refused((root) =>
      editJson(root, SQL_SNAPSHOT, (json) => {
        const contract = json as {
          domain: {
            namespaces: {
              public: {
                models: Record<string, { fields: Record<string, { type: { name?: string } }> }>;
              };
            };
          };
        };
        const field = contract.domain.namespaces.public.models['User']?.fields['address'];
        if (field !== undefined) field.type.name = 'Missing';
        return contract;
      }),
    );
    expect(result).toEqual({
      run: {
        status: 1,
        stdout: '',
        stderr: `${SQL_SNAPSHOT}: field User.address holds the value object Missing, which the contract does not declare; restore the file from version control, or re-emit it, and run the script again\n`,
      },
      unchanged: true,
    });
  });

  it('stops on a discriminator whose value set name an enum already has', () => {
    const result = refused((root) =>
      editJson(
        root,
        SQL_SNAPSHOT,
        (json) => {
          const contract = json as StoredContract & {
            storage: { namespaces: { public: { entries: { valueSet: Record<string, unknown> } } } };
          };
          contract.storage.namespaces.public.entries.valueSet['Task.type'] = {
            kind: 'valueSet',
            values: ['bug', 'feature'],
          };
          const hash = recomputedHash(contract);
          return { ...contract, storage: { ...contract.storage, storageHash: hash } };
        },
        'sql/src/contract.json',
      ),
    );
    expect(result.run).toMatchObject({
      status: 1,
      stderr: expect.stringContaining(
        'sql/src/contract.json: the discriminator Task.type writes the value set Task.type in storage namespace public, which already holds a value set of that name; rename the enum',
      ),
    });
  });

  it('stops with one line on a directory it cannot read', () => {
    const root = copyFixture('before');
    const locked = join(root, 'sql', 'migrations', 'app');
    chmodSync(locked, 0o000);
    try {
      expect(runScript(root)).toEqual({
        status: 1,
        stdout: '',
        stderr:
          'sql/migrations/app: cannot read the directory (EACCES); give the script read access to it, or move it out of the project, and run the script again\n',
      });
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it('says when it finds no contract', () => {
    const root = join(copyFixture('before'), 'sql', 'migrations', 'app');
    expect(runScript(root)).toEqual({
      status: 0,
      stdout: `No SQL or MongoDB contract was found under ${root}; nothing changed.\n`,
      stderr: '',
    });
  });
});
