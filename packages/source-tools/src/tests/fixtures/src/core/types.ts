/** Engine configuration options */
export interface EngineConfig {
  name: string
  maxRetries: number
  timeout: number
  verbose: boolean
}

/** Possible engine states */
export type EngineState = 'idle' | 'running' | 'error' | 'stopped'

/** Log levels */
export enum LogLevel {
  Debug,
  Info,
  Warn,
  Error,
}

export const DEFAULT_TIMEOUT = 5000
