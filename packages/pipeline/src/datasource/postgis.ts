import pg from 'pg'
import Cursor from 'pg-cursor'

import type { PipeLineRawRow, PointFacilityRawRow } from '@new-qp3d/shared'

import type { PipelineConfig } from '../config.js'

import { mapTemplateLineRow, mapTemplatePointRow } from '../templateMapping.js'

const { Client } = pg
const CURSOR_BATCH_SIZE = 1000

export interface PostgisQueries {
  inspectLineTable: string
  inspectPointTable: string
  readLines: string
  readPoints: string
}

export interface SridCount {
  srid: number
  count: number
}

export interface SridExpectationReport {
  expectedSrid: number
  lineSridMismatch: boolean
  pointSridMismatch: boolean
  lineUnexpectedSrids: SridCount[]
  pointUnexpectedSrids: SridCount[]
}

export interface DatabaseInspection {
  lineCount: number
  pointCount: number
  lineSrids: SridCount[]
  pointSrids: SridCount[]
  sridValidation: SridExpectationReport
}

function validateTableName(name: string): string {
  if (!/^[a-zA-Z_]\w*\.[a-zA-Z_]\w*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`)
  }

  return name
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_]\w*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`)
  }

  return `"${identifier}"`
}

function quoteTableName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
}

function quoteConfiguredTableName(name: string): string {
  const validated = validateTableName(name)
  const [schema, table] = validated.split('.')
  if (!schema || !table) {
    throw new Error(`Invalid table name: ${name}`)
  }

  return quoteTableName(schema, table)
}

function appendLimit(sql: string, limit?: number): string {
  if (limit == null) {
    return sql
  }

  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`Invalid limit: ${limit}`)
  }

  return `${sql} limit ${limit}`
}

export function createPostgisQueries(config: PipelineConfig): PostgisQueries {
  if (config.template) {
    return createTemplatePostgisQueries(config)
  }

  const lineTable = validateTableName(config.lineTable)
  const pointTable = validateTableName(config.pointTable)

  return {
    inspectLineTable: `select ST_SRID(geom) as srid, count(*)::int as count from ${lineTable} group by ST_SRID(geom) order by count desc`,
    inspectPointTable: `select ST_SRID(geom) as srid, count(*)::int as count from ${pointTable} group by ST_SRID(geom) order by count desc`,
    readLines: `select guid, qdbm, zdbm, cz, dmcc, gg, qdms, zdms, qdndbg, zdndbg, gwlx, gs, msfs, lx, gdsx, gdcd, encode(ST_AsEWKB(geom), 'hex') as "geomWkbHex" from ${lineTable} where geom is not null`,
    readPoints: `select gdbm, hzb, zzb, lbmc, dmbg, kj, js, ms, gg, jgcz, jgxz, jgcc, tag, encode(ST_AsEWKB(geom), 'hex') as "geomWkbHex" from ${pointTable} where geom is not null`,
  }
}

function createTemplatePostgisQueries(config: PipelineConfig): PostgisQueries {
  const template = config.template
  if (!template) {
    throw new Error('Build template is required')
  }

  const lineTable = quoteTableName(template.lineTable.schema, template.lineTable.table)
  const pointTable = quoteTableName(template.pointTable.schema, template.pointTable.table)
  const lineGeometry = quoteIdentifier(template.lineTable.geometryField)
  const pointGeometry = quoteIdentifier(template.pointTable.geometryField)

  return {
    inspectLineTable: `select ST_SRID(${lineGeometry}) as srid, count(*)::int as count from ${lineTable} group by ST_SRID(${lineGeometry}) order by count desc`,
    inspectPointTable: `select ST_SRID(${pointGeometry}) as srid, count(*)::int as count from ${pointTable} group by ST_SRID(${pointGeometry}) order by count desc`,
    readLines: `select ${[
      ...lineTemplateFieldSelects(template.lineTable.fieldMapping, template.flowRule.field),
      `encode(ST_AsEWKB(${lineGeometry}), 'hex') as "geomWkbHex"`,
    ].join(', ')} from ${lineTable} where ${lineGeometry} is not null`,
    readPoints: `select ${[
      ...templateFieldSelects(template.pointTable.fieldMapping),
      `encode(ST_AsEWKB(${pointGeometry}), 'hex') as "geomWkbHex"`,
    ].join(', ')} from ${pointTable} where ${pointGeometry} is not null`,
  }
}

