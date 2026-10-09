import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

function formatsTo(source: string, expected: string): void {
  const formatted = format(source);
  expect(formatted).toBe(expected);
  expect(format(formatted)).toBe(expected);
}

describe('format given a mixin declaration', () => {
  it('prints a model mixin header and aligns its fields like a model body', () => {
    formatsTo(
      'model   mixin Timestamps{\ncreatedAt DateTime @default(now())\nid Int @id\n@@index([createdAt])\n}\n',
      [
        'model mixin Timestamps {',
        '  createdAt DateTime @default(now())',
        '  id        Int      @id',
        '',
        '  @@index([createdAt])',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('prints a type mixin like a composite type body', () => {
    formatsTo(
      'type mixin Geo {\nlat Float\nlongitude   Float\n}\n',
      'type mixin Geo {\n  lat       Float\n  longitude Float\n}\n',
    );
  });

  it('prints an enum mixin like an enum body', () => {
    formatsTo(
      'enum  mixin  BaseRoles { ADMIN   @map("admin")\nUSER }\n',
      'enum mixin BaseRoles {\n  ADMIN @map("admin")\n  USER\n}\n',
    );
  });

  it('prints a key = value mixin like a block of that keyword', () => {
    formatsTo(
      'policy_select mixin OwnerRead {\nroles   =   [authenticated]\n@@map("owner")\n}\n',
      'policy_select mixin OwnerRead {\n  roles = [authenticated]\n\n  @@map("owner")\n}\n',
    );
  });

  it('indents a mixin inside a namespace and separates it from its neighbours', () => {
    formatsTo(
      'namespace auth {\nmodel mixin Timestamps {\ncreatedAt DateTime\n}\nmodel User {\nid Int\n}\n}\n',
      [
        'namespace auth {',
        '  model mixin Timestamps {',
        '    createdAt DateTime',
        '  }',
        '',
        '  model User {',
        '    id Int',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('keeps comments around and inside a mixin', () => {
    formatsTo(
      '/// Shared times.\nmodel mixin Timestamps { // header\n  // body\n  createdAt DateTime // trailing\n} // closing\n',
      '/// Shared times.\nmodel mixin Timestamps { // header\n  // body\n  createdAt DateTime // trailing\n} // closing\n',
    );
  });
});

describe('format given a number written with a plus sign', () => {
  it('prints the number as written', () => {
    formatsTo(
      'model N {\n  count Int   @default( +1 )\n  ratio Float @default(+1.5)\n}\npolicy P {\n  limit = +10\n}\n',
      'model N {\n  count Int   @default(+1)\n  ratio Float @default(+1.5)\n}\n\npolicy P {\n  limit = +10\n}\n',
    );
  });
});

describe('format given a mixin inclusion', () => {
  it('prints it on its own line between aligned fields without changing their columns', () => {
    formatsTo(
      'model User {\nid Int @id\n    +  auth.Timestamps\nname   String\n}\n',
      'model User {\n  id   Int    @id\n  +auth.Timestamps\n  name String\n}\n',
    );
  });

  it('aligns the fields around an inclusion as it aligns them without it', () => {
    const fields = ['identifier Int @id', 'n String @unique'];
    const without = format(`model User {\n${fields.join('\n')}\n}\n`).split('\n');
    const withInclusion = format(`model User {\n${fields.join('\n+Timestamps\n')}\n}\n`).split(
      '\n',
    );

    expect(withInclusion).toEqual([without[0], without[1], '  +Timestamps', ...without.slice(2)]);
  });

  it('prints it in a composite type, an enum and a key = value block', () => {
    formatsTo(
      'type Address {\n+ Geo\nstreet String\n}\nenum Role {\n+   auth.BaseRoles\nGUEST\n}\npolicy P {\n+Shared\nk = 1\n}\n',
      [
        'type Address {',
        '  +Geo',
        '  street String',
        '}',
        '',
        'enum Role {',
        '  +auth.BaseRoles',
        '  GUEST',
        '}',
        '',
        'policy P {',
        '  +Shared',
        '  k = 1',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('prints it inside a mixin body', () => {
    formatsTo(
      'model mixin Audited {\n+  Timestamps\nactor String\n}\n',
      'model mixin Audited {\n  +Timestamps\n  actor String\n}\n',
    );
  });

  it('keeps a blank line and a trailing comment around it', () => {
    formatsTo(
      'model User {\n  id Int\n\n  +Timestamps // times\n  @@map("users")\n}\n',
      'model User {\n  id Int\n\n  +Timestamps // times\n\n  @@map("users")\n}\n',
    );
  });
});
