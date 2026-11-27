import {
  defineContract,
  field,
  model,
  postgres18,
  postgresDriver,
  rel,
} from '@internal/postgres/contract-builder';
import {
  pgBitColumn,
  pgCharColumn,
  pgInetColumn,
  pgInt4Column,
  pgTextColumn,
  pgUuidColumn,
  pgVarbitColumn,
  pgVarcharColumn,
} from '@internal/target-postgres/codecs';

const ChildBase = model('Child', {
  fields: {
    id: field.column(pgInt4Column()).id(),
    char: field.column(pgCharColumn({ length: 10 })),
    vChar: field.column(pgVarcharColumn({ length: 11 })),
    text: field.column(pgTextColumn()),
    bit: field.column(pgBitColumn({ length: 4 })),
    vBit: field.column(pgVarbitColumn({ length: 5 })),
    uuid: field.column(pgUuidColumn()),
    ip: field.column(pgInetColumn()),
  },
});

const Parent = model('Parent', {
  fields: {
    id: field.column(pgInt4Column()).id(),
    childId: field.column(pgInt4Column()).optional(),
  },
  relations: {
    child: rel.belongsTo(ChildBase, { from: 'childId', to: 'id' }).sql({ fk: {} }),
  },
}).attributes(({ fields, constraints }) => ({
  uniques: [constraints.unique([fields.childId])],
}));

const Child = ChildBase.relations({
  parent: rel.hasOne(Parent, { by: 'childId' }),
});

export const contract = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
  models: {
    Parent,
    Child,
  },
});
