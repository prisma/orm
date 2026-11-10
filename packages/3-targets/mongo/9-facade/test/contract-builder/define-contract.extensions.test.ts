import { describe, expect, it } from 'vitest';
import { defineContract, field, model, type } from '../../src/exports/contract-builder';
import { shoutPack } from '../fixtures/shout-extension';

describe('mongo defineContract extensions', () => {
  it('records the extension packs it is given (definition form)', () => {
    const result = defineContract({
      extensions: { shout: shoutPack },
      models: {
        Greeting: model('Greeting', {
          fields: { _id: field.scalar(type.ObjectId()), text: field.scalar(type.String()) },
        }),
      },
    });
    expect(result.extensions).toEqual({ shout: shoutPack });
  });

  it('records the extension packs it is given (factory form)', () => {
    const result = defineContract(
      { extensions: { shout: shoutPack } },
      ({ model: m, field: f, type: t }) => ({
        models: {
          Greeting: m('Greeting', {
            fields: { _id: f.scalar(t.ObjectId()), text: f.scalar(t.shout.Text()) },
          }),
        },
      }),
    );
    expect(result.extensions).toEqual({ shout: shoutPack });
  });
});
