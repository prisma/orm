import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { renameStatements } from '../../../src/control-api/statements/statement-text';
import { contractOf, expectFailure, expectValue } from './statement-fixtures';

const UNRESOLVED = 'MIGRATION.STATEMENT_UNRESOLVED';
const INVALID = 'MIGRATION.STATEMENT_INVALID';

function resolve(
  renames: readonly string[],
  origin: ReturnType<typeof contractOf>,
  destination: ReturnType<typeof contractOf>,
) {
  return resolveStatements({
    statements: renameStatements(renames),
    origin: { kind: 'contract', contract: origin },
    destination,
  });
}

const nameToFullName = {
  origin: contractOf({ app: { models: { User: { fields: ['id', 'name'] } } } }),
  destination: contractOf({ app: { models: { User: { fields: ['id', 'fullName'] } } } }),
};

const renamedUser = {
  kind: 'rename',
  entity: 'field',
  from: { namespaceId: 'app', model: 'User', field: 'name' },
  to: { namespaceId: 'app', model: 'User', field: 'fullName' },
};

describe('resolveStatements, field renames', () => {
  it('resolves Model.field on both sides', () => {
    const { origin, destination } = nameToFullName;
    expect(expectValue(resolve(['User.name:User.fullName'], origin, destination))).toEqual([
      renamedUser,
    ]);
  });

  it('resolves namespace.Model.field on both sides', () => {
    const { origin, destination } = nameToFullName;
    expect(expectValue(resolve(['app.User.name:app.User.fullName'], origin, destination))).toEqual([
      renamedUser,
    ]);
  });

  it('looks the old field up in the model an earlier statement renamed', () => {
    const origin = contractOf({ app: { models: { A: { fields: ['x'] } } } });
    const destination = contractOf({ app: { models: { B: { fields: ['y'] } } } });
    expect(expectValue(resolve(['A:B', 'B.x:B.y'], origin, destination))).toEqual([
      {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: 'app', model: 'A' },
        to: { namespaceId: 'app', model: 'B' },
      },
      {
        kind: 'rename',
        entity: 'field',
        from: { namespaceId: 'app', model: 'A', field: 'x' },
        to: { namespaceId: 'app', model: 'B', field: 'y' },
      },
    ]);
  });

  describe('fields cannot move between models', () => {
    it('refuses old and new sides naming the old and new names of a renamed model', () => {
      const origin = contractOf({ app: { models: { A: { fields: ['x'] } } } });
      const destination = contractOf({ app: { models: { B: { fields: ['y'] } } } });
      const failure = expectFailure(
        resolve(['A:B', 'A.x:B.y'], origin, destination),
        INVALID,
        '--rename A.x:B.y',
        '"app.A" is not a model of the destination contract',
        "Name a field's model as the destination contract names it: --rename B.x:B.y",
      );
      expect(failure.fix).toBe('Write the statement as --rename B.x:B.y.');
    });

    it('also asks for the model statement when no earlier statement renames the model', () => {
      const origin = contractOf({ app: { models: { Profile: { fields: ['name'] } } } });
      const destination = contractOf({ app: { models: { User: { fields: ['fullName'] } } } });
      const failure = expectFailure(
        resolve(['Profile.name:User.fullName'], origin, destination),
        INVALID,
        '--rename User.name:User.fullName',
        'needs its own statement, --rename Profile:User',
      );
      expect(failure.fix).toBe(
        'Write the statements as --rename Profile:User --rename User.name:User.fullName.',
      );
    });

    it('refuses a field statement that names the old model before the statement renaming it', () => {
      const origin = contractOf({ app: { models: { Profile: { fields: ['name'] } } } });
      const destination = contractOf({ app: { models: { User: { fields: ['fullName'] } } } });
      const failure = expectFailure(
        resolve(['Profile.name:User.fullName', 'Profile:User'], origin, destination),
        INVALID,
        '--rename Profile.name:User.fullName',
      );
      expect(failure.fix).toBe(
        'Write the statements as --rename Profile:User --rename User.name:User.fullName.',
      );
    });

    it('gives no corrected statement when the old model was renamed to another model', () => {
      const origin = contractOf({
        app: { models: { A: { fields: ['x'] }, C: { fields: ['z'] } } },
      });
      const destination = contractOf({ app: { models: { B: {}, C: { fields: ['y'] } } } });
      const failure = expectFailure(
        resolve(['A:B', 'A.x:C.y'], origin, destination),
        INVALID,
        'a field cannot move between models',
      );
      expect(`${failure.why} ${failure.fix}`).not.toContain('--rename');
    });

    it('gives no corrected statement when another model was renamed to the new model', () => {
      const origin = contractOf({
        app: { models: { A: { fields: ['x'] }, C: { fields: ['z'] } } },
      });
      const destination = contractOf({ app: { models: { B: { fields: ['y'] } } } });
      const failure = expectFailure(
        resolve(['C:B', 'A.x:B.y'], origin, destination),
        INVALID,
        'a field cannot move between models',
      );
      expect(`${failure.why} ${failure.fix}`).not.toContain('--rename');
    });

    it('gives no corrected statement when the new model is also in the origin', () => {
      const origin = contractOf({
        app: { models: { A: { fields: ['x'] }, C: { fields: ['z'] } } },
      });
      const destination = contractOf({ app: { models: { C: { fields: ['y'] } } } });
      const failure = expectFailure(
        resolve(['A.x:C.y'], origin, destination),
        INVALID,
        'a field cannot move between models',
      );
      expect(`${failure.why} ${failure.fix}`).not.toContain('--rename');
    });

    it('refuses old and new sides naming two models both contracts have', () => {
      const origin = contractOf({
        app: { models: { User: { fields: ['a'] }, Post: { fields: ['c'] } } },
      });
      const destination = contractOf({
        app: { models: { User: { fields: ['c'] }, Post: { fields: ['b'] } } },
      });
      expectFailure(
        resolve(['User.a:Post.b'], origin, destination),
        INVALID,
        'a field cannot move between models',
      );
    });
  });

  describe('names that do not resolve', () => {
    it('refuses an old field the origin model does not have, naming its fields', () => {
      const { origin, destination } = nameToFullName;
      expectFailure(
        resolve(['User.email:User.fullName'], origin, destination),
        UNRESOLVED,
        'origin model "app.User" has no field "email"',
        'id, name',
      );
    });

    it('refuses a new field the destination model does not have, naming its fields', () => {
      const { origin, destination } = nameToFullName;
      expectFailure(
        resolve(['User.name:User.email'], origin, destination),
        UNRESOLVED,
        'destination model "app.User" has no field "email"',
        'fullName, id',
      );
    });

    it('refuses a new field the origin model already has', () => {
      const origin = contractOf({ app: { models: { User: { fields: ['name', 'fullName'] } } } });
      const destination = contractOf({ app: { models: { User: { fields: ['fullName'] } } } });
      expectFailure(
        resolve(['User.name:User.fullName'], origin, destination),
        UNRESOLVED,
        'field "fullName" already exists on the origin model "app.User"',
      );
    });

    it('refuses an old field the destination model still has', () => {
      const origin = contractOf({ app: { models: { User: { fields: ['name'] } } } });
      const destination = contractOf({
        app: { models: { User: { fields: ['name', 'fullName'] } } },
      });
      expectFailure(
        resolve(['User.name:User.fullName'], origin, destination),
        UNRESOLVED,
        'field "name" still exists on the destination model "app.User"',
      );
    });

    it('refuses a model with no origin counterpart', () => {
      const origin = contractOf({ app: { models: {} } });
      const destination = contractOf({ app: { models: { User: { fields: ['fullName'] } } } });
      expectFailure(
        resolve(['User.name:User.fullName'], origin, destination),
        UNRESOLVED,
        'no counterpart in the origin contract',
      );
    });
  });

  describe('entity kinds', () => {
    it('resolves a relation field like any field', () => {
      const origin = contractOf({ app: { models: { User: { relations: ['posts'] } } } });
      const destination = contractOf({ app: { models: { User: { relations: ['articles'] } } } });
      expect(expectValue(resolve(['User.posts:User.articles'], origin, destination))).toEqual([
        {
          kind: 'rename',
          entity: 'field',
          from: { namespaceId: 'app', model: 'User', field: 'posts' },
          to: { namespaceId: 'app', model: 'User', field: 'articles' },
        },
      ]);
    });

    it('resolves a field of a variant', () => {
      const origin = contractOf({
        app: { models: { Pet: {}, Dog: { base: 'Pet', fields: ['bark'] } } },
      });
      const destination = contractOf({
        app: { models: { Pet: {}, Dog: { base: 'Pet', fields: ['woof'] } } },
      });
      expect(expectValue(resolve(['Dog.bark:Dog.woof'], origin, destination))).toHaveLength(1);
    });

    it('refuses a field of a value object, saying value object renames are not supported', () => {
      const origin = contractOf({ app: { valueObjects: { Address: ['street'] } } });
      const destination = contractOf({ app: { valueObjects: { Address: ['road'] } } });
      expectFailure(
        resolve(['app.Address.street:app.Address.road'], origin, destination),
        UNRESOLVED,
        'value object renames are not supported in this release',
      );
    });
  });

  describe('repeated names across statements', () => {
    it('refuses renaming one field twice', () => {
      const origin = contractOf({ app: { models: { User: { fields: ['name'] } } } });
      const destination = contractOf({
        app: { models: { User: { fields: ['fullName', 'title'] } } },
      });
      expectFailure(
        resolve(['User.name:User.fullName', 'User.name:User.title'], origin, destination),
        INVALID,
        'already renames "app.User.name"',
      );
    });

    it('refuses renaming two fields to the same name', () => {
      const origin = contractOf({ app: { models: { User: { fields: ['a', 'b'] } } } });
      const destination = contractOf({ app: { models: { User: { fields: ['c'] } } } });
      const failure = expectFailure(
        resolve(['User.a:User.c', 'User.b:User.c'], origin, destination),
        INVALID,
        '--rename User.b:User.c',
        'already renames a field to "app.User.c"',
      );
      expect(failure.fix).not.toContain('namespace.Model.field');
    });
  });
});
