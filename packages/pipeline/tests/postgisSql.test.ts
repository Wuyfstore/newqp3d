import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientInstances: Array<{
  connect: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  query: ReturnType<typeof vi.fn>
}> = []

const cursorInstances: Array<{
  sql: string
  rowsQueue: unknown[][]
  read: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}> = []

vi.mock('pg', () => {
  class MockClient {
    connect = vi.fn(async () => undefined)
    end = vi.fn(async () => undefined)
    query = vi.fn((input: unknown) => {
      if (typeof input === 'object' && input !== null && 'read' in input) {
        return input
      }

      return { rows: [] }
    })

    constructor() {
      clientInstances.push(this)
    }
  }

  return {
    default: {
      Client: MockClient,
    },
  }
})

vi.mock('pg-cursor', () => {
  class MockCursor {
    sql: string
    rowsQueue: unknown[][] = []
    read: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>

    constructor(sql: string) {
      this.sql = sql
      this.rowsQueue = [[{ guid: 'a' }], []]
      this.read = vi.fn(async () => this.rowsQueue.shift() ?? [])
      this.close = vi.fn(async () => undefined)
      cursorInstances.push(this)
    }
  }

  return {
    default: MockCursor,
  }
})

import {
  createPostgisQueries,
  evaluateSridExpectations,
  PostgisDataSource,
} from '../src/datasource/postgis.js'

beforeEach(() => {
  clientInstances.length = 0
  cursorInstances.length = 0
})

describe('PostGIS query builder', () => {
  it('selects measured SRID and WKB from the configured line table', () => {
    const queries = createPostgisQueries({
      databaseUrl: 'postgres://example',
      pointTable: 'public.sys_016_tancedbtjinfo_sde',
      lineTable: 'public.sys_016_tancexbtjinfo_sde',
      expectedSrid: 3857,
      outputRoot: 'data/tiles',
    })

    expect(queries.inspectLineTable).toContain('ST_SRID(geom)')
    expect(queries.readLines).toContain('ST_AsEWKB(geom)')
    expect(queries.readLines).toContain('public.sys_016_tancexbtjinfo_sde')
  })

  it('selects all point fields required by the PRD', () => {
    const queries = createPostgisQueries({
      databaseUrl: 'postgres://example',
      pointTable: 'public.sys_016_tancedbtjinfo_sde',
      lineTable: 'public.sys_016_tancexbtjinfo_sde',
      expectedSrid: 3857,
      outputRoot: 'data/tiles',
    })

    expect(queries.readPoints).toContain('gdbm')
    expect(queries.readPoints).toContain('lbmc')
    expect(queries.readPoints).toContain('ST_AsEWKB(geom)')
  })

  it('reports SRID mismatches against the expected SRID', () => {
    expect(
      evaluateSridExpectations(
        3857,
        [
          { srid: 3857, count: 10 },
          { srid: 4326, count: 2 },
        ],
        [{ srid: 4490, count: 1 }],
      ),
    ).toEqual({
      expectedSrid: 3857,
      lineSridMismatch: true,
      pointSridMismatch: true,
      lineUnexpectedSrids: [{ srid: 4326, count: 2 }],
      pointUnexpectedSrids: [{ srid: 4490, count: 1 }],
    })
  })

  it('streams line rows via cursor batches instead of client.query', async () => {
    const source = new PostgisDataSource({
      databaseUrl: 'postgres://example',
      pointTable: 'public.sys_016_tancedbtjinfo_sde',
      lineTable: 'public.sys_016_tancexbtjinfo_sde',
      expectedSrid: 3857,
      outputRoot: 'data/tiles',
    })

    const iterator = source.readLines(3)
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { guid: 'a' } })

    const cursor = cursorInstances[0]
    expect(cursor.sql).toContain('limit 3')
    expect(cursor.read).toHaveBeenCalledWith(1000)
    expect(clientInstances[0]?.query).toHaveBeenCalledTimes(1)
    expect(typeof clientInstances[0]?.query.mock.calls[0]?.[0]).toBe('object')
  })
})
