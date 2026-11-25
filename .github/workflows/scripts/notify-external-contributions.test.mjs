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
  scheduledWindow,
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
  it('picks the latest successful run, whatever order the API returns', () => {
    const runs = [
      { created_at: '2026-11-25T11:30:00Z' },
      { created_at: '2026-11-25T11:50:00Z' },
      { created_at: '2026-11-25T11:40:00Z' },
    ];
    assert.deepEqual(lastScheduledRunStart(runs), new Date('2026-11-25T11:50:00Z'));
  });

  const neverSucceeded = (firstRunStart, createdAt) => ({
    currentRun: async () => ({ createdAt: new Date(createdAt), workflowId: 42 }),
    successfulScheduledRuns: async () => [],
    firstScheduledRunStart: async () => new Date(firstRunStart),
  });

  it('gives the first scheduled run ever the day before it, without a warning', async () => {
    const github = neverSucceeded('2026-11-25T10:03:00Z', '2026-11-25T10:03:00Z');
    assert.deepEqual(await scheduledWindow(github, '1'), {
      since: new Date('2026-11-24T10:03:00Z'),
      until: new Date('2026-11-25T10:03:00Z'),
      skipped: undefined,
    });
  });

  it('keeps the first run’s start until a run succeeds, and warns once the day cap cuts into it', async () => {
    const github = neverSucceeded('2026-11-25T10:03:00Z', '2026-11-25T10:13:00Z');
    assert.deepEqual(await scheduledWindow(github, '2'), {
      since: new Date('2026-11-24T10:13:00Z'),
      until: new Date('2026-11-25T10:13:00Z'),
      skipped: {
        from: new Date('2026-11-24T10:03:00Z'),
        to: new Date('2026-11-24T10:13:00Z'),
      },
    });
  });

  it('gives a re-run of an older run an empty window once a newer run has succeeded', async () => {
    const github = {
      currentRun: async () => ({ createdAt: new Date('2026-11-25T10:03:00Z'), workflowId: 42 }),
      successfulScheduledRuns: async () => [
        { created_at: '2026-11-25T09:53:00Z' },
        { created_at: '2026-11-25T10:13:00Z' },
      ],
    };
    const { since, until } = await scheduledWindow(github, '1');
    assert.deepEqual(
      { since, until },
      {
        since: new Date('2026-11-25T10:13:00Z'),
        until: new Date('2026-11-25T10:03:00Z'),
      },
    );
  });

  it('finds nothing when no run has succeeded', () => {
    assert.equal(lastScheduledRunStart([]), undefined);
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

  it('names the base branch of a pull request', () => {
    const pull = issue({
      number: 202,
      title: 'fix: money',
      html_url: 'https://github.com/prisma/orm/pull/202',
      pull_request: {},
    });
    assert.equal(
      formatSlackMessage(pull, 'v7'),
      'New pull request into `v7` from <https://github.com/someone|someone>\n<https://github.com/prisma/orm/pull/202|#202 fix: money>',
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

  it('keeps an item once when a new item pushes it onto the next page as well', async () => {
    const since = new Date('2026-11-25T10:00:00Z');
    const until = new Date('2026-11-25T12:00:00Z');
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      issue({
        number: 300 - i,
        created_at: new Date(until.getTime() - 1000 * (i + 1)).toISOString(),
      }),
    );
    const secondPage = [fullPage.at(-1), issue({ number: 1, created_at: '2026-11-25T09:00:00Z' })];
    const { github } = clientFor([
      [
        '/repos/o/r/issues',
        (path) => jsonResponse(path.endsWith('&page=1') ? fullPage : secondPage),
      ],
    ]);

    const numbers = (await github.itemsCreatedBetween(since, until)).map((item) => item.number);

    assert.equal(numbers.length, 100);
    assert.equal(new Set(numbers).size, 100);
  });

  it('stops after one full page once that page reaches the start of the window', async () => {
    const since = new Date('2026-11-25T10:00:00Z');
    const until = new Date('2026-11-25T12:00:00Z');
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      issue({
        number: 300 - i,
        created_at: new Date(until.getTime() - 90_000 * (i + 1)).toISOString(),
      }),
    );
    const { github, requested } = clientFor([
      ['/repos/o/r/issues', (path) => jsonResponse(path.endsWith('&page=1') ? fullPage : [])],
    ]);

    const items = await github.itemsCreatedBetween(since, until);

    assert.equal(requested.length, 1);
    assert.equal(items.length, 80);
  });

  it('counts only scheduled runs toward the window, so a manual dry run does not move it', async () => {
    const { github, requested } = clientFor([
      ['/repos/o/r/actions/workflows/', () => jsonResponse({ workflow_runs: [] })],
    ]);
    await github.successfulScheduledRuns(42);
    assert.match(requested[0], /[?&]event=schedule(&|$)/);
    assert.match(requested[0], /[?&]status=success(&|$)/);
  });

  it('finds the earliest scheduled run across every page of runs', async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      created_at: new Date(Date.UTC(2026, 10, 25, 12) - 600_000 * i).toISOString(),
    }));
    const { github, requested } = clientFor([
      [
        '/repos/o/r/actions/workflows/',
        (path) =>
          jsonResponse({
            workflow_runs: path.endsWith('&page=1')
              ? firstPage
              : [{ created_at: '2026-11-24T19:00:00Z' }],
          }),
      ],
    ]);

    assert.deepEqual(await github.firstScheduledRunStart(42), new Date('2026-11-24T19:00:00Z'));
    assert.equal(requested.length, 2);
    assert.match(requested[0], /[?&]event=schedule(&|$)/);
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
