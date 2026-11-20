import { execaCommand } from 'execa'

// wrapper around execa to run our build cmds

export function run(command: string) {
  return execaCommand(command, {
    preferLocal: true,
    shell: true,
    stdio: 'inherit',
  })
}
