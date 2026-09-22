import type { Contract } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { generateContractDts } from '../src/generate-contract-dts';
import { createMockSpi } from './mock-spi';
import { createTestContract } from './utils';

const HASHES = {
  storageHash: '0000000000000000000000000000000000000000000000000000000000000001',
  profileHash: '0000000000000000000000000000000000000000000000000000000000000002',
};

type TestTable = {
  readonly columns: Record<string, { readonly nullable: boolean }>;
};

function scalar(codecId: string, nullable = false) {
  return { nullable, type: { kind: 'scalar' as const, codecId } };
}

const int = (nullable = false) => scalar('pg/int4@1', nullable);
const text = (nullable = false) => scalar('pg/text@1', nullable);

function ref(model: string, namespace = 'public', space?: string) {
  return { namespace, model, ...(space === undefined ? {} : { space }) };
}

function sqlContract(
  namespaces: Record<string, Record<string, unknown>>,
  tables: Record<string, Record<string, TestTable>> = {},
): Contract {
  return createTestContract({
    namespaces: Object.fromEntries(
      Object.entries(namespaces).map(([nsId, models]) => [nsId, { models }]),
    ),
    tables,
  });
}

const sqlSpi = createMockSpi();

const mongoSpi = createMockSpi({
  id: 'mongo',
  getFamilyImports: () => [
    "import type { MongoCollection, MongoContractWithTypeMaps, MongoTypeMaps, RelationKeys } from '@internal/mongo-contract';",
  ],
});

function modelsBlock(dts: string): string {
  const start = dts.indexOf('export namespace Models');
  expect(start).toBeGreaterThan(-1);
  return dts.slice(start, dts.indexOf('export type TypeMaps')).trimEnd();
}

