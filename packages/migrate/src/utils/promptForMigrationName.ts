import { canPrompt } from '@prisma/internals'
import slugify from '@sindresorhus/slugify'
import { prompt } from 'prompts'

type getMigrationNameOutput = {
  name?: string
  userCancelled?: string
}

export async function getMigrationName(name?: string): Promise<getMigrationNameOutput> {
  // Truncate if longer
  const maxMigrationNameLength = 200

  if (name) {
    return {
      name: slugify(name, { separator: '_' }).substring(0, maxMigrationNameLength),
    }
  }
  // If not TTY or CI, use default name
  else if (!canPrompt()) {
    return {
      name: '',
    }
  }

  const messageForPrompt = `Enter a name for the new migration:`
  // For testing purposes we log the message
  // An alternative would be to find a way to capture the prompt message from jest tests
  // (attempted without success)
  if (Boolean((prompt as any)._injected?.length) === true) {
    process.stdout.write(messageForPrompt + '\n')
  }
  const response = await prompt({
    type: 'text',
    name: 'name',
    message: messageForPrompt,
  })

  if (!('name' in response)) {
    return {
      userCancelled: 'Canceled by user.',
    }
  }

  return {
    name: slugify(response.name, { separator: '_' }).substring(0, maxMigrationNameLength) || '',
  }
}
