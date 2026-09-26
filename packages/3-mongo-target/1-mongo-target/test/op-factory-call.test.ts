/**
 * Per-class unit coverage for the Mongo migration IR:
 *
 * - Every `*Call` class constructs with literal args, is frozen, computes its
 *   label + operationClass, lowers to the matching runtime op via `toOp()`,
 *   and emits the expected TypeScript expression + import requirements.
 * - Import requirements always reference `@internal/target-mongo/migration`
 *   and the factory's own symbol — a regression guard against accidentally
 *   widening the import surface.
 * - Optional-args variants (`CreateIndexCall` with/without options,
 *   `CreateCollectionCall` with/without options, `CollModCall` with/without
 *   meta) omit the trailing argument when absent so rendered source stays
 *   minimal.
 */

import { describe, expect, it } from 'vitest';
import {
  collMod,
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
} from '../src/core/migrations/migration-factories';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
} from '../src/core/migrations/op-factory-call';

describe('Mongo call classes', () => {
  describe('construction + toOp parity', () => {
    it('CreateIndexCall freezes, labels from collection + keys, and lowers to createIndex(...)', () => {
      const call = new CreateIndexCall('users', [{ field: 'email', direction: 1 }], {
        unique: true,
      });

      expect(Object.isFrozen(call)).toBe(true);
      expect(call).toMatchObject({
        factoryName: 'createIndex',
        operationClass: 'additive',
        label: 'Create index on users (email:1)',
      });

      expect(call.toOp()).toEqual(
        createIndex('users', [{ field: 'email', direction: 1 }], { unique: true }),
      );
    });

    it('DropIndexCall freezes, labels destructively, and lowers to dropIndex(...)', () => {
      const call = new DropIndexCall('users', [{ field: 'legacy', direction: -1 }]);

      expect(Object.isFrozen(call)).toBe(true);
      expect(call).toMatchObject({
        factoryName: 'dropIndex',
        operationClass: 'destructive',
        label: 'Drop index on users (legacy:-1)',
      });

      expect(call.toOp()).toEqual(dropIndex('users', [{ field: 'legacy', direction: -1 }]));
    });

    it('CreateCollectionCall freezes, labels additively, and lowers to createCollection(...)', () => {
      const call = new CreateCollectionCall('users');

      expect(Object.isFrozen(call)).toBe(true);
      expect(call).toMatchObject({
        factoryName: 'createCollection',
        operationClass: 'additive',
        label: 'Create collection users',
      });

      expect(call.toOp()).toEqual(createCollection('users'));
    });

    it('DropCollectionCall freezes, labels destructively, and lowers to dropCollection(...)', () => {
      const call = new DropCollectionCall('users');

      expect(Object.isFrozen(call)).toBe(true);
      expect(call).toMatchObject({
        factoryName: 'dropCollection',
        operationClass: 'destructive',
        label: 'Drop collection users',
      });

      expect(call.toOp()).toEqual(dropCollection('users'));
    });

    it('CollModCall defaults operationClass to destructive, uses a default label, and lowers to collMod(...)', () => {
      const call = new CollModCall('users', { validator: { $jsonSchema: { type: 'object' } } });

      expect(Object.isFrozen(call)).toBe(true);
      expect(call).toMatchObject({
        factoryName: 'collMod',
        operationClass: 'destructive',
        label: 'Modify collection users',
      });

      expect(call.toOp()).toEqual(
        collMod('users', { validator: { $jsonSchema: { type: 'object' } } }),
      );
    });

    it('CollModCall honors caller-supplied meta.label and meta.operationClass and passes meta through toOp', () => {
      const call = new CollModCall(
        'users',
        { validator: { $jsonSchema: { type: 'object' } } },
        { label: 'Tighten users validator', operationClass: 'widening' },
      );

      expect(call).toMatchObject({
        operationClass: 'widening',
        label: 'Tighten users validator',
      });

      expect(call.toOp()).toEqual(
        collMod(
          'users',
          { validator: { $jsonSchema: { type: 'object' } } },
          { label: 'Tighten users validator', operationClass: 'widening' },
        ),
      );
    });
  });

  describe('renderTypeScript + importRequirements', () => {
    it('CreateIndexCall emits the factory call with options and imports createIndex only', () => {
      const call = new CreateIndexCall('users', [{ field: 'email', direction: 1 }], {
        unique: true,
      });

      expect(call.renderTypeScript()).toBe(
        'createIndex("users", [{ field: "email", direction: 1 }], { unique: true })',
      );
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@internal/target-mongo/migration', symbol: 'createIndex' },
      ]);
    });

    it('CreateIndexCall omits the trailing options argument when no options supplied', () => {
      const call = new CreateIndexCall('users', [{ field: 'email', direction: 1 }]);

      expect(call.renderTypeScript()).toBe(
        'createIndex("users", [{ field: "email", direction: 1 }])',
      );
    });

    it('DropIndexCall emits positional args and imports dropIndex only', () => {
      const call = new DropIndexCall('users', [{ field: 'legacy', direction: 1 }]);

      expect(call.renderTypeScript()).toBe(
        'dropIndex("users", [{ field: "legacy", direction: 1 }])',
      );
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@internal/target-mongo/migration', symbol: 'dropIndex' },
      ]);
    });

    it('CreateCollectionCall omits the trailing options argument when no options supplied', () => {
      const call = new CreateCollectionCall('users');

      expect(call.renderTypeScript()).toBe('createCollection("users")');
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@internal/target-mongo/migration', symbol: 'createCollection' },
      ]);
    });

    it('CreateCollectionCall emits the options argument when supplied', () => {
      const call = new CreateCollectionCall('sessions', { capped: true, size: 1024 });

      expect(call.renderTypeScript()).toBe(
        'createCollection("sessions", { capped: true, size: 1024 })',
      );
    });

    it('DropCollectionCall emits a single positional arg and imports dropCollection only', () => {
      const call = new DropCollectionCall('users');

      expect(call.renderTypeScript()).toBe('dropCollection("users")');
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@internal/target-mongo/migration', symbol: 'dropCollection' },
      ]);
    });

    it('CollModCall omits the trailing meta argument when no meta supplied', () => {
      const call = new CollModCall('users', { validator: { $jsonSchema: { type: 'object' } } });

      expect(call.renderTypeScript()).toBe(
        'collMod("users", { validator: { $jsonSchema: { type: "object" } } })',
      );
      expect(call.importRequirements()).toEqual([
        { moduleSpecifier: '@internal/target-mongo/migration', symbol: 'collMod' },
      ]);
    });

    it('CollModCall emits the meta argument when supplied', () => {
      const call = new CollModCall(
        'users',
        { validator: { $jsonSchema: { type: 'object' } } },
        { label: 'Tighten', operationClass: 'widening' },
      );

      expect(call.renderTypeScript()).toBe(
        'collMod("users", { validator: { $jsonSchema: { type: "object" } } }, { label: "Tighten", operationClass: "widening" })',
      );
    });
  });
});
