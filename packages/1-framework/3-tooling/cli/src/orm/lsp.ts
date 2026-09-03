import { ifDefined } from '@internal/utils/defined';
import { defineServerCommand, flag } from '@prisma/cli-engine';

/**
 * R-S5-12 asks every command to end at 143 for SIGTERM and 130 otherwise, and
 * a server command is the one kind the engine leaves to do it: it settles the
 * handler's code verbatim, on the reasoning that a protocol conclusion was
 * never the CLI's to author. The two readings are in tension — this one wins
 * here, and the tension is recorded for the engine's owners, because it means
 * a SIGTERM landing after a clean `shutdown` reports 143 for a conversation
 * that ended correctly at 0.
 */
function signalExitCode(reason: unknown): number {
  return reason === 'SIGTERM' ? 143 : 130;
}

export const lspCommand = defineServerCommand({
  help: {
    summary: 'Start the Prisma ORM language server',
    description:
      'Launches a Language Server Protocol server that publishes PSL parse diagnostics\n' +
      'and handles whole-document PSL formatting for the schema inputs declared in\n' +
      'your config (contract.source.inputs). Formatting uses the Prisma ORM PSL\n' +
      'formatter and the formatter block from the project config.\n' +
      'Communicates over stdio; intended to be spawned by an\n' +
      'editor, not run interactively. The server keeps running until the editor client\n' +
      'disconnects.',
    examples: ['lsp'],
  },
  args: {
    flags: {
      stdio: flag.boolean({
        brief: 'Communicate with the editor over stdio (the default and only transport)',
      }),
      // `vscode-languageclient` appends `--clientProcessId=<pid>` to every
      // server its NodeModule form spawns; the scanner accepts the camelCase
      // spelling it uses.
      clientProcessId: flag.number({
        brief: 'Process id of the editor that spawned the server; the server ends when it dies',
        placeholder: 'pid',
      }),
    },
  },
  handler: async (args, io) => {
    const exitCode = await withoutClientProcessIdInArgv(async () => {
      // Lazy so `vscode-languageserver` stays off every other command's
      // startup path — only this command pays its load cost.
      const { startServer } = await import('@internal/language-server');
      return startServer({
        stdin: io.stdin,
        stdout: io.stdout,
        stderr: io.stderr,
        signal: io.signal,
        ...ifDefined('clientProcessId', args.flags.clientProcessId),
      });
    });
    return io.signal.aborted ? signalExitCode(io.signal.reason) : exitCode;
  },
});

/**
 * Importing `vscode-languageserver/node` reads `--clientProcessId` off
 * `process.argv` and arms a parent-watch interval that is never unref'd, so a
 * settled run would leave the process hanging. The server watches the client
 * process itself (from the parsed flag), so the argument is hidden for the
 * import and restored after.
 */
async function withoutClientProcessIdInArgv(run: () => Promise<number>): Promise<number> {
  const original = process.argv;
  const scrubbed: string[] = [];
  for (let index = 0; index < original.length; index += 1) {
    const token = original[index];
    if (token === '--clientProcessId') {
      index += 1;
      continue;
    }
    if (token === undefined || token.startsWith('--clientProcessId=')) {
      continue;
    }
    scrubbed.push(token);
  }
  process.argv = scrubbed;
  try {
    return await run();
  } finally {
    process.argv = original;
  }
}
