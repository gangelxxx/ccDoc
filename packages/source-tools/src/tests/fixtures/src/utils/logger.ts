import { LogLevel } from '../core/types'

/** Simple logger utility */
export class Logger {
  private name: string

  constructor(name: string) {
    this.name = name
  }

  log(level: LogLevel, message: string): void {
    console.log(`[${this.name}] ${LogLevel[level]}: ${message}`)
  }
}

export function createLogger(name: string): Logger {
  return new Logger(name)
}
