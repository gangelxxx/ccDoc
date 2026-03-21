import { Engine, createEngine } from '../core'
import { Logger } from '../utils/logger'
import type { EngineConfig } from '../core/types'

export interface Request {
  method: string
  path: string
  body?: unknown
}

export interface Response {
  status: number
  body: unknown
}

/** Handle incoming request */
export async function handleRequest(req: Request): Promise<Response> {
  const engine = createEngine({ name: 'api' })
  await engine.start()

  try {
    const result = await engine.process(req.path)
    return { status: 200, body: result }
  } finally {
    engine.stop()
  }
}

export class ApiServer {
  private engine: Engine
  private logger: Logger

  constructor(config?: Partial<EngineConfig>) {
    this.engine = createEngine(config)
    this.logger = new Logger('api')
  }

  async listen(port: number): Promise<void> {
    await this.engine.start()
  }

  async close(): Promise<void> {
    this.engine.stop()
  }
}
