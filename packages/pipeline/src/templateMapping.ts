import type {
  BuildTemplate,
  PipeLineRawRow,
  PointFacilityRawRow,
} from '@new-qp3d/shared'

import type { PipelineConfig } from './config.js'

export interface PipelineConfigFromBuildTemplateInput {
  databaseUrl: string
  outputRoot: string
  template: BuildTemplate
  expectedSrid?: number
}

export function pipelineConfigFromBuildTemplate(input: PipelineConfigFromBuildTemplateInput): PipelineConfig {
  return {
    databaseUrl: input.databaseUrl,
    lineTable: `${input.template.lineTable.schema}.${input.template.lineTable.table}`,
    pointTable: `${input.template.pointTable.schema}.${input.template.pointTable.table}`,
    expectedSrid: input.expectedSrid ?? 3857,
    outputRoot: input.outputRoot,
    template: input.template,
    tileOptions: {
      maxFeaturesPerTile: input.template.lod.maxFeaturesPerTile,
      maxTileBytes: input.template.lod.maxTileBytes,
      maxDepth: input.template.lod.maxDepth,
      radialSegments: input.template.lod.radialSegments,
    },
  }
}

export function mapTemplateLineRow(row: Record<string, unknown>, template: BuildTemplate): PipeLineRawRow {
  const mapping = template.lineTable.fieldMapping
  const flowField = template.flowRule.field || mapping.flowDirection
  return {
    guid: stringValue(row, mapping.id) ?? '',
    qdbm: stringValue(row, mapping.startNodeId),
    zdbm: stringValue(row, mapping.endNodeId),
    cz: stringValue(row, mapping.material),
    dmcc: sizeToMillimeters(numberValue(row, mapping.diameter), template.units.pipeDiameter),
    gg: stringValue(row, mapping.spec),
    qdms: lengthToMeters(numberValue(row, mapping.startDepth), template.units.depth),
    zdms: lengthToMeters(numberValue(row, mapping.endDepth), template.units.depth),
    qdndbg: lengthToMeters(numberValue(row, mapping.startInvertElevation), template.units.elevation),
    zdndbg: lengthToMeters(numberValue(row, mapping.endInvertElevation), template.units.elevation),
    gwlx: stringValue(row, mapping.pipeType),
    gs: stringValue(row, mapping.owner),
    msfs: stringValue(row, mapping.burialMode),
    lx: stringValue(row, flowField),
    gdsx: stringValue(row, mapping.pipeAttribute),
    gdcd: numberString(lengthToMeters(numberValue(row, mapping.length), template.units.length)),
    geomWkbHex: stringValue(row, 'geomWkbHex') ?? '',
  }
}

export function mapTemplatePointRow(row: Record<string, unknown>, template: BuildTemplate): PointFacilityRawRow {
  const mapping = template.pointTable.fieldMapping
  return {
    gdbm: stringValue(row, mapping.id),
    hzb: numberValue(row, mapping.x),
    zzb: numberValue(row, mapping.y),
    lbmc: stringValue(row, mapping.pointType),
    dmbg: lengthToMeters(numberValue(row, mapping.surfaceElevation), template.units.elevation),
    kj: sizeToMeters(numberValue(row, mapping.diameter), template.units.pointSize),
    js: lengthToMeters(numberValue(row, mapping.depth), template.units.depth),
    ms: lengthToMeters(numberValue(row, mapping.buriedDepth), template.units.depth),
    gg: stringValue(row, mapping.spec),
    jgcz: stringValue(row, mapping.material),
    jgxz: stringValue(row, mapping.shape),
    jgcc: stringValue(row, mapping.size),
    tag: stringValue(row, mapping.tag),
    geomWkbHex: stringValue(row, 'geomWkbHex') ?? '',
  }
}

function stringValue(row: Record<string, unknown>, fieldName: string | undefined): string | null {
  if (fieldName == null) {
    return null
  }

  const value = row[fieldName]
  if (value == null) {
    return null
  }

  return String(value)
}

function numberValue(row: Record<string, unknown>, fieldName: string | undefined): number | null {
  if (fieldName == null) {
    return null
  }

  const value = row[fieldName]
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function sizeToMillimeters(value: number | null, unit: BuildTemplate['units']['pipeDiameter']): number | null {
  if (value == null) {
    return null
  }

  switch (unit) {
    case 'm':
      return roundNumber(value * 1000)
    case 'cm':
      return roundNumber(value * 10)
    case 'mm':
      return roundNumber(value)
    case 'auto':
    default:
      if (value <= 10) {
        return roundNumber(value * 1000)
      }
      if (value <= 500) {
        return roundNumber(value * 10)
      }
      return roundNumber(value)
  }
}

function sizeToMeters(value: number | null, unit: BuildTemplate['units']['pointSize']): number | null {
  if (value == null) {
    return null
  }

  switch (unit) {
    case 'mm':
      return roundNumber(value / 1000)
    case 'cm':
      return roundNumber(value / 100)
    case 'm':
      return roundNumber(value)
    case 'auto':
    default:
      if (value > 100) {
        return roundNumber(value / 1000)
      }
      if (value > 10) {
        return roundNumber(value / 100)
      }
      return roundNumber(value)
  }
}

function lengthToMeters(value: number | null, unit: BuildTemplate['units']['elevation'] | BuildTemplate['units']['length']): number | null {
  if (value == null) {
    return null
  }

  switch (unit) {
    case 'km':
      return roundNumber(value * 1000)
    case 'cm':
      return roundNumber(value / 100)
    case 'mm':
      return roundNumber(value / 1000)
    case 'm':
    case 'auto':
    default:
      return roundNumber(value)
  }
}

function numberString(value: number | null): string | null {
  return value == null ? null : String(value)
}

function roundNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
