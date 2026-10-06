import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import {
  applyNaming,
  field,
  isContractInput,
  normalizeRelationFieldNames,
  rel,
  resolveRelationModelName,
  type TargetFieldRef,
} from '../src/contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';
import { testIndexPack } from './helpers/test-index-pack';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const { model } = createComposedAuthoringHelpers({
  ...testTypeLookups,
  family: bareFamilyPack,
  target: postgresTargetPack,
  extensions: { testIndexes: testIndexPack },
});

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');
const charColumn = columnDescriptor('sql/char@1');

describe('contract DSL runtime helpers', () => {
  it('normalizes defaults, generated descriptors, relation helpers, and input detection', () => {
    const literalDefault = field.column(textColumn).default('draft').build();
    const functionDefault = field
      .column(textColumn)
      .default({ kind: 'function', expression: 'now()' })
      .build();
    const generated = field
      .generated({
        type: charColumn,
        typeParams: { length: 12 },
        generated: {
          kind: 'generator',
          id: 'nanoid',
          params: { size: 12 },
        },
      })
      .build();

    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const lazyBelongsTo = rel.belongsTo(() => User, { from: 'id', to: 'id' }).build();

    expect(literalDefault.default).toEqual({ kind: 'literal', value: 'draft' });
    expect(functionDefault.default).toEqual({ kind: 'function', expression: 'now()' });
    expect(generated.descriptor).toEqual({
      codecId: 'sql/char@1',
      typeParams: { length: 12 },
    });
    expect(normalizeRelationFieldNames('id')).toEqual(['id']);
    expect(normalizeRelationFieldNames(['orgId', 'userId'])).toEqual(['orgId', 'userId']);
    expect(resolveRelationModelName(lazyBelongsTo.toModel)).toBe('User');
    expect(applyNaming('HTTPRequestLog', 'snake_case')).toBe('http_request_log');
    expect(applyNaming('UserProfile', 'identity')).toBe('UserProfile');
    const familyPack = { kind: 'family', id: 'sql', familyId: 'sql', version: '0.0.1' };
    expect(isContractInput({ family: familyPack, target: postgresTargetPack })).toBe(true);
    expect(isContractInput({ target: postgresTargetPack })).toBe(false);
    expect(isContractInput({ family: familyPack, target: { kind: 'extension' } })).toBe(false);
    expect(isContractInput(null)).toBe(false);
  });

  it('rejects runtime-only misuse of model tokens and relation sql helpers', () => {
    const Anonymous = model({
      fields: {
        id: field.column(int4Column),
      },
    });

    const hasMany = rel.hasMany('User', { by: 'userId' });

    expect(() =>
      Reflect.apply(Anonymous.ref as (...args: readonly unknown[]) => unknown, Anonymous, ['id']),
    ).toThrow('Model tokens require model("ModelName", ...) before calling .ref(...)');

    expect(() =>
      Reflect.apply(Anonymous.ref as (...args: readonly unknown[]) => unknown, Anonymous, ['id']),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.MODEL_TOKEN_INVALID' }));

    expect(() =>
      Reflect.apply(rel.belongsTo as (...args: readonly unknown[]) => unknown, rel, [
        Anonymous,
        { from: 'id', to: 'id' },
      ]),
    ).toThrow(
      'Relation targets require named model tokens. Use model("ModelName", ...) before passing a token to rel.*(...).',
    );

    expect(() => model('User', undefined as never)).toThrow(
      'model("ModelName", ...) requires a model definition.',
    );

    expect(() =>
      Reflect.apply(hasMany.sql as (...args: readonly unknown[]) => unknown, hasMany, [
        { fk: { name: 'post_user_id_fkey' } },
      ]),
    ).toThrow('relation.sql(...) is only supported for belongsTo relations.');

    expect(() =>
      Reflect.apply(hasMany.sql as (...args: readonly unknown[]) => unknown, hasMany, [
        { fk: { name: 'post_user_id_fkey' } },
      ]),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.RELATION_INVALID' }));

    expect(() => model('User', undefined as never)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }),
    );
  });

  it('builds sql specs with explicit options and validates target refs eagerly', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Team = model('Team', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const AuditLog = model('AuditLog', {
      fields: {
        userId: field.column(int4Column),
        teamId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      indexes: [
        constraints.index([cols.teamId], {
          name: 'audit_log_team_id_idx',
          type: 'hash',
          options: { fillfactor: 70 },
        }),
      ],
      foreignKeys: [
        constraints.foreignKey([cols.userId], [User.refs['id']], {
          name: 'audit_log_user_id_fkey',
          onDelete: 'cascade',
          onUpdate: 'restrict',
          constraint: false,
          index: false,
        }),
      ],
    }));

    expect(AuditLog.buildSqlSpec()).toEqual({
      indexes: [
        {
          kind: 'index',
          fields: ['teamId'],
          name: 'audit_log_team_id_idx',
          type: 'hash',
          options: { fillfactor: 70 },
        },
      ],
      foreignKeys: [
        {
          kind: 'fk',
          fields: ['userId'],
          targetModel: 'User',
          targetFields: ['id'],
          targetSource: 'token',
          name: 'audit_log_user_id_fkey',
          onDelete: 'cascade',
          onUpdate: 'restrict',
          constraint: false,
          index: false,
        },
      ],
    });

    const emptyTargetRefs: readonly TargetFieldRef[] = [];

    const mixedTargetRefs: readonly TargetFieldRef[] = [User.ref('id'), Team.ref('id')];

    const BrokenEmpty = model('BrokenEmpty', {
      fields: {
        userId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      foreignKeys: [constraints.foreignKey([cols.userId], emptyTargetRefs)],
    }));

    const BrokenMixed = model('BrokenMixed', {
      fields: {
        userId: field.column(int4Column),
        teamId: field.column(int4Column),
      },
    }).sql(({ cols, constraints }) => ({
      foreignKeys: [constraints.foreignKey([cols.userId, cols.teamId], mixedTargetRefs)],
    }));

    expect(() => BrokenEmpty.buildSqlSpec()).toThrow('Expected at least one target ref');
    expect(() => BrokenEmpty.buildSqlSpec()).toThrow(
      expect.objectContaining({ code: 'CONTRACT.FOREIGN_KEY_INVALID' }),
    );
    expect(() => BrokenMixed.buildSqlSpec()).toThrow(
      'All target refs in a foreign key must point to the same model',
    );
  });
});

