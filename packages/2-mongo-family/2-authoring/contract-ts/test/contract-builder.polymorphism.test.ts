import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { defineContract, field, index, model } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack } from './mongo-test-packs';

describe('mongo contract builder — polymorphic index scoping', () => {
  it('scopes variant indexes to the discriminator value and leaves base indexes untouched', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string(),
      },
      indexes: [index({ title: 1 })],
      discriminator: {
        field: 'type',
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
      indexes: [index({ severity: 1 }, { unique: true })],
    });

    const Feature = model('Feature', {
      collection: 'tasks',
      base: Task,
      fields: {
        priority: field.string(),
      },
      indexes: [index({ priority: 1 }, { unique: true })],
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug, Feature },
    });

    const collections = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries[
      'collection'
    ] as unknown as Record<
      string,
      {
        indexes?: Array<{
          keys: Array<{ field: string; direction: number }>;
          unique?: boolean;
          partialFilterExpression?: Record<string, unknown>;
        }>;
      }
    >;
    const indexes = collections['tasks']?.indexes ?? [];

    const titleIdx = indexes.find((i) => i.keys.some((k) => k.field === 'title'));
    const severityIdx = indexes.find((i) => i.keys.some((k) => k.field === 'severity'));
    const priorityIdx = indexes.find((i) => i.keys.some((k) => k.field === 'priority'));

    expect(titleIdx?.partialFilterExpression).toBeUndefined();
    expect(severityIdx?.partialFilterExpression).toEqual({ type: 'bug' });
    expect(priorityIdx?.partialFilterExpression).toEqual({ type: 'feature' });
  });

  it('resolves the base builder by __name even when defineContract record keys differ from model names', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string(),
      },
      indexes: [index({ title: 1 })],
      discriminator: {
        field: 'type',
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
      indexes: [index({ severity: 1 }, { unique: true, name: 'bug_severity' })],
    });

    const Feature = model('Feature', {
      collection: 'tasks',
      base: Task,
      fields: {
        priority: field.string(),
      },
      indexes: [index({ priority: 1 }, { unique: true })],
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { taskModel: Task, bugModel: Bug, featureModel: Feature },
    });

    const collections = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries[
      'collection'
    ] as unknown as Record<
      string,
      {
        indexes?: Array<{
          keys: Array<{ field: string; direction: number }>;
          unique?: boolean;
          partialFilterExpression?: Record<string, unknown>;
        }>;
      }
    >;
    const indexes = collections['tasks']?.indexes ?? [];
    const severityIdx = indexes.find((i) => i.keys.some((k) => k.field === 'severity'));
    const priorityIdx = indexes.find((i) => i.keys.some((k) => k.field === 'priority'));
    expect(severityIdx?.partialFilterExpression).toEqual({ type: 'bug' });
    expect(priorityIdx?.partialFilterExpression).toEqual({ type: 'feature' });
  });

  it('refuses sibling variant indexes on the same keys that both go unnamed, asking for a name', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: { _id: field.objectId(), type: field.string() },
      discriminator: {
        field: 'type',
        variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
      },
    });
    const variant = (name: string) =>
      model(name, {
        collection: 'tasks',
        base: Task,
        fields: { severity: field.string() },
        indexes: [index({ severity: 1 })],
      });

    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Task, Bug: variant('Bug'), Feature: variant('Feature') },
      }),
    ).toThrow(
      'Collection "tasks" has two indexes named "severity_1": index 0 of model "Bug" and index 0 of model "Feature". An index without a name is named after its keys and directions. Give one of them another name with the index option name.',
    );
  });

  it('names the written positions of two indexes with one name when an earlier index was merged away', () => {
    const User = model('User', {
      collection: 'users',
      fields: { _id: field.objectId(), a: field.string(), b: field.string(), c: field.string() },
      indexes: [
        index({ a: 1 }, { unique: true }),
        index({ a: 1 }),
        index({ b: 1 }, { name: 'by_field' }),
        index({ c: 1 }, { name: 'by_field' }),
      ],
    });

    expect(() =>
      defineContract({ family: mongoFamilyPack, target: mongoTargetPack, models: { User } }),
    ).toThrow(
      'Collection "users" has two indexes named "by_field": index 2 of model "User" and index 3 of model "User".',
    );
  });

  it('allows sibling variants on the same collection to declare structurally identical indexes, each named', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
      },
      discriminator: {
        field: 'type',
        variants: {
          Bug: { value: 'bug' },
          Feature: { value: 'feature' },
        },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
      indexes: [index({ severity: 1 }, { unique: true, name: 'bug_severity' })],
    });

    const Feature = model('Feature', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
      indexes: [index({ severity: 1 }, { unique: true, name: 'feature_severity' })],
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug, Feature },
    });

    const collections = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries[
      'collection'
    ] as unknown as Record<
      string,
      {
        indexes?: Array<{
          name: string;
          keys: Array<{ field: string; direction: number }>;
          unique?: boolean;
          partialFilterExpression?: Record<string, unknown>;
        }>;
      }
    >;
    const indexes = collections['tasks']?.indexes ?? [];
    const severityIndexes = indexes.filter((i) => i.keys.some((k) => k.field === 'severity'));
    expect(severityIndexes).toHaveLength(2);
    expect(severityIndexes.every((i) => i.unique === true)).toBe(true);
    const filters = severityIndexes.map((i) => i.partialFilterExpression);
    expect(filters).toContainEqual({ type: 'bug' });
    expect(filters).toContainEqual({ type: 'feature' });
    expect(severityIndexes.map((i) => i.name)).toEqual(['bug_severity', 'feature_severity']);
  });

  it('AND-merges a user-supplied partialFilterExpression on a variant index', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string(),
      },
      discriminator: {
        field: 'type',
        variants: { Bug: { value: 'bug' } },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
      indexes: [index({ severity: 1 }, { partialFilterExpression: { active: true } })],
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug },
    });

    const collections = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries[
      'collection'
    ] as unknown as Record<
      string,
      {
        indexes?: Array<{
          keys: Array<{ field: string; direction: number }>;
          partialFilterExpression?: Record<string, unknown>;
        }>;
      }
    >;
    const indexes = collections['tasks']?.indexes ?? [];
    const severityIdx = indexes.find((i) => i.keys.some((k) => k.field === 'severity'));
    expect(severityIdx?.partialFilterExpression).toEqual({ active: true, type: 'bug' });
  });

  it('is idempotent when the user filter already sets the discriminator to the matching value', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
      },
      discriminator: {
        field: 'type',
        variants: { Bug: { value: 'bug' } },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
      indexes: [index({ severity: 1 }, { partialFilterExpression: { type: 'bug' } })],
    });

    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug },
    });

    const collections = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries[
      'collection'
    ] as unknown as Record<
      string,
      {
        indexes?: Array<{
          keys: Array<{ field: string; direction: number }>;
          partialFilterExpression?: Record<string, unknown>;
        }>;
      }
    >;
    const indexes = collections['tasks']?.indexes ?? [];
    const severityIdx = indexes.find((i) => i.keys.some((k) => k.field === 'severity'));
    expect(severityIdx?.partialFilterExpression).toEqual({ type: 'bug' });
  });

  it('throws when a variant indexes a base-inherited field (AC-M3-07)', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string(),
      },
      discriminator: {
        field: 'type',
        variants: { Bug: { value: 'bug' } },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
      indexes: [index({ title: 1 })],
    });

    let thrown: unknown;
    try {
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Task, Bug },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/Bug/);
    expect(message).toMatch(/title/);
    expect(message).toMatch(/unknown field|not a field|not declared/i);
  });

  it('throws an Error naming the model, discriminator field, user value, and variant value when the user filter conflicts', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
      },
      discriminator: {
        field: 'type',
        variants: { Bug: { value: 'bug' } },
      },
    });

    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: {
        severity: field.string(),
      },
      indexes: [index({ severity: 1 }, { partialFilterExpression: { type: 'feature' } })],
    });

    let thrown: unknown;
    try {
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Task, Bug },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ code: 'CONTRACT.INDEX_INVALID' });
    const message = (thrown as Error).message;
    expect(message).toMatch(/Bug/);
    expect(message).toMatch(/type/);
    expect(message).toMatch(/feature/);
    expect(message).toMatch(/bug/);
  });
});

describe('mongo contract builder — discriminator values', () => {
  it('rejects variants that share a discriminator value', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
      },
      discriminator: {
        field: 'type',
        variants: { Bug: { value: 'bug' }, OtherBug: { value: 'bug' } },
      },
    });
    const Bug = model('Bug', { collection: 'tasks', base: Task, fields: {} });
    const OtherBug = model('OtherBug', { collection: 'tasks', base: Task, fields: {} });

    expect(() =>
      defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: { Task, Bug, OtherBug },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'Discriminator value "bug" is used by both "Bug" and "OtherBug" on base model "Task".',
        meta: {
          modelName: 'Task',
          value: 'bug',
          variants: ['Bug', 'OtherBug'],
          reason: 'duplicate-discriminator-value',
        },
      }),
    );
  });
});
