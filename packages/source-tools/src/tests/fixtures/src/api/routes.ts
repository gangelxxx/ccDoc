import { handleRequest, Request, Response } from './handler'
import type { EngineConfig } from '../core/types'

export interface Route {
  method: string
  path: string
  handler: (req: Request) => Promise<Response>
}

export function createRoutes(): Route[] {
  return [
    { method: 'GET', path: '/', handler: handleRequest },
    { method: 'POST', path: '/process', handler: handleRequest },
  ]
}
