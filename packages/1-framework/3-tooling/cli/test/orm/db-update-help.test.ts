import { describe, expect, it } from 'vitest';
import { createDbUpdateCommand } from '../../src/orm/db/update';

describe('db update help', () => {
  it('describes the access question in words every database family shares', () => {
    const command = createDbUpdateCommand(() => {
      throw new Error('the help needs no client');
    });

    const description = command.help.description?.replaceAll('\n', ' ');

    expect(description).toContain(
      "Before it changes who can read or write a model's data, it asks for --allow.",
    );
    expect(description).not.toContain('rows');
  });
});
