import { describe, expect, it } from 'vitest';
import { defaultMongoIndexName } from '../src/default-index-name';

describe('defaultMongoIndexName', () => {
  it('joins each key field and direction with underscores, as MongoDB names an unnamed index', () => {
    expect({
      single: defaultMongoIndexName([{ field: 'email', direction: 1 }]),
      compound: defaultMongoIndexName([
        { field: 'lastName', direction: 1 },
        { field: 'createdAt', direction: -1 },
      ]),
      text: defaultMongoIndexName([{ field: 'title', direction: 'text' }]),
    }).toEqual({ single: 'email_1', compound: 'lastName_1_createdAt_-1', text: 'title_text' });
  });
});
