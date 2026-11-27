import {
  defineContract,
  field,
  gen,
  model,
  postgres18,
  postgresDriver,
  type,
} from '@internal/postgres/contract-builder';

export const contract = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
  models: {
    User: model('User', {
      fields: {
        id: field.column(type.Char(26)).onCreate(gen.ulid()).id(),
      },
    }).sql({ table: 'user' }),
  },
});
