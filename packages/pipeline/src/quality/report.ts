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
  totalLines: number
  totalPoints: number
  generatedLineFeatures: number
  generatedPointFeatures: number
  flags: QualityFlag[]
  groupCounts: Record<string, Record<string, number>>
  rowLimit?: number
  sridValidation?: SridValidationReport
  createdAt?: string
}

export interface QualityReport {
  versionId: string
  createdAt: string
  totalLines: number
  totalPoints: number
  generatedLineFeatures: number
  generatedPointFeatures: number
  flags: QualityFlag[]
  flagCounts: Record<string, number>
  groupCounts: Record<string, Record<string, number>>
  rowLimit?: number
  sridValidation?: SridValidationReport
}

export function createQualityReport(input: QualityReportInput): QualityReport {
  return {
    versionId: input.versionId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    totalLines: input.totalLines,
    totalPoints: input.totalPoints,
    generatedLineFeatures: input.generatedLineFeatures,
    generatedPointFeatures: input.generatedPointFeatures,
    flags: input.flags,
    flagCounts: countFlags(input.flags),
    groupCounts: input.groupCounts,
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
