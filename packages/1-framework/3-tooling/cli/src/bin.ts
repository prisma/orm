#!/usr/bin/env node
import process from 'node:process';
import { runOrmCli } from './orm/cli';

process.exitCode = await runOrmCli(process);

// A command that read stdin leaves it referenced — `lsp` reads it for its whole
// run — and the process would then sit waiting on input nobody is reading. The
// run has settled, so it exits on the code above. Optional call: with fd 0
// closed, Node substitutes a stream that has no `unref`.
process.stdin.unref?.();