function lineTemplateFieldSelects(
  mapping: Record<string, string>,
  flowField?: string,
): string[] {
  const { flowDirection: _ignoredFlowMapping, ...fields } = mapping
  return templateFieldSelects(fields, flowField || mapping.flowDirection)
}

function templateFieldSelects(
  mapping: Record<string, string>,
  extraField?: string,
): string[] {
  const fields = new Set(Object.values(mapping).filter(field => field.trim() !== ''))
  if (extraField?.trim()) {
    fields.add(extraField)
  }

  return [...fields]
    .map((field) => {
      const quoted = quoteIdentifier(field)
      return `${quoted} as ${quoted}`
    })
}

export function evaluateSridExpectations(
  expectedSrid: number,
  lineSrids: SridCount[],
  pointSrids: SridCount[],
): SridExpectationReport {
  const lineUnexpectedSrids = lineSrids.filter(({ srid }) => srid !== expectedSrid)
  const pointUnexpectedSrids = pointSrids.filter(({ srid }) => srid !== expectedSrid)

  return {
    expectedSrid,
    lineSridMismatch: lineUnexpectedSrids.length > 0,
    pointSridMismatch: pointUnexpectedSrids.length > 0,
    lineUnexpectedSrids,
    pointUnexpectedSrids,
  }
}

async function* streamQueryRows<T>(
  connectionString: string,
  sql: string,
  batchSize = CURSOR_BATCH_SIZE,
): AsyncIterable<T> {
  const client = new Client({ connectionString })
  await client.connect()

  const cursor = new Cursor<T>(sql)

  try {
    client.query(cursor as never)

    while (true) {
      const rows = await cursor.read(batchSize)
      if (rows.length === 0) {
        break
      }

      for (const row of rows) {
        yield row
      }
    }
  } finally {
    try {
      await cursor.close()
    } finally {
      await client.end()
    }
  }
}

export class PostgisDataSource {
  constructor(private readonly config: PipelineConfig) {}

  async inspect(): Promise<DatabaseInspection> {
    const lineTable = this.config.template
      ? quoteTableName(this.config.template.lineTable.schema, this.config.template.lineTable.table)
      : quoteConfiguredTableName(this.config.lineTable)
    const pointTable = this.config.template
      ? quoteTableName(this.config.template.pointTable.schema, this.config.template.pointTable.table)
      : quoteConfiguredTableName(this.config.pointTable)
    const queries = createPostgisQueries(this.config)
    const client = new Client({ connectionString: this.config.databaseUrl })
    await client.connect()

    try {
      const lineCount = await client.query<{ count: string }>(
        `select count(*)::bigint as count from ${lineTable}`,
      )
      const pointCount = await client.query<{ count: string }>(
        `select count(*)::bigint as count from ${pointTable}`,
      )
      const lineSrids = await client.query<SridCount>(queries.inspectLineTable)
      const pointSrids = await client.query<SridCount>(
        queries.inspectPointTable,
      )

      return {
        lineCount: Number(lineCount.rows[0]?.count ?? 0),
        pointCount: Number(pointCount.rows[0]?.count ?? 0),
        lineSrids: lineSrids.rows,
        pointSrids: pointSrids.rows,
        sridValidation: evaluateSridExpectations(
          this.config.expectedSrid,
          lineSrids.rows,
          pointSrids.rows,
        ),
      }
    } finally {
      await client.end()
    }
  }

  async *readLines(limit?: number): AsyncIterable<PipeLineRawRow> {
    const queries = createPostgisQueries(this.config)
    for await (const row of streamQueryRows<PipeLineRawRow | Record<string, unknown>>(
      this.config.databaseUrl,
      appendLimit(queries.readLines, limit),
    )) {
      yield this.config.template
        ? mapTemplateLineRow(row as Record<string, unknown>, this.config.template)
        : row as PipeLineRawRow
    }
  }

  async *readPoints(limit?: number): AsyncIterable<PointFacilityRawRow> {
    const queries = createPostgisQueries(this.config)
    for await (const row of streamQueryRows<PointFacilityRawRow | Record<string, unknown>>(
      this.config.databaseUrl,
      appendLimit(queries.readPoints, limit),
    )) {
      yield this.config.template
        ? mapTemplatePointRow(row as Record<string, unknown>, this.config.template)
        : row as PointFacilityRawRow
    }
  }
}
