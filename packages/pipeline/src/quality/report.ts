import type { SridCount } from '../datasource/postgis.js'

export interface QualityFlag {
  featureId: string
  flag: string
}

export interface SridValidationReport {
  expectedSrid: number
  lineSrids: SridCount[]
  pointSrids: SridCount[]
  lineUnexpectedSrids: SridCount[]
  pointUnexpectedSrids: SridCount[]
  lineMismatchCount: number
  pointMismatchCount: number
}

export interface QualityReportInput {
  versionId: string
  templateId?: string
  templateVersion?: string
  buildTaskId?: string
  totalLines: number
  totalPoints: number
  generatedLineFeatures: number
  generatedPointFeatures: number
  flags: QualityFlag[]
  groupCounts: Record<string, Record<string, number>>
  tileStats?: QualityReportTileStats
  rowLimit?: number
  sridValidation?: SridValidationReport
  createdAt?: string
}

export interface QualityReportTileStats {
  count: number
  maxBytes: number
  averageBytes: number
}

export interface QualityReport {
  versionId: string
  createdAt: string
  templateId?: string
  templateVersion?: string
  buildTaskId?: string
  recordCount: number
  successCount: number
  failureCount: number
  totalLines: number
  totalPoints: number
  generatedLineFeatures: number
  generatedPointFeatures: number
  flags: QualityFlag[]
  flagCounts: Record<string, number>
  groupCounts: Record<string, Record<string, number>>
  specParsingStats: Record<string, number>
  elevationSourceStats: Record<string, number>
  pointSizeSourceStats: Record<string, number>
  pointLineMatchStats: Record<string, number>
  tileStats?: QualityReportTileStats
  rowLimit?: number
  sridValidation?: SridValidationReport
}

export function createQualityReport(input: QualityReportInput): QualityReport {
  const flagCounts = countFlags(input.flags)
  const successCount = input.generatedLineFeatures + input.generatedPointFeatures
  const recordCount = input.totalLines + input.totalPoints
  return {
    versionId: input.versionId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.templateId === undefined ? {} : { templateId: input.templateId }),
    ...(input.templateVersion === undefined ? {} : { templateVersion: input.templateVersion }),
    ...(input.buildTaskId === undefined ? {} : { buildTaskId: input.buildTaskId }),
    recordCount,
    successCount,
    failureCount: Math.max(0, recordCount - successCount),
    totalLines: input.totalLines,
    totalPoints: input.totalPoints,
    generatedLineFeatures: input.generatedLineFeatures,
    generatedPointFeatures: input.generatedPointFeatures,
    flags: input.flags,
    flagCounts,
    groupCounts: input.groupCounts,
    specParsingStats: {
      defaulted: flagCounts['spec-defaulted'] ?? 0,
      parsed: Math.max(0, input.generatedLineFeatures - (flagCounts['spec-defaulted'] ?? 0)),
    },
    elevationSourceStats: input.groupCounts.elevationSource ?? {},
    pointSizeSourceStats: input.groupCounts.pointSizeSource ?? {},
    pointLineMatchStats: input.groupCounts.pointLineMatch ?? {},
    ...(input.tileStats === undefined ? {} : { tileStats: input.tileStats }),
    ...(input.rowLimit === undefined ? {} : { rowLimit: input.rowLimit }),
    ...(input.sridValidation === undefined ? {} : { sridValidation: input.sridValidation }),
  }
}

function countFlags(flags: QualityFlag[]): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const { flag } of flags) {
    counts[flag] = (counts[flag] ?? 0) + 1
  }

  return counts
}
