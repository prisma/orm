import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatSlackMessage,
  isOutsideAuthor,
  itemsCreatedInWindow,
  windowStart,
} from './notify-external-contributions.mjs';

const issue = (overrides = {}) => ({
  number: 101,
  title: 'findMany drops rows',
  html_url: 'https://github.com/prisma/orm/issues/101',
  created_at: '2026-11-25T10:05:00Z',
  author_association: 'NONE',
  user: { login: 'someone', html_url: 'https://github.com/someone', type: 'User' },
  ...overrides,
});

describe('isOutsideAuthor', () => {
  it('counts an author with no association and no write access as outside', () => {
    assert.equal(isOutsideAuthor(issue(), 'read'), true);
  });

  it('counts an org member as inside', () => {
    assert.equal(isOutsideAuthor(issue({ author_association: 'MEMBER' }), 'read'), false);
  });

  it('counts an author with write access as inside even when the association hides it', () => {
    assert.equal(isOutsideAuthor(issue({ author_association: 'CONTRIBUTOR' }), 'write'), false);
    assert.equal(isOutsideAuthor(issue({ author_association: 'CONTRIBUTOR' }), 'maintain'), false);
    assert.equal(isOutsideAuthor(issue({ author_association: 'CONTRIBUTOR' }), 'admin'), false);
  });

  it('counts a bot as inside', () => {
    const bot = issue({ user: { login: 'dependabot[bot]', html_url: '', type: 'Bot' } });
    assert.equal(isOutsideAuthor(bot, 'none'), false);
  });
});

describe('windowStart', () => {
  const until = new Date('2026-11-25T12:00:00Z');

  it('starts where the last successful run started', () => {
    assert.deepEqual(
      windowStart(new Date('2026-11-25T11:50:00Z'), until),
      new Date('2026-11-25T11:50:00Z'),
    );
  });

  it('looks back fifteen minutes when no run has succeeded yet', () => {
    assert.deepEqual(windowStart(undefined, until), new Date('2026-11-25T11:45:00Z'));
  });

  it('looks back at most a day after a long outage', () => {
    assert.deepEqual(
      windowStart(new Date('2026-11-20T12:00:00Z'), until),
      new Date('2026-11-24T12:00:00Z'),
    );
  });
});

describe('itemsCreatedInWindow', () => {
  const since = new Date('2026-11-25T10:00:00Z');
  const until = new Date('2026-11-25T10:10:00Z');

  it('keeps items from the start of the window up to but not including its end, oldest first', () => {
    const page = [
      issue({ number: 4, created_at: '2026-11-25T10:10:00Z' }),
      issue({ number: 3, created_at: '2026-11-25T10:09:59Z' }),
      issue({ number: 2, created_at: '2026-11-25T10:00:00Z' }),
      issue({ number: 1, created_at: '2026-11-25T09:59:59Z' }),
    ];
    const { items, reachedStart } = itemsCreatedInWindow(page, since, until);
    assert.deepEqual(
      items.map((item) => item.number),
      [2, 3],
    );
    assert.equal(reachedStart, true);
  });

  it('reports that the window start was not reached when every item is newer', () => {
    const page = [issue({ created_at: '2026-11-25T10:05:00Z' })];
    assert.equal(itemsCreatedInWindow(page, since, until).reachedStart, false);
  });
});

describe('formatSlackMessage', () => {
  it('describes an issue with its author and link', () => {
    assert.equal(
      formatSlackMessage(issue(), undefined),
      'New issue from <https://github.com/someone|someone>\n<https://github.com/prisma/orm/issues/101|#101 findMany drops rows>',
    );
  });

  it('names the base branch of a pull request and a first-time contributor', () => {
    const pull = issue({
      number: 202,
      title: 'fix: money',
      html_url: 'https://github.com/prisma/orm/pull/202',
      author_association: 'FIRST_TIME_CONTRIBUTOR',
      pull_request: {},
    });
    assert.equal(
      formatSlackMessage(pull, 'v7'),
      'New pull request into `v7` from <https://github.com/someone|someone> (first contribution to this repository)\n<https://github.com/prisma/orm/pull/202|#202 fix: money>',
    );
  });

  it('escapes Slack control characters in the title', () => {
    const message = formatSlackMessage(issue({ title: 'a < b & c > d' }), undefined);
    assert.match(message, /\|#101 a &lt; b &amp; c &gt; d>$/);
  });
});
