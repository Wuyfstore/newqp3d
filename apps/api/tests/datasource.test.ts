import { describe, expect, it } from 'vitest'

import type { ApiRepository, DataSourceTableProfile } from '../src/server.js'
import { createServer } from '../src/server.js'

function createRepository(overrides: Partial<ApiRepository> = {}): ApiRepository {
  return {
    search: async () => [],
    getLine: async () => null,
    getPoint: async () => null,
    getLatestVersion: async () => null,
    getLatestQuality: async () => null,
    listVersions: async () => [],
    getVersion: async () => null,
    getQualityReport: async () => null,
    getAdaptationReport: async () => null,
    publishVersion: async () => null,
    rollbackVersion: async () => null,
    listSchemas: async () => [],
    listTables: async () => [],
    getTableProfile: async () => ({
      schema: 'public',
      table: 'empty',
      estimatedRowCount: null,
      geometryFields: [],
      fields: [],
      inferredTableKind: 'unknown',
      recommendedFieldMapping: {},
    }),
    ...overrides,
  }
}

describe('datasource discovery routes', () => {
  it('lists schemas without exposing database credentials', async () => {
    const app = await createServer(createRepository({
      listSchemas: async () => [{ name: 'public' }, { name: 'network' }],
    }))

    try {
      const response = await app.inject({ method: 'GET', url: '/api/datasource/schemas' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        schemas: [{ name: 'public' }, { name: 'network' }],
      })
      expect(response.body).not.toContain('postgres://')
      expect(response.body).not.toContain('password')
    } finally {
      await app.close()
    }
  })

  it('lists tables for a selected schema', async () => {
    let seenSchema: string | undefined
    const app = await createServer(createRepository({
      listTables: async schema => {
        seenSchema = schema
        return [
          { schema: 'public', name: 'sys_016_tancexbtjinfo_sde', type: 'table', estimatedRows: 1_250_000 },
          { schema: 'public', name: 'sys_016_tancedbtjinfo_sde', type: 'table', estimatedRows: 980_000 },
        ]
      },
    }))

    try {
      const response = await app.inject({ method: 'GET', url: '/api/datasource/tables?schema=public' })

      expect(response.statusCode).toBe(200)
      expect(seenSchema).toBe('public')
      expect(response.json()).toEqual({
        tables: [
          { schema: 'public', name: 'sys_016_tancexbtjinfo_sde', type: 'table', estimatedRows: 1_250_000 },
          { schema: 'public', name: 'sys_016_tancedbtjinfo_sde', type: 'table', estimatedRows: 980_000 },
        ],
      })
    } finally {
      await app.close()
    }
  })

  it('returns fields, geometry, sample values, stats, and mapping recommendations for a table', async () => {
    const profile: DataSourceTableProfile = {
      schema: 'public',
      table: 'sys_016_tancexbtjinfo_sde',
      estimatedRowCount: 1_250_000,
      geometryFields: [
        { name: 'geom', srid: 3857, geometryType: 'LINESTRING' },
      ],
      fields: [
        {
          name: 'guid',
          dataType: 'character varying',
          isNullable: false,
          samples: ['L-001', 'L-002'],
          nullRate: 0,
          uniqueCount: 1000,
          recommendedMapping: 'id',
        },
        {
          name: 'qdbm',
          dataType: 'character varying',
          isNullable: true,
          samples: ['P-001'],
          nullRate: 0.1,
          uniqueCount: 900,
          recommendedMapping: 'startNodeId',
        },
      ],
      inferredTableKind: 'line',
      recommendedFieldMapping: {
        id: 'guid',
        startNodeId: 'qdbm',
      },
    }
    const app = await createServer(createRepository({
      getTableProfile: async (schema, table) => {
        expect(schema).toBe('public')
        expect(table).toBe('sys_016_tancexbtjinfo_sde')
        return profile
      },
    }))

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/datasource/tables/public/sys_016_tancexbtjinfo_sde/profile',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(profile)
    } finally {
      await app.close()
    }
  })
})
