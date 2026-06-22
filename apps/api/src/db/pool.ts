import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import pg from 'pg'

import type { ApiRepository, SearchResult } from '../server.js'

const { Pool } = pg

export interface PostgisRepositoryOptions {
  databaseUrl: string
  lineTable: string
  pointTable: string
  outputRoot: string
}

export interface LatestManifest {
  version: string
  tilesetUrl: string
  metadataUrl: string
  qualityReportUrl: string
}

interface SearchRow {
  type: 'line' | 'point'
  id: string
  label: string
  longitude: number | string
  latitude: number | string
}

function validateTableName(name: string): string {
  if (!/^[a-zA-Z_]\w*\.[a-zA-Z_]\w*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`)
  }

  return name
}

export function createPostgisRepository(options: PostgisRepositoryOptions): ApiRepository {
  const pool = new Pool({ connectionString: options.databaseUrl })
  const lineTable = validateTableName(options.lineTable)
  const pointTable = validateTableName(options.pointTable)

  return {
    async search(query) {
      const searchTerm = `%${query}%`
      const result = await pool.query<SearchRow>(
        `
        select 'line' as type,
               guid as id,
               concat_ws(' / ', guid, qdbm, zdbm) as label,
               ST_X(ST_Transform(ST_Centroid(geom), 4326)) as longitude,
               ST_Y(ST_Transform(ST_Centroid(geom), 4326)) as latitude
          from ${lineTable}
         where geom is not null
           and (guid ilike $1 or qdbm ilike $1 or zdbm ilike $1)
        union all
        select 'point' as type,
               gdbm as id,
               gdbm as label,
               ST_X(ST_Transform(ST_Centroid(geom), 4326)) as longitude,
               ST_Y(ST_Transform(ST_Centroid(geom), 4326)) as latitude
          from ${pointTable}
         where geom is not null
           and gdbm ilike $1
         limit 25
        `,
        [searchTerm],
      )

      return result.rows.map(row => ({
        type: row.type,
        id: row.id,
        label: row.label,
        longitude: Number(row.longitude),
        latitude: Number(row.latitude),
      }))
    },

    async getLine(guid) {
      const result = await pool.query(
        `
        select guid, qdbm, zdbm, cz, dmcc, gg, qdms, zdms, qdndbg, zdndbg,
               gwlx, gs, msfs, lx, gdsx, gdcd
          from ${lineTable}
         where guid = $1
         limit 1
        `,
        [guid],
      )

      return result.rows[0] ?? null
    },

    async getPoint(gdbm) {
      const result = await pool.query(
        `
        select gdbm, hzb, zzb, lbmc, dmbg, kj, js, ms, gg, jgcz, jgxz, jgcc, tag
          from ${pointTable}
         where gdbm = $1
         limit 1
        `,
        [gdbm],
      )

      return result.rows[0] ?? null
    },

    async getLatestVersion() {
      return readJson<LatestManifest>(join(options.outputRoot, 'latest.json'))
    },

    async getLatestQuality() {
      const latest = await readJson<LatestManifest>(join(options.outputRoot, 'latest.json'))
      if (latest == null) {
        return null
      }

      return readJson(join(options.outputRoot, latest.version, 'quality-report.json'))
    },
  }
}

export function createSearchResult(row: SearchRow): SearchResult {
  return {
    type: row.type,
    id: row.id,
    label: row.label,
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
  }
}

async function readJson<T = unknown>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}
