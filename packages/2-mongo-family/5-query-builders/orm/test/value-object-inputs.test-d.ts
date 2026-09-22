import type { CrossReference, ProfileHashBase, StorageHashBase } from '@internal/contract/types';
import type {
  MongoCollection,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@internal/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import type {
  CreateInput,
  DefaultModelRow,
  IncludedRow,
  InferFullRow,
  VariantCreateInput,
} from '../src/types';

type CrossRefFor<M extends string> = CrossReference & { readonly model: M };

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
};

type TestFieldOutputTypes = {
  readonly __unbound__: {
    readonly User: {
      readonly _id: string;
      readonly name: string;
      readonly contactInfo: { phone: string; website: string | null } | null;
      readonly tags: string[];
    };
  };
};

type TestTypeMaps = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldOutputTypes>;

type VOContract = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'test'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: { readonly users: CrossReference & { readonly model: 'User' } };
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly User: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly name: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly contactInfo: {
                  readonly nullable: true;
                  readonly type: { readonly kind: 'valueObject'; readonly name: 'ContactInfo' };
                };
                readonly tags: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                  readonly many: true;
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'users' };
            };
          };
          readonly valueObjects: {
            readonly ContactInfo: {
              readonly fields: {
                readonly phone: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly website: {
                  readonly nullable: true;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
            };
          };
        };
      };
    };
    readonly storage: {
      readonly storageHash: StorageHashBase<'test-storage'>;
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: { readonly users: MongoCollection } };
        };
      };
    };
  },
  TestTypeMaps
>;

type ContactInfoShape = { phone: string; website: string | null };

test('DefaultModelRow expands value object to inline structure', () => {
  type Row = DefaultModelRow<VOContract, 'User'>;
  expectTypeOf<Row['contactInfo']>().toEqualTypeOf<ContactInfoShape | null>();
});

test('DefaultModelRow handles scalar array fields', () => {
  type Row = DefaultModelRow<VOContract, 'User'>;
  expectTypeOf<Row['tags']>().toEqualTypeOf<string[]>();
});

test('CreateInput accepts inline value object structure', () => {
  type Input = CreateInput<VOContract, 'User'>;
  expectTypeOf<Input['contactInfo']>().toEqualTypeOf<ContactInfoShape | null>();
});

test('CreateInput accepts null for nullable value object field', () => {
  type Input = CreateInput<VOContract, 'User'>;
  const input: Input = {
    name: 'Alice',
    contactInfo: null,
    tags: [],
  };
  expectTypeOf(input).toExtend<Input>();
});

test('CreateInput accepts populated value object', () => {
  type Input = CreateInput<VOContract, 'User'>;
  const input: Input = {
    name: 'Alice',
    contactInfo: { phone: '555-1234', website: null },
    tags: ['admin'],
  };
  expectTypeOf(input).toExtend<Input>();
});

test('update input accepts wholesale value object replacement', () => {
  type UpdateInput = Partial<DefaultModelRow<VOContract, 'User'>>;
  const input: UpdateInput = {
    contactInfo: { phone: '555-9999', website: 'https://example.com' },
  };
  expectTypeOf(input).toExtend<UpdateInput>();
});

test('update input accepts null for nullable value object field', () => {
  type UpdateInput = Partial<DefaultModelRow<VOContract, 'User'>>;
  const input: UpdateInput = { contactInfo: null };
  expectTypeOf(input).toExtend<UpdateInput>();
});

// --- Contracts with FieldOutputTypes / FieldInputTypes ---

type FieldOutputTypesForUser = {
  readonly __unbound__: {
    readonly User: {
      readonly _id: string;
      readonly name: string;
      readonly contactInfo: { phone: string; website: string | null } | null;
      readonly tags: string[];
    };
  };
};

type FieldInputTypesForUser = {
  readonly __unbound__: {
    readonly User: {
      readonly _id: string;
      readonly name: string;
      readonly contactInfo: { phone: string; website: string | null } | null;
      readonly tags: string[];
    };
  };
};

type TypeMapsWithFieldTypes = MongoTypeMaps<
  TestCodecTypes,
  FieldOutputTypesForUser,
  FieldInputTypesForUser
>;

type VOContractWithFieldTypes = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'test'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: { readonly users: CrossReference & { readonly model: 'User' } };
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly User: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly name: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly contactInfo: {
                  readonly nullable: true;
                  readonly type: { readonly kind: 'valueObject'; readonly name: 'ContactInfo' };
                };
                readonly tags: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                  readonly many: true;
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'users' };
            };
          };
          readonly valueObjects: {
            readonly ContactInfo: {
              readonly fields: {
                readonly phone: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly website: {
                  readonly nullable: true;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
            };
          };
        };
      };
    };
    readonly storage: {
      readonly storageHash: StorageHashBase<'test-storage'>;
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: { readonly users: MongoCollection } };
        };
      };
    };
  },
  TypeMapsWithFieldTypes
