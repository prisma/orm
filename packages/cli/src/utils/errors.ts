import { bold, green, red } from 'kleur/colors'

export class EarlyAccessFlagError extends Error {
  constructor() {
    super(
      `This feature is currently in Early Access. There may be bugs and it's not recommended to use it in production environments.
Please provide the ${green('--early-access')} flag to use this command.`,
    )
  }
}

/**
 * Error intended to be rendered directly to the terminal without stack traces.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(`\n${bold(red('!'))} ${message}`)
    this.name = 'UserFacingError'
  }
}
