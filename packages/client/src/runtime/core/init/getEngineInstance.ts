import { ClientEngine, Engine, EngineConfig } from '../engines'

/**
 * Get the engine instance based on the runtime bundle type and engine configuration.
 */
export function getEngineInstance(engineConfig: EngineConfig): Engine {
  return new ClientEngine(engineConfig)
}
