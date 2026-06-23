import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUILD_TEMPLATE_SCHEMA_VERSION,
  createReferenceBuildTemplate,
  validateBuildTemplate,
} from '../src/buildTemplate.js'

describe('build template schema', () => {
  it('validates the current reference line and point table template', () => {
    const result = validateBuildTemplate(createReferenceBuildTemplate())

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    if (result.valid) {
      expect(result.template.lineTable.table).toBe('sys_016_tancexbtjinfo_sde')
      expect(result.template.pointTable.table).toBe('sys_016_tancedbtjinfo_sde')
      expect(result.template.flowRule.field).toBe('lx')
      expect(result.template.defaults.nearestPointMatchToleranceM).toBe(2)
    }
  })

  it('validates after a JSON serialization round trip', () => {
    const parsed = JSON.parse(JSON.stringify(createReferenceBuildTemplate()))
    const result = validateBuildTemplate(parsed)

    expect(result.valid).toBe(true)
  })

  it('exposes the supported migration schema version for template import and export', () => {
    expect(BUILD_TEMPLATE_SCHEMA_VERSION).toBe('build-template.v1')
  })

  it('reports missing required fields with a concrete path and reason', () => {
    const template = createReferenceBuildTemplate()
    const invalid = {
      ...template,
      lineTable: {
        ...template.lineTable,
        geometryField: undefined,
      },
    }

    const result = validateBuildTemplate(invalid)

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: 'lineTable.geometryField',
      reason: 'required string',
    })
  })

  it('rejects unsupported units with the invalid field path', () => {
    const template = createReferenceBuildTemplate()
    const invalid = {
      ...template,
      units: {
        ...template.units,
        pipeDiameter: 'feet',
      },
    }

    const result = validateBuildTemplate(invalid)

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: 'units.pipeDiameter',
      reason: 'unsupported unit',
    })
  })

  it('rejects illegal LOD parameters with the invalid field path', () => {
    const template = createReferenceBuildTemplate()
    const invalid = {
      ...template,
      lod: {
        ...template.lod,
        maxDepth: 0,
      },
    }

    const result = validateBuildTemplate(invalid)

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: 'lod.maxDepth',
      reason: 'must be an integer greater than or equal to 1',
    })
  })

  it('rejects illegal nearest point match tolerance values', () => {
    const template = createReferenceBuildTemplate()
    const invalid = {
      ...template,
      defaults: {
        ...template.defaults,
        nearestPointMatchToleranceM: -1,
      },
    }

    const result = validateBuildTemplate(invalid)

    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: 'defaults.nearestPointMatchToleranceM',
      reason: 'must be a number greater than or equal to 0',
    })
  })

  it('validates the example fixture template', async () => {
    const fixturePath = resolve(import.meta.dirname, '../../../fixtures/pipeline/reference-build-template.json')
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))

    const result = validateBuildTemplate(fixture)

    expect(result.valid).toBe(true)
  })
})
