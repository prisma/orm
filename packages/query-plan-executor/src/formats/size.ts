import { parseInteger } from './numeric'

// Size units with their byte values
const sizeUnits: Record<string, number> = {
  // Decimal units
  B: 1,
  KB: 1000,
  MB: 1000 * 1000,
  GB: 1000 * 1000 * 1000,
  TB: 1000 * 1000 * 1000 * 1000,

  // Binary units
  KiB: 1024,
  MiB: 1024 * 1024,
  GiB: 1024 * 1024 * 1024,
  TiB: 1024 * 1024 * 1024 * 1024,
}

/**
 * Parses a string as a size in bytes.
 * Supports both plain integers (interpreted as bytes) and strings with size units.
 *
 * @param value The string to parse
 * @returns The size in bytes
 * @throws Error if the value is invalid
 */
export function parseSize(value: string): number {
  // If the value is a plain number, treat it as bytes
  if (/^\d+$/.test(value)) {
    return parseInteger(value)
  }

  // Match a number followed by a unit
  const match = value.match(/^([\d.]+)\s*([A-Za-z]+)$/)
  if (!match) {
    throw new Error(`Invalid size format: ${value}`)
  }

  const [_, numStr, unit] = match
  const num = parseFloat(numStr)

  if (Number.isNaN(num)) {
    throw new Error(`Invalid size value: ${numStr}`)
  }

  const multiplier = sizeUnits[unit]
  if (multiplier === undefined) {
    throw new Error(`Unknown size unit: ${unit}`)
  }

  return Math.floor(num * multiplier)
}
