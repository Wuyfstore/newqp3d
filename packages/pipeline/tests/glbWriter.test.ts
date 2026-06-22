import { describe, expect, it } from 'vitest'
import { writeFeatureMetadataSidecar, writeGlb } from '../src/tiles/glbWriter.js'

describe('writeGlb', () => {
  it('writes a valid binary glTF header with JSON and BIN chunks', () => {
    const glb = writeGlb(
      {
        positions: new Float32Array([
          0, 0, 0,
          1, 0, 0,
          0, 1, 0,
        ]),
        indices: new Uint32Array([0, 1, 2]),
        featureIds: new Uint32Array([42, 42, 42]),
      },
      [{ featureId: 42, businessId: 'sample-rain-1', properties: { gwlx: '雨水管' } }],
    )

    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
    expect(String.fromCharCode(...glb.slice(0, 4))).toBe('glTF')
    expect(view.getUint32(4, true)).toBe(2)
    expect(view.getUint32(8, true)).toBe(glb.byteLength)
    expect(view.getUint32(16, true)).toBe(0x4E4F534A)
    expect(glb).toContain(0x42)
    expect(String.fromCharCode(...glb)).toContain('POSITION')
    expect(String.fromCharCode(...glb)).toContain('_FEATURE_ID_0')
  })

  it('describes feature id buffers and Cesium-readable structural metadata', () => {
    const metadata = [{
      featureId: 42,
      businessId: 'sample-rain-1',
      properties: {
        guid: 'sample-rain-1',
        type: 'line',
        pipeType: '雨水管',
        owner: '市政',
        qualityStatus: 'normal',
      },
    }]
    const glb = writeGlb(
      {
        positions: new Float32Array([
          0, 0, 0,
          1, 0, 0,
          0, 1, 0,
        ]),
        indices: new Uint32Array([0, 1, 2]),
        featureIds: new Uint32Array([42, 42, 42]),
      },
      metadata,
    )
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
    const jsonLength = view.getUint32(12, true)
    const jsonText = new TextDecoder().decode(glb.slice(20, 20 + jsonLength)).trimEnd()
    const json = JSON.parse(jsonText) as {
      extensionsUsed: string[]
      extensions: {
        EXT_structural_metadata: {
          schema: { classes: { pipeNetworkFeature: { properties: Record<string, { type: string }> } } }
          propertyTables: Array<{
            class: string
            count: number
            properties: Record<string, { values: number, stringOffsets?: number }>
          }>
        }
      }
      bufferViews: Array<{ byteLength: number }>
      meshes: Array<{
        primitives: Array<{
          extensions: { EXT_mesh_features: { featureIds: Array<{ attribute: number, propertyTable: number, featureCount: number }> } }
          extras: { featureMetadata: typeof metadata, featureProperties: Record<string, Record<string, unknown>> }
        }>
      }>
    }

    expect(json.bufferViews[1]?.byteLength).toBe(12)
    expect(json.bufferViews[2]?.byteLength).toBe(12)
    expect(json.meshes[0]?.primitives[0]?.extras.featureMetadata).toEqual(metadata)
    expect(json.meshes[0]?.primitives[0]?.extras.featureProperties).toEqual({
      '42': {
        businessId: 'sample-rain-1',
        guid: 'sample-rain-1',
        type: 'line',
        pipeType: '雨水管',
        owner: '市政',
        qualityStatus: 'normal',
      },
    })
    expect(json.extensionsUsed).toEqual(expect.arrayContaining([
      'EXT_mesh_features',
      'EXT_structural_metadata',
    ]))
    expect(json.meshes[0]?.primitives[0]?.extensions.EXT_mesh_features.featureIds[0])
      .toEqual({ attribute: 0, propertyTable: 0, featureCount: 1 })
    expect(json.extensions.EXT_structural_metadata.propertyTables[0]?.count).toBe(1)
    expect(json.extensions.EXT_structural_metadata.propertyTables[0]?.class).toBe('pipeNetworkFeature')
    expect(json.extensions.EXT_structural_metadata.propertyTables[0]?.properties.pipeType)
      .toEqual(expect.objectContaining({ values: expect.any(Number), stringOffsets: expect.any(Number) }))
    expect(Object.keys(json.extensions.EXT_structural_metadata.schema.classes.pipeNetworkFeature.properties))
      .toEqual(expect.arrayContaining([
        'businessId',
        'sourceFeatureId',
        'guid',
        'gdbm',
        'id',
        'type',
        'featureType',
        'pipeType',
        'pointType',
        'owner',
        'qualityStatus',
      ]))
    expect(json.extensions.EXT_structural_metadata.schema.classes.pipeNetworkFeature.properties.qualityStatus)
      .toEqual({ type: 'STRING' })
  })

  it('remaps source feature ids to property table row indexes while preserving original ids in metadata', () => {
    const metadata = [
      {
        featureId: 42,
        businessId: 'sample-rain-1',
        properties: {
          guid: 'sample-rain-1',
          pipeType: 'rain',
        },
      },
      {
        featureId: 99,
        businessId: 'sample-rain-2',
        properties: {
          guid: 'sample-rain-2',
          pipeType: 'sewer',
        },
      },
    ]
    const glb = writeGlb(
      {
        positions: new Float32Array([
          0, 0, 0,
          1, 0, 0,
          0, 1, 0,
          1, 1, 0,
        ]),
        indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
        featureIds: new Uint32Array([42, 42, 99, 99]),
      },
      metadata,
    )
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
    const jsonLength = view.getUint32(12, true)
    const jsonText = new TextDecoder().decode(glb.slice(20, 20 + jsonLength)).trimEnd()
    const json = JSON.parse(jsonText) as {
      accessors: Array<{ bufferView: number, byteOffset?: number, count: number }>
      bufferViews: Array<{ byteOffset: number, byteLength: number }>
      extensions: {
        EXT_structural_metadata: {
          propertyTables: Array<{
            properties: Record<string, { values: number, stringOffsets?: number }>
          }>
        }
      }
    }

    const featureAccessor = json.accessors[1]
    const featureBufferView = json.bufferViews[featureAccessor!.bufferView]
    const binOffset = 20 + jsonLength + 8
    const featureIds = new Uint32Array(
      glb.buffer.slice(
        glb.byteOffset + binOffset + featureBufferView!.byteOffset + (featureAccessor!.byteOffset ?? 0),
        glb.byteOffset + binOffset + featureBufferView!.byteOffset + featureBufferView!.byteLength,
      ),
    )

    expect(Array.from(featureIds)).toEqual([0, 0, 1, 1])
    expect(json.extensions.EXT_structural_metadata.propertyTables[0]?.properties.sourceFeatureId)
      .toEqual(expect.objectContaining({ values: expect.any(Number) }))
  })
})

describe('writeFeatureMetadataSidecar', () => {
  it('serializes stable business identifiers for API lookup', () => {
    expect(writeFeatureMetadataSidecar([
      {
        featureId: 42,
        businessId: 'sample-rain-1',
        properties: {
          guid: 'sample-rain-1',
          qdbm: 'N1',
          pipeType: '雨水管',
        },
      },
    ])).toEqual({
      features: [
        {
          featureId: 42,
          businessId: 'sample-rain-1',
          properties: {
            guid: 'sample-rain-1',
            qdbm: 'N1',
            pipeType: '雨水管',
          },
        },
      ],
    })
  })
})
