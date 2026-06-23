import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import pg from 'pg'

import type {
  ApiRepository,
  DataSourceFieldProfile,
  DataSourceGeometryField,
  DataSourceSchema,
  DataSourceTable,
  DataSourceTableProfile,
  SearchResult,
} from '../server.js'

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
  adaptationReportUrl?: string
  flowTilesetUrl?: string
  flowMode?: 'embedded'
}

type VersionRecordStatus = 'ready' | 'published' | 'superseded'

interface VersionRecord extends LatestManifest {
  status: VersionRecordStatus
  createdAt: string
  updatedAt: string
  templateId?: string
  templateVersion?: string
  buildTaskId?: string
}

interface SearchRow {
  type: 'line' | 'point'
  id: string
  label: string
  longitude: number | string
  latitude: number | string
}

interface SchemaRow {
  schema_name: string
}

interface TableRow {
  table_schema: string
  table_name: string
  table_type: string
  estimated_rows: number | string | null
}

interface ColumnRow {
  column_name: string
  data_type: string
  is_nullable: 'YES' | 'NO'
}

interface GeometryRow {
  f_geometry_column: string
  srid: number | string | null
  type: string | null
}

interface CountRow {
  total_count: number | string
  null_count: number | string
  unique_count: number | string
}

interface SamplesRow {
  samples: unknown[] | null
}

interface EstimateRow {
  estimated_rows: number | string | null
}

function validateTableName(name: string): string {
  if (!/^[a-zA-Z_]\w*\.[a-zA-Z_]\w*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`)
  }

  return name
}

function validateIdentifier(name: string): string {
  if (!/^[a-zA-Z_]\w*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`)
  }

  return name
}

function quoteIdentifier(name: string): string {
  return `"${validateIdentifier(name).replaceAll('"', '""')}"`
}

function quoteQualifiedName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
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

      return readVersionReport(options.outputRoot, latest.version, 'quality-report.json')
    },

    async listVersions() {
      return listVersionRecords(options.outputRoot)
    },

    async getVersion(version) {
      const latest = await readJson<LatestManifest>(join(options.outputRoot, 'latest.json'))
      if (latest?.version === version) {
        return latest
      }

      const safeVersion = validateVersionId(version)
      const record = await readJson<VersionRecord>(join(options.outputRoot, safeVersion, 'version-record.json'))
      if (record == null) {
        return null
      }

      return latestFromRecord(record)
    },

    async getQualityReport(version) {
      return readVersionReport(options.outputRoot, version, 'quality-report.json')
    },

    async getAdaptationReport(version) {
      return readVersionReport(options.outputRoot, version, 'adaptation-report.json')
    },

    async publishVersion(version) {
      return publishPreparedVersion(options.outputRoot, version)
    },

    async rollbackVersion(version) {
      return publishPreparedVersion(options.outputRoot, version)
    },

    async listSchemas() {
      const result = await pool.query<SchemaRow>(`
        select schema_name
          from information_schema.schemata
         where schema_name not in ('information_schema', 'pg_catalog')
           and schema_name not like 'pg_toast%'
           and schema_name not like 'pg_temp_%'
         order by schema_name
      `)

      return result.rows.map(row => ({ name: row.schema_name }))
    },

    async listTables(schema) {
      validateIdentifier(schema)
      const result = await pool.query<TableRow>(
        `
        select t.table_schema,
               t.table_name,
               t.table_type,
               c.reltuples::bigint as estimated_rows
          from information_schema.tables t
          left join pg_class c
            on c.relname = t.table_name
          left join pg_namespace n
            on n.oid = c.relnamespace
           and n.nspname = t.table_schema
         where t.table_schema = $1
           and t.table_type in ('BASE TABLE', 'VIEW')
         order by t.table_name
        `,
        [schema],
      )

      return result.rows.map(row => ({
        schema: row.table_schema,
        name: row.table_name,
        type: row.table_type === 'VIEW' ? 'view' : 'table',
        estimatedRows: parseNullableInteger(row.estimated_rows),
      }))
    },

    async getTableProfile(schema, table) {
      return getTableProfile(pool, schema, table)
    },
  }
}

function validateVersionId(version: string): string {
  if (!/^[\w.-]+$/.test(version) || version.includes('..')) {
    throw new Error('Invalid version id')
  }

  return version
}

async function readVersionReport(outputRoot: string, version: string, fileName: string): Promise<unknown | null> {
  return readJson(join(outputRoot, validateVersionId(version), fileName))
}

