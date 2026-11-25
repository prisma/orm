import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  contract,
  plan,
  planned,
  refusal,
  renameField,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

const ADMIN = { collection: 'users', fields: ['_id', 'admin'] };
const INT = { codecId: 'mongo/int32@1' };
const STR = { codecId: 'mongo/string@1' };

function moveCount(text: string): number {
  return text.split('rawAggregate(').length - 1;
}

describe('MongoMigrationPlanner, the move route reads the plan the route tells the user to make', () => {
  it('gives no move when a cast in the target refuses the plan without the statement', () => {
    const guest = (codec: typeof INT) => ({
      collection: 'members',
      fields: ['_id', 'guest', 'age'],
      types: { age: codec },
    });
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'age'], types: { age: INT } },
        Guest: guest(STR),
      },
      { users: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'age'], types: { age: INT } },
        Guest: guest(INT),
      },
      { users: {}, members: {} },
    );
    const schema = [schemaCollection('users'), schemaCollection('members')];
    const [conflict] = refusal(
      plan({ from, to, schema, statements: [renameModel('User', 'Member')] }),
    );
    expect({
      fallback: conflict?.why?.includes(
        'Planned without it, the change is refused for another reason as well:',
      ),
      moves: moveCount(conflict?.why ?? ''),
      without: refusal(plan({ from, to, schema })).map(({ summary }) => summary),
    }).toEqual({
      fallback: true,
      moves: 0,
      without: [
        'Cannot cast field "age" of model "Guest" in collection "members": model "Member" stores it in the same collection',
      ],
    });
  });

  describe('stated renames out of one collection into two collections', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        A: { collection: 'users', fields: ['_id', 'a'] },
        B: { collection: 'users', fields: ['_id', 'b'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Visitor: { collection: 'guests', fields: ['_id', 'visitor'] },
      },
      { users: {}, members: {}, guests: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        A2: { collection: 'members', fields: ['_id', 'a'] },
        B2: { collection: 'guests', fields: ['_id', 'b'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Visitor: { collection: 'guests', fields: ['_id', 'visitor'] },
      },
      { users: {}, members: {}, guests: {} },
    );
    const schema = [
      schemaCollection('users'),
      schemaCollection('members'),
      schemaCollection('guests'),
    ];
    const statements = [renameModel('A', 'A2'), renameModel('B', 'B2')];

    it('leaves out both statements, and gives one route with a move for each collection', () => {
      const [first] = refusal(plan({ from, to, schema, statements }));
      const why = first?.why ?? '';
      expect({
        leaveOut: why.includes(
          'Leave out --rename A:A2 and --rename B:B2 to plan the change without moving them. Models "A" and "B" are then removed and nothing is asked, since nothing is deleted. Their documents stay in collection "users", where model "Admin" still reads them. Model "A2" reads the documents of model "Guest" already stored in its collection, since no discriminator tells them apart. Model "B2" reads the documents of model "Visitor" already stored in its collection, since no discriminator tells them apart.',
        ),
        moves: [
          why.includes('{ $merge: { into: "members" } }'),
          why.includes('{ $merge: { into: "guests" } }'),
        ],
        followed: planned(plan({ from, to, schema })).labels,
      }).toEqual({ leaveOut: true, moves: [true, true], followed: [] });
    });

    it('prints the route once, and the other refusal names the statement it is under', () => {
      const conflicts = refusal(plan({ from, to, schema, statements }));
      expect({
        moves: conflicts.map(({ why }) => moveCount(why ?? '')),
        pointer: conflicts[1]?.why?.endsWith(
          'Leave out --rename A:A2 and --rename B:B2 to plan the change without moving them: the refusal of --rename A:A2 says what that plan does, and how to keep the documents.',
        ),
      }).toEqual({ moves: [2, 0], pointer: true });
    });
  });

  describe('a field statement beside a model rename statement the shared collection refuses', () => {
    function withoutAll(
      result: ReturnType<typeof plan>,
      input: Parameters<typeof plan>[0],
      leftOut: readonly ResolvedMigrationStatement[],
    ) {
      const followed = plan({
        ...input,
        statements: (input.statements ?? []).filter((each) => !leftOut.includes(each)),
      });
      return {
        whys: refusal(result).map(({ why }) => why ?? ''),
        followedRefusals:
          followed.kind === 'failure' ? followed.conflicts.map((c) => c.summary) : [],
      };
    }

    it('names both statements on the merged route, and the field statement points at it', () => {
      const user = renameModel('User', 'Member');
      const name = renameField('User', 'name', 'Member', 'fullName');
      const input = {
        from: contract(
          'from',
          {
            User: { collection: 'users', fields: ['_id', 'user', 'name'] },
            Guest: { collection: 'members', fields: ['_id', 'guest'] },
          },
          { users: {}, members: {} },
        ),
        to: contract(
          'to',
          {
            Member: { collection: 'members', fields: ['_id', 'user', 'fullName'] },
            Guest: { collection: 'members', fields: ['_id', 'guest'] },
          },
          { members: {} },
        ),
        schema: [schemaCollection('users'), schemaCollection('members')],
        statements: [user, name],
      };
      const { whys, followedRefusals } = withoutAll(plan(input), input, [user, name]);
      expect({
        model: whys[0]?.includes(
          'Leave out --rename User:Member and --rename Member.name:Member.fullName to plan the change without moving them. The plan then asks about the data of model "User", which it drops.',
        ),
        field: whys[1],
        followedRefusals,
      }).toEqual({
        model: true,
        field:
          'The documents of model "User", which hold field "User.name", stay in collection "users": the plan does not rename that collection, since --rename User:Member is refused. That refusal names the statements to leave out, this one among them, and how to keep the documents.',
        followedRefusals: [],
      });
    });

    it('names both statements on the route of a variant that leaves its base collection', () => {
      const task = { collection: 'tasks', fields: ['_id', 'type'], discriminator: 'type' };
      const bug = renameModel('Bug', 'Defect');
      const sev = renameField('Bug', 'sev', 'Defect', 'severity');
      const input = {
        from: contract(
          'from',
          {
            Task: { ...task, variants: { Bug: 'bug', Feat: 'feat' } },
            Bug: { fields: ['sev'], base: 'Task' },
            Feat: { fields: ['area'], base: 'Task' },
          },
          { tasks: {} },
        ),
        to: contract(
          'to',
          {
            Task: { ...task, variants: { Feat: 'feat' } },
            Feat: { fields: ['area'], base: 'Task' },
            Defect: { collection: 'defects', fields: ['_id', 'severity'] },
          },
          { tasks: {}, defects: {} },
        ),
        schema: [schemaCollection('tasks')],
        statements: [bug, sev],
      };
      const { whys, followedRefusals } = withoutAll(plan(input), input, [bug, sev]);
      expect({
        model: whys[0]?.includes(
          'Leave out --rename Bug:Defect and --rename Defect.sev:Defect.severity to plan the change without moving them',
        ),
        field: whys[1]?.includes('since --rename Bug:Defect is refused'),
        asksAgain: whys.some((why) => why.includes('Add --rename')),
        followedRefusals,
      }).toEqual({ model: true, field: true, asksAgain: false, followedRefusals: [] });
    });

    it('does not ask for the model rename statement already given, on the route that leaves models behind', () => {
      const a = renameModel('A', 'A2');
      const b = renameModel('B', 'B2');
      const field = renameField('A', 'a', 'A2', 'a2');
      const input = {
        from: contract(
          'from',
          {
            Admin: ADMIN,
            A: { collection: 'users', fields: ['_id', 'a'] },
            B: { collection: 'users', fields: ['_id', 'b'] },
            Guest: { collection: 'members', fields: ['_id', 'guest'] },
          },
          { users: {}, members: {} },
        ),
        to: contract(
          'to',
          {
            Admin: ADMIN,
            A2: { collection: 'members', fields: ['_id', 'a2'] },
            B2: { collection: 'members', fields: ['_id', 'b'] },
            Guest: { collection: 'members', fields: ['_id', 'guest'] },
          },
          { users: {}, members: {} },
        ),
        schema: [schemaCollection('users'), schemaCollection('members')],
        statements: [a, b, field],
      };
      const { whys, followedRefusals } = withoutAll(plan(input), input, [a, b, field]);
      expect({
        field: whys[2],
        followedRefusals,
      }).toEqual({
        field:
          'The documents of model "A", which hold field "A.a", stay in collection "users": the plan does not rename that collection, since --rename A:A2 is refused. That refusal names the statements to leave out, this one among them, and how to keep the documents.',
        followedRefusals: [],
      });
    });
  });

  it('prints copy calls that evaluate, pasted, to the pipeline the route describes', () => {
    const person = {
      collection: 'people',
      fields: ['_id', 'kind'],
      discriminator: 'kind',
      storedAs: { kind: 'k-ind' },
    };
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'user', 'name', 'extra'] },
        Person: { ...person, variants: { Staff: 'staff' } },
        Staff: { fields: ['sev'], base: 'Person' },
      },
      { users: {}, people: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Person: { ...person, variants: { Staff: 'staff', Member: 'mem"ber' } },
        Staff: { fields: ['sev'], base: 'Person' },
        Member: { fields: ['user', 'name'], base: 'Person', storedAs: { name: 'full name' } },
      },
      { users: {}, people: {} },
    );
    const [conflict] = refusal(
      plan({
        from,
        to,
        schema: [schemaCollection('users'), schemaCollection('people')],
        statements: [renameModel('User', 'Member')],
      }),
    );
    const call = /rawAggregate\([\s\S]*?\n {2}\]\)/.exec(conflict?.why ?? '')?.[0] ?? '';
    const pasted = call.replace(/<a filter[^>]*>/, '{}');
    const captured: unknown[] = [];
    new Function('rawAggregate', `return ${pasted};`)((...args: unknown[]) => captured.push(args));
    expect(captured).toEqual([
      [
        'users',
        [
          { $match: {} },
          { $set: { 'full name': '$name', 'k-ind': { $literal: 'mem"ber' } } },
          { $unset: ['name', 'extra'] },
          { $merge: { into: 'people' } },
        ],
      ],
    ]);
  });
});

