/** The frames a `--json` run wrote to stdout, parsed as a consumer reads them. */
export function stdoutFrames(stdout: string): readonly Record<string, unknown>[] {
  return stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The `meta` of the error envelope a failed `--json` run wrote last. */
export function stdoutErrorMeta(stdout: string): unknown {
  const last = stdoutFrames(stdout).at(-1) as { envelope: { error: { meta: unknown } } };
  return last.envelope.error.meta;
}
