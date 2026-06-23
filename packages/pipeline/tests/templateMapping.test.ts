import { createReferenceBuildTemplate } from '@new-qp3d/shared'
import { describe, expect, it } from 'vitest'

import {
  mapTemplateLineRow,
  mapTemplatePointRow,
  pipelineConfigFromBuildTemplate,
} from '../src/templateMapping.js'

describe('pipeline template mapping', () => {
  it('maps custom line fields into the standard pipeline row shape', () => {
    const template = createReferenceBuildTemplate()
    template.lineTable.fieldMapping = {
      id: 'line_code',
      startNodeId: 'from_code',
      endNodeId: 'to_code',
      material: 'mat',
      spec: 'pipe_spec',
      startDepth: 'start_depth',
      endDepth: 'end_depth',
      startInvertElevation: 'start_elev',
      endInvertElevation: 'end_elev',
      pipeType: 'pipe_kind',
      owner: 'scope',
      flowDirection: 'direction',
      length: 'length_m',
    }
    template.flowRule.field = 'direction'

    expect(mapTemplateLineRow({
      line_code: 'L-1',
      from_code: 'P-1',
      to_code: 'P-2',
      mat: 'HDPE',
      pipe_spec: 'DN600',
      start_depth: '1.5',
      end_depth: 1.7,
      start_elev: '12.1',
      end_elev: 11.9,
      pipe_kind: '污水管',
      scope: '小区',
      direction: '-1',
      length_m: '33.4',
      geomWkbHex: '0102',
    }, template)).toEqual({
      guid: 'L-1',
      qdbm: 'P-1',
      zdbm: 'P-2',
      cz: 'HDPE',
      dmcc: null,
      gg: 'DN600',
      qdms: 1.5,
      zdms: 1.7,
      qdndbg: 12.1,
      zdndbg: 11.9,
      gwlx: '污水管',
      gs: '小区',
      msfs: null,
      lx: '-1',
      gdsx: null,
      gdcd: '33.4',
      geomWkbHex: '0102',
    })
  })

  it('normalizes template line units before downstream parsing', () => {
    const template = createReferenceBuildTemplate()
    template.flowRule.field = 'direction_code'
    template.units = {
      ...template.units,
      pipeDiameter: 'm',
      depth: 'cm',
      elevation: 'cm',
      length: 'km',
    }
    template.lineTable.fieldMapping = {
      id: 'line_code',
      diameter: 'diameter_m',
      startDepth: 'start_depth_cm',
      endDepth: 'end_depth_cm',
      startInvertElevation: 'start_elev_cm',
      endInvertElevation: 'end_elev_cm',
      length: 'length_km',
    }

    expect(mapTemplateLineRow({
      line_code: 'L-unit',
      diameter_m: '0.8',
      start_depth_cm: '150',
      end_depth_cm: '170',
      start_elev_cm: '1210',
      end_elev_cm: '1190',
      length_km: '0.0334',
      direction_code: 'F',
      geomWkbHex: '0102',
    }, template)).toEqual(expect.objectContaining({
      guid: 'L-unit',
      dmcc: 800,
      qdms: 1.5,
      zdms: 1.7,
      qdndbg: 12.1,
      zdndbg: 11.9,
      gdcd: '33.4',
      lx: 'F',
    }))
  })

  it('lets flow rule field override inherited flow direction mappings', () => {
    const template = createReferenceBuildTemplate()
    template.lineTable.fieldMapping = {
      ...template.lineTable.fieldMapping,
      flowDirection: 'legacy_lx',
    }
    template.flowRule.field = 'direction_code'

    expect(mapTemplateLineRow({
      guid: 'L-flow',
      legacy_lx: '-1',
      direction_code: 'F',
      geomWkbHex: '0102',
    }, template)).toEqual(expect.objectContaining({
      guid: 'L-flow',
      lx: 'F',
    }))
  })

  it('maps custom point fields into the standard pipeline row shape', () => {
    const template = createReferenceBuildTemplate()
    template.pointTable.fieldMapping = {
      id: 'node_code',
      pointType: 'node_type',
      surfaceElevation: 'surface_z',
      diameter: 'opening',
      depth: 'well_depth',
      spec: 'node_spec',
      material: 'cover_material',
      shape: 'cover_shape',
      size: 'cover_size',
    }

    expect(mapTemplatePointRow({
      node_code: 'N-1',
      node_type: '雨水井',
      surface_z: '18.2',
      opening: '700',
      well_depth: '2.5',
      node_spec: '700x700',
      cover_material: '铸铁',
      cover_shape: '圆形',
      cover_size: '1.2',
      geomWkbHex: '0101',
    }, template)).toEqual({
      gdbm: 'N-1',
      hzb: null,
      zzb: null,
      lbmc: '雨水井',
      dmbg: 18.2,
      kj: 700,
      js: 2.5,
      ms: null,
      gg: '700x700',
      jgcz: '铸铁',
      jgxz: '圆形',
      jgcc: '1.2',
      tag: null,
      geomWkbHex: '0101',
    })
  })

  it('normalizes template point size units into meters', () => {
    const template = createReferenceBuildTemplate()
    template.units = {
      ...template.units,
      pointSize: 'cm',
    }
    template.pointTable.fieldMapping = {
      id: 'node_code',
      diameter: 'opening_cm',
    }

    expect(mapTemplatePointRow({
      node_code: 'N-unit',
      opening_cm: '160',
      geomWkbHex: '0101',
    }, template)).toEqual(expect.objectContaining({
      gdbm: 'N-unit',
      kj: 1.6,
    }))
  })

  it('derives pipeline table, LOD, and default SRID config from a build template', () => {
    const template = createReferenceBuildTemplate()

    expect(pipelineConfigFromBuildTemplate({
      databaseUrl: 'postgres://example/qp3d',
      outputRoot: 'data/tiles',
      template,
    })).toMatchObject({
      databaseUrl: 'postgres://example/qp3d',
      lineTable: 'public.sys_016_tancexbtjinfo_sde',
      pointTable: 'public.sys_016_tancedbtjinfo_sde',
      expectedSrid: 3857,
      outputRoot: 'data/tiles',
      template,
      tileOptions: {
        maxFeaturesPerTile: 3000,
        maxTileBytes: 3500000,
        maxDepth: 8,
      },
    })
  })
})