describe('MongoMigrationPlanner, one route for every statement the shared-collection rule refuses', () => {
  describe('two models leave two collections for one', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'user'] },
        Staff: { collection: 'staff', fields: ['_id', 'staff'] },
        Clerk: { collection: 'staff', fields: ['_id', 'clerk'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, staff: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Staff: { collection: 'staff', fields: ['_id', 'staff'] },
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Teller: { collection: 'members', fields: ['_id', 'clerk'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, staff: {}, members: {} },
    );
    const schema = [
      schemaCollection('users'),
      schemaCollection('staff'),
      schemaCollection('members'),
    ];
    const statements = [renameModel('User', 'Member'), renameModel('Clerk', 'Teller')];

    it('prints one route with both moves, and the plan it describes is made', () => {
      const conflicts = refusal(plan({ from, to, schema, statements }));
      const why = conflicts[0]?.why ?? '';
      expect({
        moves: conflicts.map((conflict) => moveCount(conflict.why ?? '')),
        leaveOut: why.startsWith(
          'A collection rename moves every document of the collection, and the documents of model "Admin" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.\n\nLeave out --rename User:Member and --rename Clerk:Teller to plan the change without moving them.',
        ),
        sources: [why.includes('rawAggregate("users", ['), why.includes('rawAggregate("staff", [')],
        pointer: conflicts[1]?.why?.endsWith(
          'Leave out --rename User:Member and --rename Clerk:Teller to plan the change without moving them: the refusal of --rename User:Member says what that plan does, and how to keep the documents.',
        ),
        followed: plan({ from, to, schema }).kind,
      }).toEqual({
        moves: [2, 0],
        leaveOut: true,
        sources: [true, true],
        pointer: true,
        followed: 'success',
      });
    });

    it('says the two moves go into one migration.ts and one apply', () => {
      const [first] = refusal(plan({ from, to, schema, statements }));
      expect(first?.why).toContain(
        'Both dataTransforms go in that one migration.ts. Run it to emit its ops.json, and apply it once with db migrate.',
      );
    });
  });

  it('plans 8 refused statements in well under a second', () => {
    const groups = Array.from({ length: 8 }, (_, index) => index);
    const models = (side: 'from' | 'to') =>
      Object.fromEntries(
        groups.flatMap((index) => [
          [`Stay${index}`, { collection: `shared${index}`, fields: ['_id', `stay${index}`] }],
          side === 'from'
            ? [`Go${index}`, { collection: `shared${index}`, fields: ['_id', `go${index}`] }]
            : [`Gone${index}`, { collection: `moved${index}`, fields: ['_id', `go${index}`] }],
        ]),
      );
    const collections = (side: 'from' | 'to') =>
      Object.fromEntries(
        groups.flatMap((index) => [
          [`shared${index}`, {}],
          ...(side === 'to' ? [[`moved${index}`, {}]] : []),
        ]),
      );
    const from = contract('from', models('from'), collections('from'));
    const to = contract('to', models('to'), collections('to'));
    const schema = groups.map((index) => schemaCollection(`shared${index}`));
    const statements = groups.map((index) => renameModel(`Go${index}`, `Gone${index}`));
    const started = performance.now();
    const conflicts = refusal(plan({ from, to, schema, statements }));
    const elapsed = performance.now() - started;
    expect({
      fast: elapsed < 1000,
      moves: conflicts.map(({ why }) => moveCount(why ?? '')),
    }).toEqual({ fast: true, moves: [8, 0, 0, 0, 0, 0, 0, 0] });
  });

  describe('every model leaves the source collection', () => {
    const from = contract(
      'from',
      {
        A: { collection: 'users', fields: ['_id', 'a'] },
        B: { collection: 'users', fields: ['_id', 'b'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Visitor: { collection: 'guests', fields: ['_id', 'visitor'] },
      },
      { users: {}, members: {}, guests: {} },
    );
    const to = contract(
      'to',
      {
        A2: { collection: 'members', fields: ['_id', 'a'] },
        B2: { collection: 'guests', fields: ['_id', 'b'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Visitor: { collection: 'guests', fields: ['_id', 'visitor'] },
      },
      { members: {}, guests: {} },
    );
    const schema = [
      schemaCollection('users'),
      schemaCollection('members'),
      schemaCollection('guests'),
    ];

    it('says to answer the drop question with --delete, since the copies run before the drop', () => {
      const [first] = refusal(
        plan({ from, to, schema, statements: [renameModel('A', 'A2'), renameModel('B', 'B2')] }),
      );
      const why = first?.why ?? '';
      const followed = planned(plan({ from, to, schema }));
      expect({
        answer: why.includes(
          'Plan the change without --rename A:A2 and --rename B:B2, and answer its question about models "A" and "B" with the --delete it offers: the copies below run before the plan drops collection "users", so they keep the documents, and the drop removes only the emptied collection.',
        ),
        contradiction: why.includes('that plans the change and deletes the data'),
        moves: moveCount(why),
        followedDrops: followed.labels.filter((label) => label.startsWith('Drop collection')),
      }).toEqual({
        answer: true,
        contradiction: false,
        moves: 2,
        followedDrops: ['Drop collection users'],
      });
    });
  });

  it('prints each copy call on lines of its own, with each stage on one line', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'user', 'firstName', 'lastName'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: {
          collection: 'members',
          fields: ['_id', 'user', 'firstName', 'lastName'],
          storedAs: { firstName: 'given_name_of_member', lastName: 'family_name_of_member' },
        },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: {} },
    );
    const [conflict] = refusal(
      plan({
        from,
        to,
        schema: [schemaCollection('users'), schemaCollection('members')],
        statements: [renameModel('User', 'Member')],
      }),
    );
    const why = conflict?.why ?? '';
    const call = /\n {2}rawAggregate\([\s\S]*?\n {2}\]\)/.exec(why)?.[0].trim() ?? '';
    const captured: unknown[] = [];
    new Function('rawAggregate', `return ${call.replace(/<a filter[^>]*>/, '{}')};`)(
      (...args: unknown[]) => captured.push(args),
    );
    expect({
      lines: call.split('\n'),
      captured,
    }).toEqual({
      lines: [
        'rawAggregate("users", [',
        '    { $match: <a filter that selects only those documents> },',
        '    { $set: { given_name_of_member: "$firstName", family_name_of_member: "$lastName" } },',
        '    { $unset: ["firstName", "lastName"] },',
        '    { $merge: { into: "members" } },',
        '  ])',
      ],
      captured: [
        [
          'users',
          [
            { $match: {} },
            {
              $set: { given_name_of_member: '$firstName', family_name_of_member: '$lastName' },
            },
            { $unset: ['firstName', 'lastName'] },
            { $merge: { into: 'members' } },
          ],
        ],
      ],
    });
  });

  it('says that the copy drops the values of a field the destination model does not store', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'user', 'email'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: {} },
    );
    const [conflict] = refusal(
      plan({
        from,
        to,
        schema: [schemaCollection('users'), schemaCollection('members')],
        statements: [renameModel('User', 'Member')],
      }),
    );
    expect(conflict?.why).toContain(
      'Its $unset stage deletes field "email" and its values from the moved documents, since the model they become does not store it.',
    );
  });

  it('lists the refusal of the plan without the statements after its own, with what to change first', () => {
    const guest = (codec: typeof INT) => ({
      collection: 'members',
      fields: ['_id', 'guest', 'age'],
      types: { age: codec },
    });
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'age'], types: { age: INT } },
        Guest: guest(STR),
      },
      { users: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'age'], types: { age: INT } },
        Guest: guest(INT),
      },
      { users: {}, members: {} },
    );
    const conflicts = refusal(
      plan({
        from,
        to,
        schema: [schemaCollection('users'), schemaCollection('members')],
        statements: [renameModel('User', 'Member')],
      }),
    );
    expect({
      summaries: conflicts.map(({ summary }) => summary),
      end: conflicts[0]?.why?.endsWith(
        'Planned without it, the change is refused for another reason as well: "Cannot cast field "age" of model "Guest" in collection "members": model "Member" stores it in the same collection". That refusal is listed here too, with what to change first.',
      ),
    }).toEqual({
      summaries: [
        'Cannot rename model "User" to "Member": collection "users" also stores model "Admin"',
        'Cannot cast field "age" of model "Guest" in collection "members": model "Member" stores it in the same collection',
      ],
      end: true,
    });
  });

  describe('a field statement', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        A: { collection: 'users', fields: ['_id', 'a'] },
        B: { collection: 'users', fields: ['_id', 'b'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        A2: { collection: 'members', fields: ['_id', 'a2'] },
        B2: { collection: 'members', fields: ['_id', 'b'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: {} },
    );
    const schema = [schemaCollection('users'), schemaCollection('members')];
    const field = renameField('A', 'a', 'A2', 'a2');

    it('is named as the CLI takes it, and points at the refusal that prints the route', () => {
      const conflicts = refusal(
        plan({
          from,
          to,
          schema,
          statements: [renameModel('B', 'B2'), renameModel('A', 'A2'), field],
        }),
      );
      expect({
        named: conflicts[0]?.why?.includes(
          'Leave out --rename B:B2, --rename A:A2 and --rename A2.a:A2.a2 to plan the change without moving them.',
        ),
        field: conflicts[2]?.why,
      }).toEqual({
        named: true,
        field:
          'The documents of model "A", which hold field "A.a", stay in collection "users": the plan does not rename that collection, since --rename A:A2 is refused. The refusal of --rename B:B2 names the statements to leave out, this one among them, and how to keep the documents.',
      });
    });

    it('given without its model statement, does not ask for the model statement the rule refuses', () => {
      const [conflict] = refusal(plan({ from, to, schema, statements: [field] }));
      const fieldWhy = conflict?.why ?? '';
      expect({
        asksAgain: fieldWhy.includes('Add --rename A:A2'),
        says: fieldWhy.includes(
          '--rename A:A2 would be refused as well: collection "users" also stores model "Admin". Leave out this statement too.',
        ),
      }).toEqual({ asksAgain: false, says: true });
    });
  });
});
