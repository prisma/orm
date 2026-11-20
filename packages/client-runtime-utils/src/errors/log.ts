import { PrismaClientRustError } from './PrismaClientRustError'

export type LogLevel = 'info' | 'trace' | 'debug' | 'warn' | 'error' | 'query'
export interface RawRustLog {
  timestamp: string
  level: LogLevel
  target: string
  fields: LogFields
}

export interface RustLog {
  timestamp: Date
  level: LogLevel
  target: string
  fields: LogFields
}

export function getMessage(log: string | PrismaClientRustError): string {
  if (typeof log === 'string') {
    return log
  } else {
    return log.message
  }
}

export function getBacktrace(log: RustLog): string {
  if (log.fields?.message) {
    let str = log.fields?.message
    if (log.fields?.file) {
      str += ` in ${log.fields.file}`
      if (log.fields?.line) {
        str += `:${log.fields.line}`
      }
      if (log.fields?.column) {
        str += `:${log.fields.column}`
      }
    }
    if (log.fields?.reason) {
      str += `\n${log.fields?.reason}`
    }
    return str
  }

  return 'Unknown error'
}

export function isPanic(err: RustLog): boolean {
  return err.fields?.message === 'PANIC'
}

export function isRustLog(e: any): e is RustLog {
  return e.timestamp && typeof e.level === 'string' && typeof e.target === 'string'
}

export function isRustErrorLog(e: any): e is RustLog {
  return isRustLog(e) && (e.level === 'error' || e.fields?.message?.includes('fatal error'))
}

export type LogFields = { [key: string]: any }

export interface PanicLogFields {
  message: 'PANIC'
  reason: string
  file: string
  line: string
  column: number
}

export interface InfoLogFields {
  message: string
  'log.target': string
  'log.module_path': string
  'log.file': string
  'log.line': number
}

export interface QueryLogFields {
  query: string
  item_type: string
  params: string
  duration_ms: number
}

export interface Log {
  message: string
  level: LogLevel
  date: Date
  application: string
  [key: string]: string | Date
}

export function convertLog(rustLog: RawRustLog): RustLog {
  const isQuery = isQueryLog(rustLog.fields)
  const level: LogLevel = isQuery ? 'query' : (rustLog.level.toLowerCase() as LogLevel)
  return {
    ...rustLog,
    level,
    timestamp: new Date(rustLog.timestamp),
  }
}

function isQueryLog(fields: any): fields is QueryLogFields {
  return Boolean(fields.query)
}
