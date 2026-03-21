import { EngineConfig, EngineState, LogLevel } from './types'
import { Logger } from '../utils/logger'

/** Main processing engine */
export class Engine {
  private state: EngineState = 'idle'
  private config: EngineConfig
  private logger: Logger

  constructor(config: EngineConfig) {
    this.config = config
    this.logger = new Logger(config.name)
  }

  /** Start the engine */
  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('Engine already running')
    }
    this.state = 'running'
    this.logger.log(LogLevel.Info, 'Engine started')
  }

  /** Stop the engine */
  stop(): void {
    this.state = 'stopped'
    this.logger.log(LogLevel.Info, 'Engine stopped')
  }

  /** Get current state */
  getState(): EngineState {
    return this.state
  }

  /** Process a single item */
  async process(item: string): Promise<string> {
    if (this.state !== 'running') {
      throw new Error('Engine not running')
    }
    return `processed:${item}`
  }
}

/** Create an engine with defaults */
export function createEngine(opts?: Partial<EngineConfig>): Engine {
  const config: EngineConfig = {
    name: opts?.name ?? 'default',
    maxRetries: opts?.maxRetries ?? 3,
    timeout: opts?.timeout ?? 5000,
    verbose: opts?.verbose ?? false,
  }
  return new Engine(config)
}

const _internalHelper = () => 'helper'