describe('applyNaming', () => {
  it('converts camelCase to snake_case', () => {
    expect(applyNaming('UserProfile', 'snake_case')).toBe('user_profile');
    expect(applyNaming('createdAt', 'snake_case')).toBe('created_at');
  });

  it('handles consecutive uppercase runs', () => {
    expect(applyNaming('HTTPRequestLog', 'snake_case')).toBe('http_request_log');
    expect(applyNaming('XMLParser', 'snake_case')).toBe('xml_parser');
  });

  it('handles all-uppercase input', () => {
    expect(applyNaming('HTTP', 'snake_case')).toBe('http');
    expect(applyNaming('URL', 'snake_case')).toBe('url');
  });

  it('passes through already-lowercase input', () => {
    expect(applyNaming('users', 'snake_case')).toBe('users');
    expect(applyNaming('created_at', 'snake_case')).toBe('created_at');
  });

  it('handles single-character input', () => {
    expect(applyNaming('A', 'snake_case')).toBe('a');
    expect(applyNaming('z', 'snake_case')).toBe('z');
  });

  it('handles empty string', () => {
    expect(applyNaming('', 'snake_case')).toBe('');
  });

  it('handles mixed number/letter boundaries', () => {
    expect(applyNaming('user2Profile', 'snake_case')).toBe('user2_profile');
  });

  it('returns input unchanged for identity strategy', () => {
    expect(applyNaming('UserProfile', 'identity')).toBe('UserProfile');
    expect(applyNaming('HTTPRequestLog', 'identity')).toBe('HTTPRequestLog');
  });

  it('returns input unchanged for undefined strategy', () => {
    expect(applyNaming('UserProfile', undefined)).toBe('UserProfile');
  });
});
