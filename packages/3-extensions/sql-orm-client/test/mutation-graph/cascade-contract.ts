import { int4Column } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model, rel } from '../contract-builder';

const Org = model('Org', { fields: { id: field.column(int4Column).id() } });

const Team = model('Team', {
  fields: { id: field.column(int4Column).id(), orgId: field.column(int4Column) },
  relations: {
    org: rel
      .belongsTo(Org, { from: 'orgId', to: 'id' })
      .sql({ fk: { onDelete: 'cascade', onUpdate: 'cascade' } }),
  },
});

const Member = model('Member', {
  fields: { id: field.column(int4Column).id(), teamId: field.column(int4Column) },
  relations: {
    team: rel
      .belongsTo(Team, { from: 'teamId', to: 'id' })
      .sql({ fk: { onDelete: 'cascade', onUpdate: 'restrict' } }),
  },
});

const Badge = model('Badge', {
  fields: { id: field.column(int4Column).id(), teamId: field.column(int4Column).optional() },
  relations: {
    team: rel
      .belongsTo(Team, { from: 'teamId', to: 'id' })
      .sql({ fk: { onDelete: 'setNull', onUpdate: 'setDefault' } }),
  },
});

const Note = model('Note', {
  fields: { id: field.column(int4Column).id(), memberId: field.column(int4Column) },
  relations: {
    member: rel
      .belongsTo(Member, { from: 'memberId', to: 'id' })
      .sql({ fk: { onDelete: 'restrict', onUpdate: 'noAction' } }),
  },
});

const Left = model('Left', {
  fields: { id: field.column(int4Column).id(), rightId: field.column(int4Column) },
  relations: {
    right: rel
      .belongsTo('Right', { from: 'rightId', to: 'id' })
      .sql({ fk: { onDelete: 'cascade' } }),
  },
});

const Right = model('Right', {
  fields: { id: field.column(int4Column).id(), leftId: field.column(int4Column) },
  relations: {
    left: rel.belongsTo(Left, { from: 'leftId', to: 'id' }).sql({ fk: { onDelete: 'cascade' } }),
  },
});

export const cascadeContract = defineContract({
  models: { Org, Team, Member, Badge, Note, Left, Right },
});
