import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../../src/exports/contract-builder';
import { shoutPack } from '../fixtures/shout-extension';

describe('mongo defineContract extensions', () => {
  it('records the extension packs it is given (definition form)', () => {
    const result = defineContract({
      extensions: { shout: shoutPack },
      models: {
        Greeting: model('Greeting', {
          fields: { _id: field.objectId(), text: field.scalar('shout/text@1') },
        }),
      },
    });
    expect(result.extensions).toEqual({ shout: shoutPack });
  });

  it('records the extension packs it is given (factory form)', () => {
    const result = defineContract(
      { extensions: { shout: shoutPack } },
      ({ model: m, field: f }) => ({
        models: {
          Greeting: m('Greeting', {
            fields: { _id: f.objectId(), text: f.scalar('shout/text@1') },
          }),
        },
      }),
    );
    expect(result.extensions).toEqual({ shout: shoutPack });
  });
});