describe('Models namespace and models constant emission', () => {
  it('places the block between FieldInputTypes and TypeMaps, separated by blank lines', () => {
    const contract = sqlContract({
      public: { Item: { fields: { id: int() }, relations: {}, storage: {} } },
    });
    const dts = generateContractDts(contract, sqlSpi, [], HASHES);
    const modelsStart = dts.indexOf('export namespace Models');
    const typeMapsStart = dts.indexOf('export type TypeMaps');
    expect(dts.indexOf('export type FieldInputTypes')).toBeLessThan(modelsStart);
    expect(modelsStart).toBeLessThan(typeMapsStart);
    expect(typeMapsStart).toBeLessThan(dts.indexOf('export type Contract'));
    expect(dts.slice(0, modelsStart)).toMatch(/\n\n$/);
    expect(dts.slice(0, typeMapsStart)).toMatch(/;\n\n$/);
  });

  it('emits a model with no relations with a never phantom', () => {
    const contract = sqlContract({
      public: {
        Item: {
          fields: { id: int(), label: text(true) },
          relations: {},
          storage: { table: 'items', namespaceId: 'public' },
        },
      },
    });
    expect(modelsBlock(generateContractDts(contract, sqlSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type public_Item = {
          id: CodecTypes["pg/int4@1"]["output"];
          label: CodecTypes["pg/text@1"]["output"] | null;
          readonly [RelationKeys]?: never;
        };
      }

      export declare const models: {
        public: {
          Item: Models.public_Item;
        };
      };"
    `);
  });

  it('emits every SQL cardinality with to-one nullability from the relation flag', () => {
    const contract = sqlContract(
      {
        public: {
          User: {
            fields: { id: int(), managerId: int(), mentorId: int(true) },
            relations: {
              posts: {
                to: ref('Post'),
                cardinality: '1:N',
                on: { localFields: ['id'], targetFields: ['authorId'] },
              },
              tags: {
                to: ref('Tag'),
                cardinality: 'N:M',
                on: { localFields: ['id'], targetFields: ['id'] },
                through: {
                  table: 'user_tags',
                  namespaceId: 'public',
                  parentColumns: ['id'],
                  childColumns: ['user_id'],
                  targetColumns: ['tag_id'],
                },
              },
              manager: {
                to: ref('User'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['managerId'], targetFields: ['id'] },
              },
              mentor: {
                to: ref('User'),
                cardinality: 'N:1',
                nullable: true,
                on: { localFields: ['mentorId'], targetFields: ['id'] },
              },
              profile: {
                to: ref('Profile'),
                cardinality: '1:1',
                nullable: true,
                on: { localFields: ['id'], targetFields: ['userId'] },
              },
            },
            storage: {
              table: 'users',
              namespaceId: 'public',
              fields: {
                id: { column: 'id' },
                managerId: { column: 'manager_id' },
                mentorId: { column: 'mentor_id' },
              },
            },
          },
          Post: {
            fields: { id: int(), authorId: int() },
            relations: {
              author: {
                to: ref('User'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['authorId'], targetFields: ['id'] },
              },
            },
            storage: {
              table: 'posts',
              namespaceId: 'public',
              fields: { id: { column: 'id' }, authorId: { column: 'author_id' } },
            },
          },
          Tag: {
            fields: { id: int() },
            relations: {
              users: {
                to: ref('User'),
                cardinality: 'N:M',
                on: { localFields: ['id'], targetFields: ['id'] },
                through: {
                  table: 'user_tags',
                  namespaceId: 'public',
                  parentColumns: ['id'],
                  childColumns: ['tag_id'],
                  targetColumns: ['user_id'],
                },
              },
            },
            storage: { table: 'tags', namespaceId: 'public', fields: { id: { column: 'id' } } },
          },
          Profile: {
            fields: { id: int(), userId: int() },
            relations: {
              user: {
                to: ref('User'),
                cardinality: '1:1',
                nullable: false,
                on: { localFields: ['userId'], targetFields: ['id'] },
              },
            },
            storage: {
              table: 'profiles',
              namespaceId: 'public',
              fields: { id: { column: 'id' }, userId: { column: 'user_id' } },
            },
          },
        },
      },
      {
        public: {
          users: {
            columns: {
              id: { nullable: false },
              manager_id: { nullable: false },
              mentor_id: { nullable: true },
            },
          },
          posts: {
            columns: { id: { nullable: false }, author_id: { nullable: false } },
          },
          tags: { columns: { id: { nullable: false } } },
          profiles: {
            columns: { id: { nullable: false }, user_id: { nullable: false } },
          },
        },
      },
    );
    expect(modelsBlock(generateContractDts(contract, sqlSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type public_User = {
          id: CodecTypes["pg/int4@1"]["output"];
          managerId: CodecTypes["pg/int4@1"]["output"];
          mentorId: CodecTypes["pg/int4@1"]["output"] | null;
          posts: public_Post[];
          tags: public_Tag[];
          manager: public_User;
          mentor: public_User | null;
          profile: public_Profile | null;
          readonly [RelationKeys]?: "posts" | "tags" | "manager" | "mentor" | "profile";
        };
        export type public_Post = {
          id: CodecTypes["pg/int4@1"]["output"];
          authorId: CodecTypes["pg/int4@1"]["output"];
          author: public_User;
          readonly [RelationKeys]?: "author";
        };
        export type public_Tag = {
          id: CodecTypes["pg/int4@1"]["output"];
          users: public_User[];
          readonly [RelationKeys]?: "users";
        };
        export type public_Profile = {
          id: CodecTypes["pg/int4@1"]["output"];
          userId: CodecTypes["pg/int4@1"]["output"];
          user: public_User;
          readonly [RelationKeys]?: "user";
        };
      }

      export declare const models: {
        public: {
          User: Models.public_User;
          Post: Models.public_Post;
          Tag: Models.public_Tag;
          Profile: Models.public_Profile;
        };
      };"
    `);
  });

  it('emits __unbound__ and public models in one contract under separate keys', () => {
    const contract = sqlContract({
      public: {
        User: {
          fields: { id: int() },
          relations: {},
          storage: { table: 'users', namespaceId: 'public' },
        },
      },
      __unbound__: {
        Audit: {
          fields: { id: int(), actorId: int() },
          relations: {
            actor: {
              to: ref('User'),
              cardinality: 'N:1',
              nullable: true,
              on: { localFields: ['actorId'], targetFields: ['id'] },
            },
          },
          storage: { table: 'audit', namespaceId: '__unbound__' },
        },
      },
    });
    expect(modelsBlock(generateContractDts(contract, sqlSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type public_User = {
          id: CodecTypes["pg/int4@1"]["output"];
          readonly [RelationKeys]?: never;
        };
        export type unbound_Audit = {
          id: CodecTypes["pg/int4@1"]["output"];
          actorId: CodecTypes["pg/int4@1"]["output"];
          actor: public_User | null;
          readonly [RelationKeys]?: "actor";
        };
      }

      export declare const models: {
        public: {
          User: Models.public_User;
        };
        __unbound__: {
          Audit: Models.unbound_Audit;
        };
      };"
    `);
  });

  it('drops the namespace segment when the target declares no namespace support', () => {
    const contract = sqlContract({
      __unbound__: {
        User: {
          fields: { id: int() },
          relations: {
            tasks: {
              to: ref('Task', '__unbound__'),
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['userId'] },
            },
          },
          storage: { table: 'users', namespaceId: '__unbound__' },
        },
        Task: {
          discriminator: { field: 'kind' },
          variants: { Bug: { value: 'bug' } },
          fields: { id: int(), kind: text(), userId: int() },
          relations: {
            user: {
              to: ref('User', '__unbound__'),
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['userId'], targetFields: ['id'] },
            },
          },
          storage: { table: 'tasks', namespaceId: '__unbound__' },
        },
        Bug: {
          base: ref('Task', '__unbound__'),
          fields: { severity: int() },
          relations: {},
          storage: { table: 'tasks', namespaceId: '__unbound__' },
        },
      },
    });
    const dts = generateContractDts(contract, sqlSpi, [], HASHES, { supportsNamespaces: false });
    expect(modelsBlock(dts)).toMatchInlineSnapshot(`
      "export namespace Models {
        export type User = {
          id: CodecTypes["pg/int4@1"]["output"];
          tasks: AnyTask[];
          readonly [RelationKeys]?: "tasks";
        };
        export type Task = {
          id: CodecTypes["pg/int4@1"]["output"];
          kind: "bug";
          userId: CodecTypes["pg/int4@1"]["output"];
          user: User;
          readonly [RelationKeys]?: "user";
        };
        export type Bug = {
          id: CodecTypes["pg/int4@1"]["output"];
          kind: "bug";
          userId: CodecTypes["pg/int4@1"]["output"];
          severity: CodecTypes["pg/int4@1"]["output"];
          user: User;
          readonly [RelationKeys]?: "user";
        };
        export type AnyTask = Bug;
      }

      export declare const models: {
        User: Models.User;
        Task: Models.Task;
        Bug: Models.Bug;
        AnyTask: Models.AnyTask;
      };"
    `);
    expect(modelsBlock(dts)).not.toContain('unbound');
  });

  it('keeps the namespace segment when the target declares nothing about namespaces', () => {
    const contract = sqlContract({
      __unbound__: {
        User: { fields: { id: int() }, relations: {}, storage: { table: 'users' } },
      },
    });
    for (const options of [undefined, {}, { supportsNamespaces: true }]) {
      const dts = generateContractDts(contract, sqlSpi, [], HASHES, options);
      expect(dts).toContain('export type unbound_User = {');
      expect(dts).toContain('  __unbound__: {\n    User: Models.unbound_User;\n  };');
    }
  });

  it('emits a polymorphic base, its variants, and the Any union', () => {
    const contract = sqlContract(
      {
        public: {
          Task: {
            fields: { id: int(), type: text(), projectId: int(true) },
            relations: {
              project: {
                to: ref('Project'),
                cardinality: 'N:1',
                nullable: true,
                on: { localFields: ['projectId'], targetFields: ['id'] },
              },
            },
            discriminator: { field: 'type' },
            variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
            storage: {
              table: 'tasks',
              namespaceId: 'public',
              fields: {
                id: { column: 'id' },
                type: { column: 'type' },
                projectId: { column: 'project_id' },
              },
            },
          },
          Bug: {
            fields: { severity: text() },
            relations: {},
            base: ref('Task'),
            storage: {
              table: 'tasks',
              namespaceId: 'public',
              fields: { severity: { column: 'severity' } },
            },
          },
          Feature: {
            fields: { priority: int(), ownerId: int(true) },
            relations: {
              owner: {
                to: ref('Project'),
                cardinality: 'N:1',
                nullable: true,
                on: { localFields: ['ownerId'], targetFields: ['id'] },
              },
            },
            base: ref('Task'),
            storage: {
              table: 'features',
              namespaceId: 'public',
              fields: { priority: { column: 'priority' }, ownerId: { column: 'owner_id' } },
            },
          },
          Project: {
            fields: { id: int() },
            relations: {},
            storage: { table: 'projects', namespaceId: 'public', fields: { id: { column: 'id' } } },
          },
        },
      },
      {
        public: {
          tasks: {
            columns: {
              id: { nullable: false },
              type: { nullable: false },
              project_id: { nullable: true },
              severity: { nullable: true },
            },
          },
          features: {
            columns: {
              id: { nullable: false },
              priority: { nullable: false },
              owner_id: { nullable: true },
            },
          },
          projects: { columns: { id: { nullable: false } } },
        },
      },
    );
    expect(modelsBlock(generateContractDts(contract, sqlSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type public_Task = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "bug" | "feature";
          projectId: CodecTypes["pg/int4@1"]["output"] | null;
          project: public_Project | null;
          readonly [RelationKeys]?: "project";
        };
        export type public_Bug = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "bug";
          projectId: CodecTypes["pg/int4@1"]["output"] | null;
          severity: CodecTypes["pg/text@1"]["output"];
          project: public_Project | null;
          readonly [RelationKeys]?: "project";
        };
        export type public_Feature = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "feature";
          projectId: CodecTypes["pg/int4@1"]["output"] | null;
          priority: CodecTypes["pg/int4@1"]["output"];
          ownerId: CodecTypes["pg/int4@1"]["output"] | null;
          project: public_Project | null;
          owner: public_Project | null;
          readonly [RelationKeys]?: "project" | "owner";
        };
        export type public_Project = {
          id: CodecTypes["pg/int4@1"]["output"];
          readonly [RelationKeys]?: never;
        };
        export type public_AnyTask = public_Bug | public_Feature;
      }

      export declare const models: {
        public: {
          Task: Models.public_Task;
          Bug: Models.public_Bug;
          Feature: Models.public_Feature;
          Project: Models.public_Project;
          AnyTask: Models.public_AnyTask;
        };
      };"
    `);
  });

  it('emits a relation a variant re-declares once, with the variant line winning', () => {
    const contract = sqlContract(
      {
        public: {
          Task: {
            fields: { id: int(), type: text(), projectId: int() },
            relations: {
              project: {
                to: ref('Project'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['projectId'], targetFields: ['id'] },
              },
            },
            discriminator: { field: 'type' },
            variants: { Bug: { value: 'bug' } },
            storage: {
              table: 'tasks',
              namespaceId: 'public',
              fields: {
                id: { column: 'id' },
                type: { column: 'type' },
                projectId: { column: 'project_id' },
              },
            },
          },
          Bug: {
            fields: { bugProjectId: int(true) },
            relations: {
              project: {
                to: ref('Project'),
                cardinality: 'N:1',
                nullable: true,
                on: { localFields: ['bugProjectId'], targetFields: ['id'] },
              },
            },
            base: ref('Task'),
            storage: {
              table: 'bugs',
              namespaceId: 'public',
              fields: { bugProjectId: { column: 'bug_project_id' } },
            },
          },
          Project: {
            fields: { id: int() },
            relations: {},
            storage: { table: 'projects', namespaceId: 'public', fields: { id: { column: 'id' } } },
          },
        },
      },
      {
        public: {
          tasks: {
            columns: {
              id: { nullable: false },
              type: { nullable: false },
              project_id: { nullable: false },
            },
          },
          bugs: {
            columns: { bug_project_id: { nullable: true } },
          },
          projects: { columns: { id: { nullable: false } } },
        },
      },
    );
    expect(modelsBlock(generateContractDts(contract, sqlSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type public_Task = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "bug";
          projectId: CodecTypes["pg/int4@1"]["output"];
          project: public_Project;
          readonly [RelationKeys]?: "project";
        };
        export type public_Bug = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "bug";
          projectId: CodecTypes["pg/int4@1"]["output"];
          bugProjectId: CodecTypes["pg/int4@1"]["output"] | null;
          project: public_Project | null;
          readonly [RelationKeys]?: "project";
        };
        export type public_Project = {
          id: CodecTypes["pg/int4@1"]["output"];
          readonly [RelationKeys]?: never;
        };
        export type public_AnyTask = public_Bug;
      }

      export declare const models: {
        public: {
          Task: Models.public_Task;
          Bug: Models.public_Bug;
          Project: Models.public_Project;
          AnyTask: Models.public_AnyTask;
        };
      };"
    `);
  });

  it('emits a field a variant re-declares once, in the base position, with the variant type winning', () => {
    const contract = sqlContract(
      {
        public: {
          Task: {
            fields: { id: int(), type: text(), note: text() },
            relations: {},
            discriminator: { field: 'type' },
            variants: { Bug: { value: 'bug' } },
            storage: {
              table: 'tasks',
              namespaceId: 'public',
              fields: { id: { column: 'id' }, type: { column: 'type' }, note: { column: 'note' } },
            },
          },
          Bug: {
            fields: { note: text(true), severity: text() },
            relations: {},
            base: ref('Task'),
            storage: {
              table: 'bugs',
              namespaceId: 'public',
              fields: { note: { column: 'note' }, severity: { column: 'severity' } },
            },
          },
        },
      },
      {
        public: {
          tasks: {
            columns: {
              id: { nullable: false },
              type: { nullable: false },
              note: { nullable: false },
            },
          },
          bugs: { columns: { note: { nullable: true }, severity: { nullable: false } } },
        },
      },
    );
    expect(modelsBlock(generateContractDts(contract, sqlSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type public_Task = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "bug";
          note: CodecTypes["pg/text@1"]["output"];
          readonly [RelationKeys]?: never;
        };
        export type public_Bug = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "bug";
          note: CodecTypes["pg/text@1"]["output"] | null;
          severity: CodecTypes["pg/text@1"]["output"];
          readonly [RelationKeys]?: never;
        };
        export type public_AnyTask = public_Bug;
      }

      export declare const models: {
        public: {
          Task: Models.public_Task;
          Bug: Models.public_Bug;
          AnyTask: Models.public_AnyTask;
        };
      };"
    `);
  });

  it('types a relation whose target is a polymorphic base as the Any union', () => {
    const contract = sqlContract(
      {
        public: {
          Task: {
            fields: { id: int(), type: text(), projectId: int() },
            relations: {
              project: {
                to: ref('Project'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['projectId'], targetFields: ['id'] },
              },
            },
            discriminator: { field: 'type' },
            variants: { Bug: { value: 'bug' } },
            storage: {
              table: 'tasks',
              namespaceId: 'public',
              fields: {
                id: { column: 'id' },
                type: { column: 'type' },
                projectId: { column: 'project_id' },
              },
            },
          },
          Bug: {
            fields: {},
            relations: {},
            base: ref('Task'),
            storage: { table: 'tasks', namespaceId: 'public', fields: {} },
          },
          Project: {
            fields: { id: int() },
            relations: {
              tasks: {
                to: ref('Task'),
                cardinality: '1:N',
                on: { localFields: ['id'], targetFields: ['projectId'] },
              },
            },
            storage: { table: 'projects', namespaceId: 'public', fields: { id: { column: 'id' } } },
          },
          Comment: {
            fields: { id: int(), taskId: int() },
            relations: {
              task: {
                to: ref('Task'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['taskId'], targetFields: ['id'] },
              },
            },
            storage: {
              table: 'comments',
              namespaceId: 'public',
              fields: { id: { column: 'id' }, taskId: { column: 'task_id' } },
            },
          },
        },
      },
      {
        public: {
          tasks: {
            columns: {
              id: { nullable: false },
              type: { nullable: false },
              project_id: { nullable: false },
            },
          },
          projects: { columns: { id: { nullable: false } } },
          comments: {
            columns: { id: { nullable: false }, task_id: { nullable: false } },
          },
        },
      },
    );
    expect(modelsBlock(generateContractDts(contract, sqlSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type public_Task = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "bug";
          projectId: CodecTypes["pg/int4@1"]["output"];
          project: public_Project;
          readonly [RelationKeys]?: "project";
        };
        export type public_Bug = {
          id: CodecTypes["pg/int4@1"]["output"];
          type: "bug";
          projectId: CodecTypes["pg/int4@1"]["output"];
          project: public_Project;
          readonly [RelationKeys]?: "project";
        };
        export type public_Project = {
          id: CodecTypes["pg/int4@1"]["output"];
          tasks: public_AnyTask[];
          readonly [RelationKeys]?: "tasks";
        };
        export type public_Comment = {
          id: CodecTypes["pg/int4@1"]["output"];
          taskId: CodecTypes["pg/int4@1"]["output"];
          task: public_AnyTask;
          readonly [RelationKeys]?: "task";
        };
        export type public_AnyTask = public_Bug;
      }

      export declare const models: {
        public: {
          Task: Models.public_Task;
          Bug: Models.public_Bug;
          Project: Models.public_Project;
          Comment: Models.public_Comment;
          AnyTask: Models.public_AnyTask;
        };
      };"
    `);
  });

  it('omits a cross-space relation from the member and from RelationKeys', () => {
    const contract = sqlContract({
      public: {
        Order: {
          fields: { id: int(), customerId: int() },
          relations: {
            customer: {
              to: ref('Customer', 'public', 'crm'),
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['customerId'], targetFields: ['id'] },
            },
            lines: {
              to: ref('Line'),
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['orderId'] },
            },
          },
          storage: { table: 'orders', namespaceId: 'public' },
        },
        Line: {
          fields: { id: int(), orderId: int() },
          relations: {},
          storage: { table: 'lines', namespaceId: 'public' },
        },
      },
    });
    expect(modelsBlock(generateContractDts(contract, sqlSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type public_Order = {
          id: CodecTypes["pg/int4@1"]["output"];
          customerId: CodecTypes["pg/int4@1"]["output"];
          lines: public_Line[];
          readonly [RelationKeys]?: "lines";
        };
        export type public_Line = {
          id: CodecTypes["pg/int4@1"]["output"];
          orderId: CodecTypes["pg/int4@1"]["output"];
          readonly [RelationKeys]?: never;
        };
      }

      export declare const models: {
        public: {
          Order: Models.public_Order;
          Line: Models.public_Line;
        };
      };"
    `);
  });

  it('emits a Mongo contract with embed relations as fields, reference relations as relations, and no phantom on embedded models', () => {
    const objectId = () => scalar('mongo/objectId@1');
    const str = (nullable = false) => scalar('mongo/string@1', nullable);
    const contract = sqlContract({
      __unbound__: {
        User: {
          fields: { _id: objectId(), name: str() },
          relations: {
            addresses: { to: ref('Address', '__unbound__'), cardinality: '1:N' },
            tasks: {
              to: ref('Task', '__unbound__'),
              cardinality: '1:N',
              on: { localFields: ['_id'], targetFields: ['assigneeId'] },
            },
          },
          storage: { collection: 'users' },
        },
        Task: {
          fields: {
            _id: objectId(),
            title: str(),
            assigneeId: scalar('mongo/objectId@1', true),
            authorId: objectId(),
          },
          relations: {
            assignee: {
              to: ref('User', '__unbound__'),
              cardinality: 'N:1',
              nullable: true,
              on: { localFields: ['assigneeId'], targetFields: ['_id'] },
            },
            author: {
              to: ref('User', '__unbound__'),
              cardinality: 'N:1',
              nullable: true,
              on: { localFields: ['authorId'], targetFields: ['_id'] },
            },
            home: { to: ref('Address', '__unbound__'), cardinality: '1:1' },
          },
          storage: { collection: 'tasks' },
        },
        Address: {
          fields: { street: str() },
          relations: {},
          storage: {},
          owner: 'User',
        },
      },
    });
    expect(modelsBlock(generateContractDts(contract, mongoSpi, [], HASHES))).toMatchInlineSnapshot(`
      "export namespace Models {
        export type unbound_User = {
          _id: CodecTypes["mongo/objectId@1"]["output"];
          name: CodecTypes["mongo/string@1"]["output"];
          addresses: unbound_Address[];
          tasks: unbound_Task[];
          readonly [RelationKeys]?: "tasks";
        };
        export type unbound_Task = {
          _id: CodecTypes["mongo/objectId@1"]["output"];
          title: CodecTypes["mongo/string@1"]["output"];
          assigneeId: CodecTypes["mongo/objectId@1"]["output"] | null;
          authorId: CodecTypes["mongo/objectId@1"]["output"];
          home: unbound_Address;
          assignee: unbound_User | null;
          author: unbound_User | null;
          readonly [RelationKeys]?: "assignee" | "author";
        };
        export type unbound_Address = {
          street: CodecTypes["mongo/string@1"]["output"];
        };
      }

      export declare const models: {
        __unbound__: {
          User: Models.unbound_User;
          Task: Models.unbound_Task;
          Address: Models.unbound_Address;
        };
      };"
    `);
  });

  it('throws a structured error when two member names collide through the separator', () => {
    const contract = sqlContract({
      a_b: { C: { fields: { id: int() }, relations: {}, storage: {} } },
      a: { b_C: { fields: { id: int() }, relations: {}, storage: {} } },
    });
    expect(() => generateContractDts(contract, sqlSpi, [], HASHES)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_TYPE_NAME_COLLISION',
        message: expect.stringContaining('a_b.C'),
        meta: { memberName: 'a_b_C', sources: ['a_b.C', 'a.b_C'] },
      }),
    );
  });

  it('throws a structured error when a model is named Any<Base> beside a polymorphic base', () => {
    const contract = sqlContract({
      public: {
        Task: {
          fields: { id: int(), type: text() },
          relations: {},
          discriminator: { field: 'type' },
          variants: { Bug: { value: 'bug' } },
          storage: {},
        },
        Bug: { fields: {}, relations: {}, base: ref('Task'), storage: {} },
        AnyTask: { fields: { id: int() }, relations: {}, storage: {} },
      },
    });
    expect(() => generateContractDts(contract, sqlSpi, [], HASHES)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_TYPE_NAME_COLLISION',
        meta: { memberName: 'public_AnyTask', sources: ['public.AnyTask', 'public.Any<Task>'] },
      }),
    );
  });

  it('throws a structured error when a member name is not a TypeScript identifier', () => {
    const contract = sqlContract({
      'my-schema': { Item: { fields: { id: int() }, relations: {}, storage: {} } },
    });
    expect(() => generateContractDts(contract, sqlSpi, [], HASHES)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_TYPE_NAME_INVALID',
        meta: { memberName: 'my-schema_Item', source: 'my-schema.Item' },
      }),
    );
  });

  it('throws a structured error when a same-space relation targets a model that is not in the contract', () => {
    const contract = sqlContract({
      public: {
        Order: {
          fields: { id: int() },
          relations: {
            ghost: {
              to: ref('Ghost'),
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['id'], targetFields: ['id'] },
            },
          },
          storage: { table: 'orders', namespaceId: 'public' },
        },
      },
    });
    expect(() => generateContractDts(contract, sqlSpi, [], HASHES)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_RELATION_TARGET_MISSING',
        meta: {
          owner: 'public.Order',
          relationName: 'ghost',
          target: { namespaceId: 'public', modelName: 'Ghost' },
        },
      }),
    );
  });

  it('throws a structured error when a same-space relation targets a namespace that is not in the contract', () => {
    const contract = sqlContract({
      public: {
        Order: {
          fields: { id: int() },
          relations: {
            customer: {
              to: ref('Customer', 'crm'),
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['id'], targetFields: ['id'] },
            },
          },
          storage: { table: 'orders', namespaceId: 'public' },
        },
      },
    });
    expect(() => generateContractDts(contract, sqlSpi, [], HASHES)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_RELATION_TARGET_MISSING',
        meta: {
          owner: 'public.Order',
          relationName: 'customer',
          target: { namespaceId: 'crm', modelName: 'Customer' },
        },
      }),
    );
  });

  it('throws a structured error when a variant names a base that is not in the contract', () => {
    const contract = sqlContract({
      public: {
        Bug: { fields: { id: int() }, relations: {}, base: ref('Ghost'), storage: {} },
      },
    });
    expect(() => generateContractDts(contract, sqlSpi, [], HASHES)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_BASE_MISSING',
        message: expect.stringContaining('public.Bug'),
        meta: { variant: 'public.Bug', base: 'public.Ghost' },
      }),
    );
  });

  it('throws a structured error when a polymorphic base names a variant that is not in the contract', () => {
    const contract = sqlContract({
      public: {
        Task: {
          fields: { id: int(), type: text() },
          relations: {},
          discriminator: { field: 'type' },
          variants: { Bug: { value: 'bug' }, Ghost: { value: 'ghost' } },
          storage: {},
        },
        Bug: { fields: {}, relations: {}, base: ref('Task'), storage: {} },
      },
    });
    expect(() => generateContractDts(contract, sqlSpi, [], HASHES)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_VARIANT_MISSING',
        message: expect.stringContaining('public.Task'),
        meta: { base: 'public.Task', variantName: 'Ghost' },
      }),
    );
  });
});
