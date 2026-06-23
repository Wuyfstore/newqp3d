export type BuildTemplateStatus = 'draft' | 'validated' | 'published' | 'archived'

export type SizeUnit = 'auto' | 'mm' | 'cm' | 'm'
export type ElevationUnit = 'mm' | 'cm' | 'm'
export type LengthUnit = 'auto' | 'm' | 'km'
export type FlowUnknownStrategy = 'forward' | 'reverse' | 'unknown'
export type VersionNameStrategy = 'timestamp' | 'template-version' | 'manual'

export interface BuildTemplateTableConfig {
  schema: string
  table: string
  geometryField: string
  fieldMapping: Record<string, string>
}

export interface BuildTemplateUnits {
  pipeDiameter: SizeUnit
  pointSize: SizeUnit
  elevation: ElevationUnit
  depth: ElevationUnit
  length: LengthUnit
}

export interface BuildTemplateDefaults {
  pipeDiameterMm: number
  depthM: number
  pointSizeM: number
  surfaceElevationM: number
}

export interface BuildTemplateFlowRule {
  field: string
  forwardValues: string[]
  reverseValues: string[]
  unknownStrategy: FlowUnknownStrategy
}

export interface BuildTemplateLodConfig {
  maxFeaturesPerTile: number
  maxTileBytes: number
  maxDepth: number
  radialSegments: number
}

export interface BuildTemplateOutputConfig {
  versionNameStrategy: VersionNameStrategy
  includeAggregateMetadata: boolean
}

export interface BuildTemplate {
  id: string
  name: string
  description: string
  version: string
  status: BuildTemplateStatus
  dataSourceId: string
  lineTable: BuildTemplateTableConfig
  pointTable: BuildTemplateTableConfig
  units: BuildTemplateUnits
  defaults: BuildTemplateDefaults
  flowRule: BuildTemplateFlowRule
  lod: BuildTemplateLodConfig
  output: BuildTemplateOutputConfig
}

export interface BuildTemplateValidationError {
  path: string
  reason: string
}

export type BuildTemplateValidationResult =
  | { valid: true; template: BuildTemplate; errors: [] }
  | { valid: false; errors: BuildTemplateValidationError[] }

const TEMPLATE_STATUSES = ['draft', 'validated', 'published', 'archived'] as const
const SIZE_UNITS = ['auto', 'mm', 'cm', 'm'] as const
const ELEVATION_UNITS = ['mm', 'cm', 'm'] as const
const LENGTH_UNITS = ['auto', 'm', 'km'] as const
const FLOW_UNKNOWN_STRATEGIES = ['forward', 'reverse', 'unknown'] as const
const VERSION_NAME_STRATEGIES = ['timestamp', 'template-version', 'manual'] as const

export function createReferenceBuildTemplate(): BuildTemplate {
  return {
    id: 'reference-liyang-drainage-network',
    name: '溧阳供排水管网参考模板',
    description: '覆盖当前参考线表和点表的参数化构建模板',
    version: '1.0.0',
    status: 'draft',
    dataSourceId: 'local-qcwebserver',
    lineTable: {
      schema: 'public',
      table: 'sys_016_tancexbtjinfo_sde',
      geometryField: 'geom',
      fieldMapping: {
        id: 'guid',
        startNodeId: 'qdbm',
        endNodeId: 'zdbm',
        pipeType: 'gwlx',
        owner: 'gs',
        material: 'cz',
        spec: 'gg',
        startInvertElevation: 'qdndbg',
        endInvertElevation: 'zdndbg',
        startDepth: 'qdms',
        endDepth: 'zdms',
        flowDirection: 'lx',
        length: 'gdcd',
      },
    },
    pointTable: {
      schema: 'public',
      table: 'sys_016_tancedbtjinfo_sde',
      geometryField: 'geom',
      fieldMapping: {
        id: 'gdbm',
        pointType: 'lbmc',
        surfaceElevation: 'dmbg',
        size: 'jgcc',
        shape: 'jgxz',
        depth: 'js',
        material: 'jgcz',
        spec: 'gg',
        diameter: 'kj',
      },
    },
    units: {
      pipeDiameter: 'mm',
      pointSize: 'm',
      elevation: 'm',
      depth: 'm',
      length: 'm',
    },
    defaults: {
      pipeDiameterMm: 600,
      depthM: 2,
      pointSizeM: 1,
      surfaceElevationM: 0,
    },
    flowRule: {
      field: 'lx',
      forwardValues: ['1'],
      reverseValues: ['-1'],
      unknownStrategy: 'reverse',
    },
    lod: {
      maxFeaturesPerTile: 3000,
      maxTileBytes: 3_500_000,
      maxDepth: 8,
      radialSegments: 12,
    },
    output: {
      versionNameStrategy: 'timestamp',
      includeAggregateMetadata: true,
    },
  }
}

export function validateBuildTemplate(input: unknown): BuildTemplateValidationResult {
  const errors: BuildTemplateValidationError[] = []

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [{ path: '<root>', reason: 'required object' }],
    }
  }

  requireString(input, 'id', errors)
  requireString(input, 'name', errors)
  requireString(input, 'description', errors)
  requireString(input, 'version', errors)
  requireEnum(input, 'status', TEMPLATE_STATUSES, 'unsupported status', errors)
  requireString(input, 'dataSourceId', errors)

  validateTableConfig(input.lineTable, 'lineTable', errors)
  validateTableConfig(input.pointTable, 'pointTable', errors)
  validateUnits(input.units, errors)
  validateDefaults(input.defaults, errors)
  validateFlowRule(input.flowRule, errors)
  validateLod(input.lod, errors)
  validateOutput(input.output, errors)

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return { valid: true, template: input as unknown as BuildTemplate, errors: [] }
}

