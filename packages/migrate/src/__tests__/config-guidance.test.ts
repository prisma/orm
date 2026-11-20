import { DbDrop } from '../commands/DbDrop'
import { DbExecute } from '../commands/DbExecute'
import { DbPull } from '../commands/DbPull'
import { DbPush } from '../commands/DbPush'
import { MigrateDeploy } from '../commands/MigrateDeploy'
import { MigrateDev } from '../commands/MigrateDev'
import { MigrateReset } from '../commands/MigrateReset'
import { MigrateResolve } from '../commands/MigrateResolve'
import { MigrateStatus } from '../commands/MigrateStatus'

const commands = [
  ['db drop', DbDrop.new('prisma')],
  ['db execute', DbExecute.new('prisma')],
  ['db pull', DbPull.new('prisma')],
  ['db push', DbPush.new('prisma')],
  ['migrate deploy', MigrateDeploy.new('prisma')],
  ['migrate dev', MigrateDev.new('prisma')],
  ['migrate reset', MigrateReset.new('prisma')],
  ['migrate resolve', MigrateResolve.new('prisma')],
  ['migrate status', MigrateStatus.new('prisma')],
] as const

describe('Prisma config guidance', () => {
  test.each(commands)('%s uses the Prisma 7 config filename', (_, command) => {
    const help = command.help()

    expect(help).toEqual(expect.any(String))
    expect(help).toContain('prisma7.config.ts')
    expect(help).not.toContain('prisma.config.ts')
  })
})
