import {
  type BuildTemplate,
  validateBuildTemplate,
} from '@new-qp3d/shared'

import type { ApiRepository, DataSourceFieldProfile, DataSourceTableProfile } from '../server.js'

export type PreflightSeverity = 'error' | 'warning' | 'info'

export interface PreflightCheck {
  severity: PreflightSeverity
  code: string
  path: string
  message: string
  value?: unknown
}

export interface PreflightReport {
  templateId: string
  templateVersion: string
  canBuild: boolean
  summary: {
    errors: number
    warnings: number
    infos: number
  }
  checks: PreflightCheck[]
}

export async function runBuildTemplatePreflight(
  repository: ApiRepository,
  input: unknown,
): Promise<PreflightReport> {
  const validation = validateBuildTemplate(input)
  if (!validation.valid) {
    throw new BuildTemplatePreflightValidationError(validation.errors)
  }

  const template = validation.template
  const [lineProfile, pointProfile] = await Promise.all([
    repository.getTableProfile(template.lineTable.schema, template.lineTable.table),
    repository.getTableProfile(template.pointTable.schema, template.pointTable.table),
  ])
  const checks: PreflightCheck[] = [
    ...checkGeometry(template, lineProfile, 'lineTable', 'LINE'),
    ...checkGeometry(template, pointProfile, 'pointTable', 'POINT'),
    ...checkFieldMapping(template.lineTable.fieldMapping, lineProfile, 'lineTable'),
    ...checkFieldMapping(template.pointTable.fieldMapping, pointProfile, 'pointTable'),
    ...checkSrid(lineProfile, 'lineTable'),
    ...checkSrid(pointProfile, 'pointTable'),
    ...checkCoverage(template, lineProfile, pointProfile),
  ]
  const summary = {
    errors: checks.filter(check => check.severity === 'error').length,
    warnings: checks.filter(check => check.severity === 'warning').length,
    infos: checks.filter(check => check.severity === 'info').length,
  }

  return {
    templateId: template.id,
    templateVersion: template.version,
    canBuild: summary.errors === 0,
    summary,
    checks,
  }
}

export class BuildTemplatePreflightValidationError extends Error {
  constructor(readonly validationErrors: Array<{ path: string; reason: string }>) {
    super('Invalid build template')
    this.name = 'BuildTemplatePreflightValidationError'
  }
}

function checkGeometry(
  template: BuildTemplate,
  profile: DataSourceTableProfile,
  tablePath: 'lineTable' | 'pointTable',
  expectedType: 'LINE' | 'POINT',
): PreflightCheck[] {
  const configuredField = template[tablePath].geometryField
  const geometry = profile.geometryFields.find(field => field.name === configuredField)
  if (geometry == null) {
    return [{
      severity: 'error',
      code: 'geometry-field-missing',
      path: `${tablePath}.geometryField`,
      message: `几何字段 ${configuredField} 不存在`,
      value: configuredField,
    }]
  }

  const geometryType = geometry.geometryType?.toUpperCase() ?? ''
  if (!geometryType.includes(expectedType)) {
    return [{
      severity: 'error',
      code: 'geometry-type-incompatible',
      path: `${tablePath}.geometryField`,
      message: `几何类型 ${geometry.geometryType ?? '未知'} 与 ${expectedType} 不匹配`,
      value: geometry.geometryType,
    }]
  }

  return [{
    severity: 'info',
    code: tablePath === 'lineTable' ? 'line-geometry-compatible' : 'point-geometry-compatible',
    path: `${tablePath}.geometryField`,
    message: `几何字段 ${configuredField} 可用`,
    value: geometry.geometryType,
  }]
}

function checkFieldMapping(
  mapping: Record<string, string>,
  profile: DataSourceTableProfile,
  tablePath: 'lineTable' | 'pointTable',
): PreflightCheck[] {
  const fieldNames = new Set(profile.fields.map(field => field.name))
  const checks: PreflightCheck[] = []

  for (const [logicalField, physicalField] of Object.entries(mapping)) {
    if (!fieldNames.has(physicalField)) {
      checks.push({
        severity: 'error',
        code: 'mapped-field-missing',
        path: `${tablePath}.fieldMapping.${logicalField}`,
        message: `映射字段 ${physicalField} 不存在`,
        value: physicalField,
      })
    }
  }

  return checks
}

function checkSrid(profile: DataSourceTableProfile, tablePath: 'lineTable' | 'pointTable'): PreflightCheck[] {
  return profile.geometryFields
    .filter(field => field.srid == null || field.srid <= 0)
    .map(field => ({
      severity: 'warning',
      code: 'srid-unknown',
      path: `${tablePath}.geometryField`,
      message: `几何字段 ${field.name} 缺少 SRID 信息`,
      value: field.srid,
    }))
}

function checkCoverage(
  template: BuildTemplate,
  lineProfile: DataSourceTableProfile,
  pointProfile: DataSourceTableProfile,
): PreflightCheck[] {
  const checks: PreflightCheck[] = []
  checks.push(...checkNullRate(lineProfile, template.lineTable.fieldMapping.id, 'lineTable.fieldMapping.id', 'line-id-null-rate-high', 0.01))
  checks.push(...checkNullRate(lineProfile, template.lineTable.fieldMapping.startNodeId, 'lineTable.fieldMapping.startNodeId', 'start-node-null-rate-high', 0.05))
  checks.push(...checkNullRate(lineProfile, template.lineTable.fieldMapping.endNodeId, 'lineTable.fieldMapping.endNodeId', 'end-node-null-rate-high', 0.05))
  checks.push(...checkNullRate(lineProfile, template.lineTable.fieldMapping.spec, 'lineTable.fieldMapping.spec', 'pipe-spec-coverage-low', 0.35))
  checks.push(...checkNullRate(pointProfile, template.pointTable.fieldMapping.size, 'pointTable.fieldMapping.size', 'point-size-coverage-low', 0.6))
  checks.push(...checkNullRate(pointProfile, template.pointTable.fieldMapping.surfaceElevation, 'pointTable.fieldMapping.surfaceElevation', 'point-elevation-coverage-low', 0.6))
  return checks
}

function checkNullRate(
  profile: DataSourceTableProfile,
  fieldName: string | undefined,
  path: string,
  code: string,
  warningThreshold: number,
): PreflightCheck[] {
  const field = findField(profile, fieldName)
  if (field == null || field.nullRate == null || field.nullRate <= warningThreshold) {
    return []
  }

  return [{
    severity: 'warning',
    code,
    path,
    message: `字段 ${fieldName} 空值率 ${(field.nullRate * 100).toFixed(1)}%`,
    value: field.nullRate,
  }]
}

function findField(profile: DataSourceTableProfile, fieldName: string | undefined): DataSourceFieldProfile | undefined {
  if (fieldName == null) {
    return undefined
  }

  return profile.fields.find(field => field.name === fieldName)
}
