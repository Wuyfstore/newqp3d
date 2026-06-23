import { beforeEach, describe, expect, it, vi } from 'vitest'

const poolInstances: Array<{
  query: ReturnType<typeof vi.fn>
}> = []

vi.mock('pg', () => {
  class MockPool {
    query = vi.fn(async (sql: string) => {
      if (sql.includes('from information_schema.schemata')) {
        return { rows: [{ schema_name: 'public' }] }
      }

      if (sql.includes('from information_schema.tables')) {
        return {
          rows: [{
            table_schema: 'public',
            table_name: 'sys_016_tancexbtjinfo_sde',
            table_type: 'BASE TABLE',
            estimated_rows: '1250000',
          }],
        }
      }

      if (sql.includes('from information_schema.columns')) {
        return {
          rows: [
            { column_name: 'guid', data_type: 'character varying', is_nullable: 'NO' },
            { column_name: 'qdbm', data_type: 'character varying', is_nullable: 'YES' },
            { column_name: 'geom', data_type: 'USER-DEFINED', is_nullable: 'YES' },
          ],
        }
      }

      if (sql.includes('from public.geometry_columns')) {
        return {
          rows: [{ f_geometry_column: 'geom', srid: 3857, type: 'LINESTRING' }],
        }
      }

      if (sql.includes('reltuples')) {
        return { rows: [{ estimated_rows: '1250000' }] }
      }

      if (sql.includes('count(*) filter')) {
        return { rows: [{ total_count: '100', null_count: '0', unique_count: '98' }] }
      }

      if (sql.includes('array_agg')) {
        return { rows: [{ samples: ['L-001', 'L-002'] }] }
      }

      return { rows: [] }
    })

    constructor() {
      poolInstances.push(this)
    }
  }

  return {
    default: {
      Pool: MockPool,
    },
  }
})

import { createPostgisRepository } from '../src/db/pool.js'

beforeEach(() => {
  poolInstances.length = 0
})

describe('datasource discovery repository', () => {
  it('reads schemas, tables, geometry metadata, field stats, samples, and recommendations', async () => {
    const repository = createPostgisRepository({
      databaseUrl: 'postgres://user:password@example.invalid/qp3d',
      lineTable: 'public.lines',
      pointTable: 'public.points',
      outputRoot: 'data/tiles',
    })

    await expect(repository.listSchemas()).resolves.toEqual([{ name: 'public' }])
    await expect(repository.listTables('public')).resolves.toEqual([
      { schema: 'public', name: 'sys_016_tancexbtjinfo_sde', type: 'table', estimatedRows: 1_250_000 },
    ])

    await expect(repository.getTableProfile('public', 'sys_016_tancexbtjinfo_sde')).resolves.toEqual({
      schema: 'public',
      table: 'sys_016_tancexbtjinfo_sde',
      estimatedRowCount: 1_250_000,
      geometryFields: [{ name: 'geom', srid: 3857, geometryType: 'LINESTRING' }],
      fields: [
        {
          name: 'guid',
          dataType: 'character varying',
          isNullable: false,
          samples: ['L-001', 'L-002'],
          nullRate: 0,
          uniqueCount: 98,
          recommendedMapping: 'id',
        },
        {
          name: 'qdbm',
          dataType: 'character varying',
          isNullable: true,
          samples: ['L-001', 'L-002'],
          nullRate: 0,
          uniqueCount: 98,
          recommendedMapping: 'startNodeId',
        },
        {
          name: 'geom',
          dataType: 'USER-DEFINED',
          isNullable: true,
          samples: ['L-001', 'L-002'],
          nullRate: 0,
          uniqueCount: 98,
        },
      ],
      inferredTableKind: 'line',
      recommendedFieldMapping: {
        id: 'guid',
        startNodeId: 'qdbm',
      },
    })

    const allQueries = poolInstances[0]?.query.mock.calls.map(call => String(call[0])).join('\n') ?? ''
    expect(allQueries).not.toContain('postgres://user:password')
  })

  it('rejects unsafe identifiers before building SQL', async () => {
    const repository = createPostgisRepository({
      databaseUrl: 'postgres://example.invalid/qp3d',
      lineTable: 'public.lines',
      pointTable: 'public.points',
      outputRoot: 'data/tiles',
    })

    await expect(repository.getTableProfile('public', 'lines; drop table users')).rejects.toThrow('Invalid identifier')
  })
})