export function assertValidBuildTemplate(input: unknown): asserts input is BuildTemplate {
  const result = validateBuildTemplate(input)
  if (!result.valid) {
    const message = result.errors.map(error => `${error.path}: ${error.reason}`).join('; ')
    throw new Error(`Invalid build template: ${message}`)
  }
}

function validateTableConfig(input: unknown, path: string, errors: BuildTemplateValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, reason: 'required object' })
    return
  }

  requireString(input, 'schema', errors, `${path}.schema`)
  requireString(input, 'table', errors, `${path}.table`)
  requireString(input, 'geometryField', errors, `${path}.geometryField`)
  validateFieldMapping(input.fieldMapping, `${path}.fieldMapping`, errors)
}

function validateFieldMapping(input: unknown, path: string, errors: BuildTemplateValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path, reason: 'required object' })
    return
  }

  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push({ path: `${path}.${key}`, reason: 'required string' })
    }
  }
}

function validateUnits(input: unknown, errors: BuildTemplateValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path: 'units', reason: 'required object' })
    return
  }

  requireEnum(input, 'pipeDiameter', SIZE_UNITS, 'unsupported unit', errors, 'units.pipeDiameter')
  requireEnum(input, 'pointSize', SIZE_UNITS, 'unsupported unit', errors, 'units.pointSize')
  requireEnum(input, 'elevation', ELEVATION_UNITS, 'unsupported unit', errors, 'units.elevation')
  requireEnum(input, 'depth', ELEVATION_UNITS, 'unsupported unit', errors, 'units.depth')
  requireEnum(input, 'length', LENGTH_UNITS, 'unsupported unit', errors, 'units.length')
}

function validateDefaults(input: unknown, errors: BuildTemplateValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path: 'defaults', reason: 'required object' })
    return
  }

  requirePositiveNumber(input, 'pipeDiameterMm', errors, 'defaults.pipeDiameterMm')
  requirePositiveNumber(input, 'depthM', errors, 'defaults.depthM')
  requirePositiveNumber(input, 'pointSizeM', errors, 'defaults.pointSizeM')
  requireNumber(input, 'surfaceElevationM', errors, 'defaults.surfaceElevationM')
}

function validateFlowRule(input: unknown, errors: BuildTemplateValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path: 'flowRule', reason: 'required object' })
    return
  }

  requireString(input, 'field', errors, 'flowRule.field')
  requireStringArray(input, 'forwardValues', errors, 'flowRule.forwardValues')
  requireStringArray(input, 'reverseValues', errors, 'flowRule.reverseValues')
  requireEnum(input, 'unknownStrategy', FLOW_UNKNOWN_STRATEGIES, 'unsupported strategy', errors, 'flowRule.unknownStrategy')
}

function validateLod(input: unknown, errors: BuildTemplateValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path: 'lod', reason: 'required object' })
    return
  }

  requireMinInteger(input, 'maxFeaturesPerTile', 1, errors, 'lod.maxFeaturesPerTile')
  requireMinInteger(input, 'maxTileBytes', 1, errors, 'lod.maxTileBytes')
  requireMinInteger(input, 'maxDepth', 1, errors, 'lod.maxDepth')
  requireMinInteger(input, 'radialSegments', 3, errors, 'lod.radialSegments')
}

function validateOutput(input: unknown, errors: BuildTemplateValidationError[]): void {
  if (!isRecord(input)) {
    errors.push({ path: 'output', reason: 'required object' })
    return
  }

  requireEnum(input, 'versionNameStrategy', VERSION_NAME_STRATEGIES, 'unsupported strategy', errors, 'output.versionNameStrategy')
  requireBoolean(input, 'includeAggregateMetadata', errors, 'output.includeAggregateMetadata')
}

function requireString(
  input: Record<string, unknown>,
  path: string,
  errors: BuildTemplateValidationError[],
  errorPath = path,
): void {
  const value = readPath(input, path)
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ path: errorPath, reason: 'required string' })
  }
}

function requireStringArray(
  input: Record<string, unknown>,
  path: string,
  errors: BuildTemplateValidationError[],
  errorPath = path,
): void {
  const value = readPath(input, path)
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    errors.push({ path: errorPath, reason: 'required string array' })
  }
}

function requireBoolean(
  input: Record<string, unknown>,
  path: string,
  errors: BuildTemplateValidationError[],
  errorPath = path,
): void {
  if (typeof readPath(input, path) !== 'boolean') {
    errors.push({ path: errorPath, reason: 'required boolean' })
  }
}

function requireNumber(
  input: Record<string, unknown>,
  path: string,
  errors: BuildTemplateValidationError[],
  errorPath = path,
): void {
  if (typeof readPath(input, path) !== 'number' || !Number.isFinite(readPath(input, path))) {
    errors.push({ path: errorPath, reason: 'required finite number' })
  }
}

function requirePositiveNumber(
  input: Record<string, unknown>,
  path: string,
  errors: BuildTemplateValidationError[],
  errorPath = path,
): void {
  const value = readPath(input, path)
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    errors.push({ path: errorPath, reason: 'must be a number greater than 0' })
  }
}

function requireMinInteger(
  input: Record<string, unknown>,
  path: string,
  min: number,
  errors: BuildTemplateValidationError[],
  errorPath = path,
): void {
  const value = readPath(input, path)
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    errors.push({ path: errorPath, reason: `must be an integer greater than or equal to ${min}` })
  }
}

function requireEnum<T extends string>(
  input: Record<string, unknown>,
  path: string,
  allowedValues: readonly T[],
  reason: string,
  errors: BuildTemplateValidationError[],
  errorPath = path,
): void {
  const value = readPath(input, path)
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    errors.push({ path: errorPath, reason })
  }
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined
    }

    return current[segment]
  }, input)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
