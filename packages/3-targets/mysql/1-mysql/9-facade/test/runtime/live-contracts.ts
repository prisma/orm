import { defineContract, rel } from '../../src/exports/contract-builder';

export const countersContract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Counter: model('Counter', {
      fields: { id: field.column(type.Int()).id(), big: field.column(type.BigInt()) },
    }),
  },
}));

export const eventsContract = defineContract({}, ({ field, model, type }) => {
  const Account = model('Account', {
    fields: { id: field.column(type.Int()).id(), name: field.column(type.String()) },
  });
  const Event = model('Event', {
    fields: {
      id: field.column(type.BigInt()).id(),
      at: field.column(type.DateTime()),
      accountId: field.column(type.Int()),
    },
  });
  return {
    models: {
      Account: Account.relations({ events: rel.hasMany(Event, { by: 'accountId' }) }),
      Event: Event.relations({
        account: rel.belongsTo(Account, { from: 'accountId', to: 'id' }),
      }),
    },
  };
});

export const notesContract = defineContract({}, ({ field, model, type }) => {
  const Author = model('Author', { fields: { id: field.column(type.Int()).id() } });
  const Note = model('Note', {
    fields: {
      id: field.column(type.Int()).id(),
      body: field.column(type.String()),
      summary: field.column(type.String()).optional(),
      authorId: field.column(type.Int()),
    },
  });
  return {
    models: {
      Author: Author.relations({ notes: rel.hasMany(Note, { by: 'authorId' }) }),
      Note: Note.relations({ author: rel.belongsTo(Author, { from: 'authorId', to: 'id' }) }),
    },
  };
});

export const ticksContract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Tick: model('Tick', {
      fields: { at: field.column(type.DateTime()).id(), label: field.column(type.String()) },
    }),
  },
}));
