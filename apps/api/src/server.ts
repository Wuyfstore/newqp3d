import cors from '@fastify/cors'
import Fastify from 'fastify'

import { registerDetailsRoutes } from './routes/details.js'
import { registerQualityRoutes } from './routes/quality.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerVersionRoutes } from './routes/versions.js'

export interface SearchResult {
  type: 'line' | 'point'
  id: string
  label: string
  longitude: number
  latitude: number
}

export interface ApiRepository {
  search(query: string): Promise<SearchResult[]>
  getLine(guid: string): Promise<unknown | null>
  getPoint(gdbm: string): Promise<unknown | null>
  getLatestVersion(): Promise<unknown | null>
  getLatestQuality(): Promise<unknown | null>
}

export async function createServer(repository: ApiRepository) {
  const app = Fastify({ logger: false })

  await app.register(cors, { origin: true })
  await registerSearchRoutes(app, repository)
  await registerDetailsRoutes(app, repository)
  await registerVersionRoutes(app, repository)
  await registerQualityRoutes(app, repository)

  return app
}