>;

test('DefaultModelRow resolves to primitives when FieldOutputTypes is present', () => {
  type Row = DefaultModelRow<VOContractWithFieldTypes, 'User'>;
  expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
  expectTypeOf<Row['tags']>().toEqualTypeOf<string[]>();
  expectTypeOf<Row['contactInfo']>().toEqualTypeOf<ContactInfoShape | null>();
});

test('DefaultModelRow resolves via InferModelRow from the precomputed field output map', () => {
  type Row = DefaultModelRow<VOContract, 'User'>;
  expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
});

test('CreateInput resolves via FieldInputTypes when present', () => {
  type Input = CreateInput<VOContractWithFieldTypes, 'User'>;
  expectTypeOf<Input['name']>().toEqualTypeOf<string>();
  expectTypeOf<Input['contactInfo']>().toEqualTypeOf<ContactInfoShape | null>();
});

// --- Contracts with embedded relations, references, and variants + FieldOutputTypes ---

type ExtCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
};

type ExtFieldOutputTypes = {
  readonly __unbound__: {
    readonly Task: {
      readonly _id: string;
      readonly title: string;
      readonly type: string;
      readonly assigneeId: string;
    };
    readonly Bug: { readonly severity: string };
    readonly Feature: { readonly priority: string };
    readonly User: { readonly _id: string; readonly name: string };
    readonly Comment: { readonly _id: string; readonly text: string };
  };
};

type ExtFieldInputTypes = {
  readonly __unbound__: {
    readonly Task: {
      readonly _id: string;
      readonly title: string;
      readonly type: string;
      readonly assigneeId: string;
    };
    readonly Bug: { readonly severity: string };
    readonly Feature: { readonly priority: string };
    readonly User: { readonly _id: string; readonly name: string };
    readonly Comment: { readonly _id: string; readonly text: string };
  };
};

type ExtTypeMaps = MongoTypeMaps<ExtCodecTypes, ExtFieldOutputTypes, ExtFieldInputTypes>;

type ExtContract = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'test'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: {
      readonly tasks: CrossReference & { readonly model: 'Task' };
      readonly users: CrossReference & { readonly model: 'User' };
    };
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly Task: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly title: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly type: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly assigneeId: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
              };
              readonly relations: {
                readonly assignee: {
                  readonly to: CrossRefFor<'User'>;
                  readonly cardinality: 'N:1';
                  readonly nullable: false;
                  readonly on: {
                    readonly localFields: readonly ['assigneeId'];
                    readonly targetFields: readonly ['_id'];
                  };
                };
                readonly comments: {
                  readonly to: CrossRefFor<'Comment'>;
                  readonly cardinality: '1:N';
                };
              };
              readonly storage: {
                readonly collection: 'tasks';
                readonly relations: { readonly comments: { readonly field: 'comments' } };
              };
              readonly discriminator: { readonly field: 'type' };
              readonly variants: {
                readonly Bug: { readonly value: 'bug' };
                readonly Feature: { readonly value: 'feature' };
              };
            };
            readonly Bug: {
              readonly fields: {
                readonly severity: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'tasks' };
              readonly base: CrossRefFor<'Task'>;
            };
            readonly Feature: {
              readonly fields: {
                readonly priority: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'tasks' };
              readonly base: CrossRefFor<'Task'>;
            };
            readonly User: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly name: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'users' };
            };
            readonly Comment: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly text: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: Record<string, never>;
              readonly owner: 'Task';
            };
          };
        };
      };
    };
    readonly storage: {
      readonly storageHash: StorageHashBase<'ext-storage'>;
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: {
            readonly collection: {
              readonly tasks: MongoCollection;
              readonly users: MongoCollection;
            };
          };
        };
      };
    };
  },
  ExtTypeMaps
>;

test('InferFullRow resolves to primitives with embedded relations when FieldOutputTypes is present', () => {
  type TaskRow = InferFullRow<ExtContract, 'Task'>;
  expectTypeOf<TaskRow['_id']>().toEqualTypeOf<string>();
  expectTypeOf<TaskRow['title']>().toEqualTypeOf<string>();
  expectTypeOf<TaskRow['comments']>().toExtend<Array<{ _id: string; text: string }>>();
});

test('IncludedRow resolves included reference relations when FieldOutputTypes is present', () => {
  type TaskIncluded = IncludedRow<ExtContract, 'Task', { assignee: true }>;
  expectTypeOf<TaskIncluded['_id']>().toEqualTypeOf<string>();
  expectTypeOf<TaskIncluded['assignee']>().toEqualTypeOf<{ _id: string; name: string }>();
});

test('VariantCreateInput resolves when FieldInputTypes is present', () => {
  type BugInput = VariantCreateInput<ExtContract, 'Task', 'Bug'>;
  expectTypeOf<BugInput>().toHaveProperty('title');
  expectTypeOf<BugInput>().toHaveProperty('severity');
});
