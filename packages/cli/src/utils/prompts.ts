import { confirm, isCancel, log, text } from '@clack/prompts'

/**
 * How a prompt ended: the user answered it, dismissed it with Ctrl+C or Esc,
 * or left it alone until its deadline passed.
 */
export type PromptOutcome<T> = { status: 'answered'; value: T } | { status: 'cancelled' } | { status: 'timeout' }

type CommonPromptOptions = {
  message: string
  /** Dismisses the prompt automatically once this many milliseconds have passed. */
  timeoutMs?: number
}

export type ConfirmPromptOptions = CommonPromptOptions

export type TextPromptOptions = CommonPromptOptions & {
  /** Hint shown while the field is empty. */
  placeholder?: string
}

/**
 * The subset of the prompt library the CLI's one-off prompts need, kept behind
 * an interface so callers can be tested without a TTY.
 */
export type Prompts = {
  confirm: (options: ConfirmPromptOptions) => Promise<PromptOutcome<boolean>>
  text: (options: TextPromptOptions) => Promise<PromptOutcome<string>>
  message: (message: string) => void
}

export const clackPrompts: Prompts = {
  confirm: ({ message, timeoutMs }) => runPrompt(timeoutMs, (signal) => confirm({ message, signal })),
  text: ({ message, placeholder, timeoutMs }) =>
    runPrompt(timeoutMs, (signal) => text({ message, placeholder, signal })),
  message: (message) => log.message(message),
}

async function runPrompt<T>(
  timeoutMs: number | undefined,
  prompt: (signal?: AbortSignal) => Promise<T | symbol>,
): Promise<PromptOutcome<T>> {
  const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
  const result = await prompt(signal)

  if (isCancel(result)) {
    // The signal is only ever armed with the deadline, so an aborted signal
    // tells the two ways of dismissing a prompt apart.
    return signal?.aborted ? { status: 'timeout' } : { status: 'cancelled' }
  }

  return { status: 'answered', value: result }
}
