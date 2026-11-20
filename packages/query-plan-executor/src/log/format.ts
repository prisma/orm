import { Temporal } from 'temporal-polyfill'

import { LogEvent } from './event'
import { LogLevel, validLogLevels } from './log-level'

/**
 * Output format of printed log events.
 */
export type LogFormat = 'json' | 'text'

/**
 * Parses a string into a valid {@link LogFormat}.
 *
 * @param format The string to parse
 * @returns The parsed LogFormat
 * @throws {Error} if the format is not supported
 */
export function parseLogFormat(format: string): LogFormat {
  if (format === 'json' || format === 'text') {
    return format
  }
  throw new Error(`Invalid log format: ${format}`)
}

/**
 * Interface for classes that format log events for console output.
 */
export interface ConsoleFormatter {
  /**
   * Formats a log event for console output.
   *
   * @param event The log event to format
   * @returns An array of format string and parameters suitable for console methods
   */
  format(event: LogEvent): unknown[]
}

/**
 * Creates a formatter for the specified log format.
 */
export function createLogFormatter(format: LogFormat): ConsoleFormatter {
  switch (format) {
    case 'json':
      return new JsonFormatter()
    case 'text':
      return new TextFormatter()
    default:
      throw new Error(`Invalid log format: ${format satisfies never}`)
  }
}

/**
 * Formatter that outputs log events as JSON strings.
 */
export class JsonFormatter implements ConsoleFormatter {
  format(event: LogEvent): unknown[] {
    return ['%s', JSON.stringify(event)]
  }
}

type Fragment = {
  fmt: string
  params: unknown[]
}

function mergeFragments(fragments: Fragment[]): Fragment {
  const fmt = fragments.map((fragment) => fragment.fmt).join(' ')
  const params = fragments.flatMap((fragment) => fragment.params)
  return { fmt, params }
}

const levelStyles: Record<LogLevel, string> = {
  debug: 'color: blue',
  query: 'color: magenta',
  info: 'color: green',
  warn: 'color: yellow',
  error: 'color: red',
}

/**
 * Formatter that outputs log events as human-readable text with color highlighting.
 */
export class TextFormatter implements ConsoleFormatter {
  format(event: LogEvent): unknown[] {
    const { fmt, params } = mergeFragments([
      TextFormatter.formatLevel(event.level),
      TextFormatter.formatTimestamp(event.timestamp),
      TextFormatter.formatMessage(event.message),
      ...TextFormatter.formatAttributes(event.attributes),
    ])
    return [fmt, ...params]
  }

  private static maxLevelLength = Math.max(...validLogLevels.map((level) => level.length))

  private static formatLevel(level: LogLevel): Fragment {
    return {
      fmt: '%c%s%c',
      params: [levelStyles[level], level.toUpperCase().padEnd(TextFormatter.maxLevelLength), 'color: initial'],
    }
  }

  private static formatTimestamp(timestamp: Temporal.Instant): Fragment {
    return {
      fmt: '%c%s%c',
      params: ['color: gray', timestamp.toString(), 'color: initial'],
    }
  }

  private static formatMessage(message: string): Fragment {
    return { fmt: '%s', params: [message] }
  }

  private static formatAttributes(attributes: Record<string, unknown>): Fragment[] {
    return Object.entries(attributes).map(([key, value]) => ({
      fmt: '%c%s%c=%o',
      params: ['color: cyan', key, 'color: initial', value],
    }))
  }
}