async function listVersionRecords(outputRoot: string): Promise<VersionRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(outputRoot)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }

  const records = await Promise.all(entries
    .filter(entry => !entry.startsWith('.') && entry !== 'latest.json')
    .map(async entry => {
      try {
        return await readJson<VersionRecord>(join(outputRoot, validateVersionId(entry), 'version-record.json'))
      } catch {
        return null
      }
    }))

  return records
    .filter((record): record is VersionRecord => record != null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

async function publishPreparedVersion(outputRoot: string, version: string): Promise<LatestManifest | null> {
  const safeVersion = validateVersionId(version)
  const versionRoot = join(outputRoot, safeVersion)
  const record = await readJson<VersionRecord>(join(versionRoot, 'version-record.json'))
  if (record == null) {
    return null
  }

  await validatePreparedVersion(versionRoot)
  const latest = latestFromRecord(record)
  const publishedRecord = markRecord(record, 'published')
  await writeFile(join(versionRoot, 'version-record.json'), `${JSON.stringify(publishedRecord, null, 2)}\n`)
  await markOtherPublishedRecordsSuperseded(outputRoot, safeVersion)
  await writeFile(join(outputRoot, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`)
  return latest
}

async function validatePreparedVersion(versionRoot: string): Promise<void> {
  for (const fileName of ['tileset.json', 'root.glb', 'quality-report.json', 'version-record.json']) {
    const result = await stat(join(versionRoot, fileName))
    if (!result.isFile()) {
      throw new Error(`Missing required version file: ${fileName}`)
    }
  }
}

function latestFromRecord(record: VersionRecord): LatestManifest {
  return {
    version: record.version,
    tilesetUrl: record.tilesetUrl,
    metadataUrl: record.metadataUrl,
    qualityReportUrl: record.qualityReportUrl,
    ...(record.adaptationReportUrl === undefined ? {} : { adaptationReportUrl: record.adaptationReportUrl }),
    ...(record.flowTilesetUrl === undefined ? {} : { flowTilesetUrl: record.flowTilesetUrl }),
    ...(record.flowMode === undefined ? {} : { flowMode: record.flowMode }),
  }
}

function markRecord(record: VersionRecord, status: VersionRecordStatus): VersionRecord {
  return {
    ...record,
    status,
    updatedAt: new Date().toISOString(),
  }
}

async function markOtherPublishedRecordsSuperseded(outputRoot: string, publishedVersion: string): Promise<void> {
  const records = await listVersionRecords(outputRoot)
  await Promise.all(records
    .filter(record => record.version !== publishedVersion && record.status === 'published')
    .map(async record => {
      const next = markRecord(record, 'superseded')
      await writeFile(
        join(outputRoot, record.version, 'version-record.json'),
        `${JSON.stringify(next, null, 2)}\n`,
      )
    }))
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

async function getTableProfile(pool: pg.Pool, schema: string, table: string): Promise<DataSourceTableProfile> {
  validateIdentifier(schema)
  validateIdentifier(table)

  const qualifiedName = quoteQualifiedName(schema, table)
  const [estimatedRowCount, geometryFields, columns] = await Promise.all([
    readEstimatedRowCount(pool, schema, table),
    readGeometryFields(pool, schema, table),
    readColumns(pool, schema, table),
  ])
  const inferredTableKind = inferTableKind(columns, geometryFields)
  const fields = await Promise.all(
    columns.map(async column => {
      const [stats, samples] = await Promise.all([
        readColumnStats(pool, qualifiedName, column.column_name),
        readColumnSamples(pool, qualifiedName, column.column_name),
      ])
      const recommendedMapping = recommendFieldMapping(column.column_name, inferredTableKind)
      const field: DataSourceFieldProfile = {
        name: column.column_name,
        dataType: column.data_type,
        isNullable: column.is_nullable === 'YES',
        samples,
        nullRate: stats.nullRate,
        uniqueCount: stats.uniqueCount,
      }

      if (recommendedMapping !== undefined) {
        field.recommendedMapping = recommendedMapping
      }

      return field
    }),
  )
  const recommendedFieldMapping = Object.fromEntries(
    fields
      .filter(field => field.recommendedMapping !== undefined)
      .map(field => [field.recommendedMapping, field.name]),
  )

  return {
    schema,
    table,
    estimatedRowCount,
    geometryFields,
    fields,
    inferredTableKind,
    recommendedFieldMapping,
  }
}

async function readEstimatedRowCount(pool: pg.Pool, schema: string, table: string): Promise<number | null> {
  const result = await pool.query<EstimateRow>(
    `
    select c.reltuples::bigint as estimated_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1
       and c.relname = $2
     limit 1
    `,
    [schema, table],
  )

  return parseNullableInteger(result.rows[0]?.estimated_rows ?? null)
}

async function readGeometryFields(pool: pg.Pool, schema: string, table: string): Promise<DataSourceGeometryField[]> {
  const result = await pool.query<GeometryRow>(
    `
    select f_geometry_column,
           srid,
           type
      from public.geometry_columns
     where f_table_schema = $1
       and f_table_name = $2
     order by f_geometry_column
    `,
    [schema, table],
  )

  return result.rows.map(row => ({
    name: row.f_geometry_column,
    srid: parseNullableInteger(row.srid),
    geometryType: row.type,
  }))
}

async function readColumns(pool: pg.Pool, schema: string, table: string): Promise<ColumnRow[]> {
  const result = await pool.query<ColumnRow>(
    `
    select column_name,
           data_type,
           is_nullable
      from information_schema.columns
     where table_schema = $1
       and table_name = $2
     order by ordinal_position
    `,
    [schema, table],
  )

  return result.rows
}

async function readColumnStats(
  pool: pg.Pool,
  qualifiedName: string,
  columnName: string,
): Promise<{ nullRate: number | null; uniqueCount: number | null }> {
  const column = quoteIdentifier(columnName)
  const result = await pool.query<CountRow>(`
    select count(*)::bigint as total_count,
           count(*) filter (where ${column} is null)::bigint as null_count,
           count(distinct ${column})::bigint as unique_count
      from (
        select ${column}
          from ${qualifiedName}
         tablesample system (1)
         limit 1000
      ) sample_rows
  `)
  const row = result.rows[0]
  if (row == null) {
    return { nullRate: null, uniqueCount: null }
  }

  const totalCount = parseNullableInteger(row.total_count)
  const nullCount = parseNullableInteger(row.null_count)
  return {
    nullRate: totalCount == null || totalCount === 0 || nullCount == null ? null : nullCount / totalCount,
    uniqueCount: parseNullableInteger(row.unique_count),
  }
}

async function readColumnSamples(pool: pg.Pool, qualifiedName: string, columnName: string): Promise<unknown[]> {
  const column = quoteIdentifier(columnName)
  const result = await pool.query<SamplesRow>(`
    select array_agg(${column}) as samples
      from (
        select ${column}
          from ${qualifiedName}
         where ${column} is not null
         limit 5
      ) sample_values
  `)

  return result.rows[0]?.samples ?? []
}

function inferTableKind(columns: ColumnRow[], geometryFields: DataSourceGeometryField[]): 'line' | 'point' | 'unknown' {
  const columnNames = new Set(columns.map(column => column.column_name.toLowerCase()))
  const geometryTypes = geometryFields.map(field => field.geometryType?.toUpperCase() ?? '')

  if (columnNames.has('qdbm') && columnNames.has('zdbm')) {
    return 'line'
  }

  if (columnNames.has('gdbm') || geometryTypes.some(type => type.includes('POINT'))) {
    return 'point'
  }

  if (geometryTypes.some(type => type.includes('LINE'))) {
    return 'line'
  }

  return 'unknown'
}

function recommendFieldMapping(fieldName: string, tableKind: 'line' | 'point' | 'unknown'): string | undefined {
  const normalized = fieldName.toLowerCase()
  const commonRecommendations: Record<string, string> = {
    gg: 'spec',
  }
  const lineRecommendations: Record<string, string> = {
    guid: 'id',
    qdbm: 'startNodeId',
    zdbm: 'endNodeId',
    gwlx: 'pipeType',
    gs: 'owner',
    cz: 'material',
    qdndbg: 'startInvertElevation',
    zdndbg: 'endInvertElevation',
    qdms: 'startDepth',
    zdms: 'endDepth',
    lx: 'flowDirection',
    gdcd: 'length',
  }
  const pointRecommendations: Record<string, string> = {
    gdbm: 'id',
    lbmc: 'pointType',
    dmbg: 'surfaceElevation',
    jgcc: 'size',
    jgxz: 'shape',
    js: 'depth',
    jgcz: 'material',
    kj: 'diameter',
  }

  return tableKind === 'line'
    ? lineRecommendations[normalized] ?? commonRecommendations[normalized]
    : tableKind === 'point'
      ? pointRecommendations[normalized] ?? commonRecommendations[normalized]
      : commonRecommendations[normalized]
}

function parseNullableInteger(value: number | string | null | undefined): number | null {
  if (value == null) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}
