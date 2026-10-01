import type { Contract, NamespaceId } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';

interface PolyStorage {
  readonly tables: {
    readonly tasks: {
      columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly title: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: false;
        };
        readonly type: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: false;
        };
        readonly severity: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: true;
        };
        readonly project_id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: true;
        };
        readonly parent_id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: true;
        };
        readonly assignee_id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: true;
        };
      };
      primaryKey: { columns: readonly ['id'] };
      uniques: readonly [];
      indexes: readonly [];
      foreignKeys: readonly [];
    };
    readonly features: {
      columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly priority: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly assignee_id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: true;
        };
      };
      primaryKey: { columns: readonly ['id'] };
      uniques: readonly [];
      indexes: readonly [];
      foreignKeys: readonly [];
    };
    readonly assignees: {
      columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly name: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: false;
        };
      };
      primaryKey: { columns: readonly ['id'] };
      uniques: readonly [];
      indexes: readonly [];
      foreignKeys: readonly [];
    };
    readonly plain_model: {
      columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly name: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: false;
        };
      };
      primaryKey: { columns: readonly ['id'] };
      uniques: readonly [];
      indexes: readonly [];
      foreignKeys: readonly [];
    };
    readonly projects: {
      columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly name: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: false;
        };
      };
      primaryKey: { columns: readonly ['id'] };
      uniques: readonly [];
      indexes: readonly [];
      foreignKeys: readonly [];
    };
  };
  readonly storageHash: string;
}

type R = Record<string, never>;

export type PolyModels = {
  readonly Task: {
    readonly fields: {
      readonly id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      readonly title: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      readonly type: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      readonly projectId: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: true;
      };
      readonly parentId: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: true;
      };
    };
    readonly relations: {
      readonly subtasks: {
        readonly to: { readonly namespace: '__unbound__' & NamespaceId; readonly model: 'Task' };
        readonly cardinality: '1:N';
        readonly on: {
          readonly localFields: readonly ['id'];
          readonly targetFields: readonly ['parentId'];
        };
      };
    };
    readonly storage: {
      readonly table: 'tasks';
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly title: { readonly column: 'title' };
        readonly type: { readonly column: 'type' };
        readonly projectId: { readonly column: 'project_id' };
        readonly parentId: { readonly column: 'parent_id' };
      };
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
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: true;
      };
      readonly assigneeId: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: true;
      };
    };
    readonly relations: {
      readonly assignee: {
        readonly to: {
          readonly namespace: '__unbound__' & NamespaceId;
          readonly model: 'Assignee';
        };
        readonly cardinality: 'N:1';
        readonly nullable: true;
        readonly on: {
          readonly localFields: readonly ['assigneeId'];
          readonly targetFields: readonly ['id'];
        };
      };
    };
    readonly storage: {
      readonly table: 'tasks';
      readonly fields: {
        readonly severity: { readonly column: 'severity' };
        readonly assigneeId: { readonly column: 'assignee_id' };
      };
    };
    readonly base: { readonly namespace: '__unbound__' & NamespaceId; readonly model: 'Task' };
  };
  readonly Feature: {
    readonly fields: {
      readonly priority: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      readonly assigneeId: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: true;
      };
    };
    readonly relations: {
      readonly assignee: {
        readonly to: {
          readonly namespace: '__unbound__' & NamespaceId;
          readonly model: 'Assignee';
        };
        readonly cardinality: 'N:1';
        readonly nullable: true;
        readonly on: {
          readonly localFields: readonly ['assigneeId'];
          readonly targetFields: readonly ['id'];
        };
      };
    };
    readonly storage: {
      readonly table: 'features';
      readonly fields: {
        readonly priority: { readonly column: 'priority' };
        readonly assigneeId: { readonly column: 'assignee_id' };
      };
    };
    readonly base: { readonly namespace: '__unbound__' & NamespaceId; readonly model: 'Task' };
  };
  readonly Assignee: {
    readonly fields: {
      readonly id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      readonly name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
    };
    readonly relations: R;
    readonly storage: {
      readonly table: 'assignees';
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly name: { readonly column: 'name' };
      };
    };
  };
  readonly PlainModel: {
    readonly fields: {
      readonly id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      readonly name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
    };
    readonly relations: R;
    readonly storage: {
      readonly table: 'plain_model';
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly name: { readonly column: 'name' };
      };
    };
  };
  readonly Project: {
    readonly fields: {
      readonly id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      readonly name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
    };
    readonly relations: {
      readonly tasks: {
        readonly to: { readonly namespace: '__unbound__' & NamespaceId; readonly model: 'Task' };
        readonly cardinality: '1:N';
        readonly on: {
          readonly localFields: readonly ['id'];
          readonly targetFields: readonly ['projectId'];
        };
      };
    };
    readonly storage: {
      readonly table: 'projects';
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly name: { readonly column: 'name' };
      };
    };
  };
};

export type PolyContract = Omit<Contract<PolyStorage & SqlStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: PolyModels };
    };
  };
};
