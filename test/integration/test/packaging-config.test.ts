import { describe, expect, it } from 'vitest';
import config from '../vitest.config';

type Project = { extends?: boolean; test?: Record<string, unknown> };

function project(name: string): Project {
  const projects = (config.test?.projects ?? []) as Project[];
  const found = projects.find((candidate) => candidate.test?.['name'] === name);
  if (found === undefined) throw new Error(`no vitest project named ${name}`);
  return found;
}

describe('packaging test scheduling', () => {
  it('serializes the tarball suites in a dedicated project', () => {
    expect(project('packaging').test).toMatchObject({
      include: ['test/packaging/**/*.test.ts'],
      fileParallelism: false,
    });
  });

  it('keeps the other integration tests parallel and free of packaging suites', () => {
    expect(config.test?.fileParallelism).not.toBe(false);
    const integration = project('integration').test;
    expect(integration?.['exclude']).toContain('test/packaging/**');
    expect(integration?.['fileParallelism']).toBeUndefined();
  });
});
