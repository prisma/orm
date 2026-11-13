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

const Order = model('Order', { fields: { id: field.column(int4Column).id() } });

const Shipment = model('Shipment', {
  fields: {
    id: field.column(int4Column).id(),
    orderId: field.column(int4Column).optional().unique(),
  },
  relations: {
    order: rel
      .belongsTo(Order, { from: 'orderId', to: 'id' })
      .sql({ fk: { onDelete: 'setNull', onUpdate: 'restrict' } }),
  },
});

const Label = model('Label', {
  fields: { id: field.column(int4Column).id(), shipmentOrderId: field.column(int4Column) },
  relations: {
    shipment: rel
      .belongsTo(Shipment, { from: 'shipmentOrderId', to: 'orderId' })
      .sql({ fk: { onDelete: 'restrict', onUpdate: 'cascade' } }),
  },
});

const Root = model('Root', { fields: { id: field.column(int4Column).id() } });

const Mid = model('Mid', {
  fields: { id: field.column(int4Column).id(), rootId: field.column(int4Column) },
  relations: {
    root: rel
      .belongsTo(Root, { from: 'rootId', to: 'id' })
      .sql({ fk: { onDelete: 'cascade', onUpdate: 'restrict' } }),
  },
});

const Leaf = model('Leaf', {
  fields: {
    id: field.column(int4Column).id(),
    rootId: field.column(int4Column).optional(),
    midId: field.column(int4Column),
  },
  relations: {
    root: rel
      .belongsTo(Root, { from: 'rootId', to: 'id' })
      .sql({ fk: { onDelete: 'setNull', onUpdate: 'restrict' } }),
    mid: rel
      .belongsTo(Mid, { from: 'midId', to: 'id' })
      .sql({ fk: { onDelete: 'cascade', onUpdate: 'restrict' } }),
  },
});

const DeletedWithLeaf = model('DeletedWithLeaf', {
  fields: { id: field.column(int4Column).id(), leafId: field.column(int4Column) },
  relations: {
    leaf: rel
      .belongsTo(Leaf, { from: 'leafId', to: 'id' })
      .sql({ fk: { onDelete: 'cascade', onUpdate: 'restrict' } }),
  },
});

const UpdatedWithLeaf = model('UpdatedWithLeaf', {
  fields: { id: field.column(int4Column).id(), leafId: field.column(int4Column) },
  relations: {
    leaf: rel
      .belongsTo(Leaf, { from: 'leafId', to: 'id' })
      .sql({ fk: { onDelete: 'restrict', onUpdate: 'cascade' } }),
  },
});

export const cascadeContract = defineContract({
  models: {
    Org,
    Team,
    Member,
    Badge,
    Note,
    Left,
    Right,
    Order,
    Shipment,
    Label,
    Root,
    Mid,
    Leaf,
    DeletedWithLeaf,
    UpdatedWithLeaf,
  },
});
