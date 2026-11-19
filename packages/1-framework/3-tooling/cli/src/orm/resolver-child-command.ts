/** The command that evaluates `script` as an ES module with `argument` last in `process.argv`. */
export function resolverChildCommand(
  versions: Readonly<Record<string, string | undefined>>,
  execPath: string,
  script: string,
  argument: string,
): { readonly command: string; readonly args: readonly string[] } {
  if (versions['deno'] !== undefined) {
    return { command: execPath, args: ['eval', script, '--', argument] };
  }
  return { command: execPath, args: ['--input-type=module', '-e', script, '--', argument] };
}
