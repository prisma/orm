import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectOutsideContributions,
  createGitHubClient,
  formatSlackMessage,
  isTeamAccount,
  itemsCreatedInWindow,
  lastScheduledRunStart,
  postToSlack,
  resolveWindow,
} from './notify-external-contributions.mjs';

const user = (login, type = 'User') => ({
  login,
  html_url: `https://github.com/${login}`,
  type,
});

const issue = (overrides = {}) => ({
  number: 101,
  title: 'findMany drops rows',
  html_url: 'https://github.com/prisma/orm/issues/101',
  created_at: '2026-11-25T10:05:00Z',
  author_association: 'NONE',
  user: user('someone'),
  ...overrides,
});

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('isTeamAccount', () => {
  it('counts a bot as team', () => {
    assert.equal(isTeamAccount(user('dependabot[bot]', 'Bot')), true);
  });

  it('counts a listed team agent account as team', () => {
    assert.equal(isTeamAccount(user('StevenMcClankerton')), true);
  });

  it('leaves everyone else to the permission check', () => {
    assert.equal(isTeamAccount(user('someone')), false);
  });
});

describe('resolveWindow', () => {
  const until = new Date('2026-11-25T12:00:00Z');

  it('starts where the last successful scheduled run started', () => {
    assert.deepEqual(resolveWindow(new Date('2026-11-25T11:50:00Z'), until), {
      since: new Date('2026-11-25T11:50:00Z'),
      until,
      skipped: undefined,
    });
  });

  it('looks back fifteen minutes when no scheduled run has succeeded yet', () => {
    assert.deepEqual(resolveWindow(undefined, until).since, new Date('2026-11-25T11:45:00Z'));
  });

  it('looks back at most a day after a long outage and reports the skipped time', () => {
    const lastStart = new Date('2026-11-20T12:00:00Z');
    assert.deepEqual(resolveWindow(lastStart, until), {
      since: new Date('2026-11-24T12:00:00Z'),
      until,
      skipped: { from: lastStart, to: new Date('2026-11-24T12:00:00Z') },
    });
  });
});

describe('lastScheduledRunStart', () => {
  const until = new Date('2026-11-25T12:00:00Z');

  it('picks the latest run created before this one, whatever order the API returns', () => {
    const runs = [
      { created_at: '2026-11-25T11:30:00Z' },
      { created_at: '2026-11-25T12:00:00Z' },
      { created_at: '2026-11-25T11:50:00Z' },
    ];
    assert.deepEqual(lastScheduledRunStart(runs, until), new Date('2026-11-25T11:50:00Z'));
  });

  it('finds nothing when no earlier run succeeded', () => {
    assert.equal(lastScheduledRunStart([], until), undefined);
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

  it('notes an author whose first contribution on GitHub this is', () => {
    assert.match(
      formatSlackMessage(issue({ author_association: 'FIRST_TIMER' }), undefined),
      /\(first contribution on GitHub\)\n/,
    );
  });

  it('escapes Slack control characters in the title', () => {
    const message = formatSlackMessage(issue({ title: 'a < b & c > d' }), undefined);
    assert.match(message, /\|#101 a &lt; b &amp; c &gt; d>$/);
  });
});

describe('createGitHubClient', () => {
  const clientFor = (routes) => {
    const requested = [];
    const fetch = async (url) => {
      const path = new URL(url).pathname + new URL(url).search;
      requested.push(path);
      const route = routes.find(([prefix]) => path.startsWith(prefix));
      if (!route) throw new Error(`unexpected request ${path}`);
      return route[1](path);
    };
    return { github: createGitHubClient({ token: 't', repository: 'o/r', fetch }), requested };
  };

  it('reads further pages until it passes the start of the window', async () => {
    const since = new Date('2026-11-25T10:00:00Z');
    const until = new Date('2026-11-25T12:00:00Z');
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      issue({
        number: 300 - i,
        created_at: new Date(until.getTime() - 1000 * (i + 1)).toISOString(),
      }),
    );
    const secondPage = [
      issue({ number: 2, created_at: '2026-11-25T10:00:01Z' }),
      issue({ number: 1, created_at: '2026-11-25T09:00:00Z' }),
    ];
    const { github, requested } = clientFor([
      [
        '/repos/o/r/issues',
        (path) => jsonResponse(path.endsWith('&page=1') ? fullPage : secondPage),
      ],
    ]);

    const items = await github.itemsCreatedBetween(since, until);

    assert.equal(requested.length, 2);
    assert.deepEqual(items[0].number, 2);
    assert.deepEqual(items.at(-1).number, 300);
    assert.equal(items.length, 101);
  });

  it('reports no permission for an account that no longer exists', async () => {
    const { github } = clientFor([['/repos/o/r/collaborators/', () => jsonResponse({}, 404)]]);
    assert.equal(await github.permissionOf('ghost'), 'none');
  });

  it('fails on any other error from GitHub', async () => {
    const { github } = clientFor([['/repos/o/r/collaborators/', () => jsonResponse({}, 403)]]);
    await assert.rejects(github.permissionOf('someone'), /responded 403/);
  });
});

describe('collectOutsideContributions', () => {
  it('keeps only authors outside the team, without looking up team accounts', async () => {
    const looked = [];
    const github = {
      itemsCreatedBetween: async () => [
        issue({ number: 1, user: user('outsider') }),
        issue({ number: 2, user: user('maintainer') }),
        issue({ number: 3, user: user('renovate[bot]', 'Bot') }),
        issue({ number: 4, user: user('StevenMcClankerton') }),
        issue({ number: 5, user: user('outsider'), pull_request: {} }),
      ],
      permissionOf: async (login) => {
        looked.push(login);
        return login === 'maintainer' ? 'write' : 'read';
      },
      baseBranchOf: async () => 'main',
    };

    const messages = await collectOutsideContributions(github, new Date(0), new Date());

    assert.deepEqual(
      messages.map(({ number, text }) => ({ number, into: text.includes('into `main`') })),
      [
        { number: 1, into: false },
        { number: 5, into: true },
      ],
    );
    assert.deepEqual(looked, ['outsider', 'maintainer']);
  });

  it('counts admin access as team', async () => {
    const github = {
      itemsCreatedBetween: async () => [issue()],
      permissionOf: async () => 'admin',
      baseBranchOf: async () => 'main',
    };
    assert.deepEqual(await collectOutsideContributions(github, new Date(0), new Date()), []);
  });
});

describe('postToSlack', () => {
  const noSleep = async () => {};

  it('retries after a rate limit, waiting as long as Slack asks', async () => {
    const waits = [];
    let calls = 0;
    const fetch = async () =>
      ++calls === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '7' } })
        : new Response('ok');

    await postToSlack('https://hooks.example/x', 'hi', {
      fetch,
      sleep: async (ms) => waits.push(ms),
    });

    assert.equal(calls, 2);
    assert.deepEqual(waits, [7000]);
  });

  it('gives up after three rate limits in a row', async () => {
    const fetch = async () => new Response('', { status: 429, headers: { 'retry-after': '1' } });
    await assert.rejects(
      postToSlack('https://hooks.example/x', 'hi', { fetch, sleep: noSleep }),
      /Slack responded 429/,
    );
  });

  it('fails on any other error from Slack', async () => {
    const fetch = async () => new Response('invalid_token', { status: 403 });
    await assert.rejects(
      postToSlack('https://hooks.example/x', 'hi', { fetch, sleep: noSleep }),
      /Slack responded 403: invalid_token/,
    );
  });
});
