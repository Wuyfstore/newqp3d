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
      this.rowsQueue = sql.includes('"line_code"')
        ? [[{
            line_code: 'mapped-line',
            from_code: 'mapped-start',
            to_code: 'mapped-end',
            pipe_spec: 'DN500',
            direction: '1',
            geomWkbHex: '0102',
          }], []]
        : [[{ guid: 'a' }], []]
      this.read = vi.fn(async () => this.rowsQueue.shift() ?? [])
      this.close = vi.fn(async () => undefined)
      cursorInstances.push(this)
    }
  }

  return {
    default: MockCursor,
  }
})

import { createReferenceBuildTemplate, type PipeLineRawRow } from '@new-qp3d/shared'

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

  it('selects line and point fields from a build template mapping', () => {
    const template = createReferenceBuildTemplate()
    template.lineTable.fieldMapping = {
      id: 'line_code',
      startNodeId: 'from_code',
      endNodeId: 'to_code',
      spec: 'pipe_spec',
      flowDirection: 'legacy_lx',
    }
    template.flowRule.field = 'direction'
    template.pointTable.fieldMapping = {
      id: 'node_code',
      pointType: 'node_type',
      surfaceElevation: 'surface_z',
    }
    const queries = createPostgisQueries({
      databaseUrl: 'postgres://example',
      pointTable: 'public.point_fallback',
      lineTable: 'public.line_fallback',
      expectedSrid: 3857,
      outputRoot: 'data/tiles',
      template,
    })

    expect(queries.inspectLineTable).toContain('ST_SRID("geom")')
    expect(queries.readLines).toContain('"line_code" as "line_code"')
    expect(queries.readLines).toContain('"from_code" as "from_code"')
    expect(queries.readLines).toContain('"pipe_spec" as "pipe_spec"')
    expect(queries.readLines).toContain('"direction" as "direction"')
    expect(queries.readLines).not.toContain('"legacy_lx" as "legacy_lx"')
    expect(queries.readLines).not.toContain('"lx" as "lx"')
    expect(queries.readLines).toContain('from "public"."sys_016_tancexbtjinfo_sde"')
    expect(queries.readLines).not.toContain('guid, qdbm, zdbm')
    expect(queries.readPoints).toContain('"node_code" as "node_code"')
    expect(queries.readPoints).toContain('"surface_z" as "surface_z"')
    expect(queries.readPoints).toContain('from "public"."sys_016_tancedbtjinfo_sde"')
  })

  it('maps streamed template rows to standard pipeline rows', async () => {
    const template = createReferenceBuildTemplate()
    template.lineTable.fieldMapping = {
      id: 'line_code',
      startNodeId: 'from_code',
      endNodeId: 'to_code',
      spec: 'pipe_spec',
      flowDirection: 'direction',
    }
    template.flowRule.field = 'direction'
    const source = new PostgisDataSource({
      databaseUrl: 'postgres://example',
      pointTable: 'public.point_fallback',
      lineTable: 'public.line_fallback',
      expectedSrid: 3857,
      outputRoot: 'data/tiles',
      template,
    })

    const iterator = source.readLines(3)
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: expect.objectContaining({
        guid: 'mapped-line',
        qdbm: 'mapped-start',
        zdbm: 'mapped-end',
        gg: 'DN500',
        lx: '1',
      }) as PipeLineRawRow,
    })
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
