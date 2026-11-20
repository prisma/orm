import path from 'node:path'

import { execaSync } from 'execa'

const packageRoot = path.resolve(__dirname, '..', '..')

export class JestCli {
  constructor(
    private args: string[] = [],
    private env: Record<string, string> = {},
    private path = 'node_modules/.bin/jest',
  ) {}

  withArgs(args: string[]): JestCli {
    return new JestCli([...this.args, ...args], this.env, this.path)
  }

  withEnv(env: Record<string, string>): JestCli {
    return new JestCli(this.args, { ...this.env, ...env }, this.path)
  }

  withDebugger(): JestCli {
    const args = ['--inspect-brk', 'node_modules/jest/bin/jest.js', ...this.args]
    const cli = new JestCli(args, this.env, 'node')
    return cli
  }

  run(): void {
    execaSync(this.path, this.args, {
      env: this.env,
      stdio: 'inherit',
      cwd: packageRoot,
    })
  }
}
