import type { Mesh } from '../geometry/mesh.js'
import type { FeatureMetadata } from './tilesetWriter.js'

interface FeatureMetadataSidecar {
  features: FeatureMetadata[]
}

interface BufferSpan {
  byteOffset: number
  byteLength: number
}

interface MetadataBuffer {
  data: Uint8Array
  span: BufferSpan
}

interface StructuralMetadataBundle {
  remappedFeatureIds: Uint32Array
  featureCount: number
  rootExtension: Record<string, unknown>
  binaryChunks: MetadataBuffer[]
}

const GLB_MAGIC = 0x46546C67
const GLB_VERSION = 2
const JSON_CHUNK_TYPE = 0x4E4F534A
const BIN_CHUNK_TYPE = 0x004E4942
const STRING_METADATA_FIELDS = [
  'businessId',
  'guid',
  'gdbm',
  'id',
  'type',
  'featureType',
  'pipeType',
  'pointType',
  'owner',
  'lx',
  'flowDirection',
  'qualityStatus',
] as const

export function writeGlb(mesh: Mesh, metadata: FeatureMetadata[]): Uint8Array {
  const positionSpan: BufferSpan = { byteOffset: 0, byteLength: mesh.positions.byteLength }
  const normals = normalizedNormalsForMesh(mesh)
  const normalSpan = alignSpan(positionSpan, normals.byteLength)
  const texcoords = normalizedTexcoordsForMesh(mesh)
  const texcoordSpan = texcoords ? alignSpan(normalSpan, texcoords.byteLength) : null
  const colors = normalizedColorsForMesh(mesh)
  const colorSpan = colors ? alignSpan(texcoordSpan ?? normalSpan, colors.byteLength) : null
  const featureStartSpan = colorSpan ?? texcoordSpan ?? normalSpan
  const metadataBundle = metadata.length > 0 ? createStructuralMetadataBundle(mesh, metadata, featureStartSpan) : null
  const featureSource = metadataBundle?.remappedFeatureIds ?? mesh.featureIds
  const featureSpan = alignSpan(featureStartSpan, featureSource.byteLength)
  const indexSpan = alignSpan(featureSpan, mesh.indices.byteLength)
  let currentSpan = indexSpan
  const metadataBuffers = new Array<MetadataBuffer>()

  for (const buffer of metadataBundle?.binaryChunks ?? []) {
    const span = alignSpan(currentSpan, buffer.data.byteLength)
    metadataBuffers.push({ data: buffer.data, span })
    currentSpan = span
  }

  const binLength = align4(currentSpan.byteOffset + currentSpan.byteLength)
  const binChunk = new Uint8Array(binLength)

  binChunk.set(asBytes(mesh.positions), positionSpan.byteOffset)
  binChunk.set(asBytes(normals), normalSpan.byteOffset)
  if (texcoords && texcoordSpan)
    binChunk.set(asBytes(texcoords), texcoordSpan.byteOffset)
  if (colors && colorSpan)
    binChunk.set(asBytes(colors), colorSpan.byteOffset)
  binChunk.set(asBytes(featureSource), featureSpan.byteOffset)
  binChunk.set(asBytes(mesh.indices), indexSpan.byteOffset)
  for (const buffer of metadataBuffers)
    binChunk.set(buffer.data, buffer.span.byteOffset)

  const gltf = createGltfJson(
    mesh,
    metadata,
    positionSpan,
    normalSpan,
    texcoordSpan,
    colorSpan,
    featureSpan,
    indexSpan,
    metadataBundle,
    metadataBuffers,
    binLength,
  )
  const jsonChunk = paddedJsonChunk(gltf)
  const totalLength = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength
  const glb = new Uint8Array(totalLength)
  const view = new DataView(glb.buffer)

  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, GLB_VERSION, true)
  view.setUint32(8, totalLength, true)
  view.setUint32(12, jsonChunk.byteLength, true)
  view.setUint32(16, JSON_CHUNK_TYPE, true)
  glb.set(jsonChunk, 20)

  const binHeaderOffset = 20 + jsonChunk.byteLength
  view.setUint32(binHeaderOffset, binChunk.byteLength, true)
  view.setUint32(binHeaderOffset + 4, BIN_CHUNK_TYPE, true)
  glb.set(binChunk, binHeaderOffset + 8)

  return glb
}

export function writeFeatureMetadataSidecar(metadata: FeatureMetadata[]): FeatureMetadataSidecar {
  return {
    features: metadata,
  }
}

function createGltfJson(
  mesh: Mesh,
  metadata: FeatureMetadata[],
  positionSpan: BufferSpan,
  normalSpan: BufferSpan,
  texcoordSpan: BufferSpan | null,
  colorSpan: BufferSpan | null,
  featureSpan: BufferSpan,
  indexSpan: BufferSpan,
  metadataBundle: StructuralMetadataBundle | null,
  metadataBuffers: MetadataBuffer[],
  binLength: number,
): Record<string, unknown> {
  const bufferViews: Array<Record<string, number>> = [
    { buffer: 0, byteOffset: positionSpan.byteOffset, byteLength: positionSpan.byteLength, target: 34962 },
    { buffer: 0, byteOffset: normalSpan.byteOffset, byteLength: normalSpan.byteLength, target: 34962 },
  ]
  const texcoordAccessorIndex = texcoordSpan ? bufferViews.length : undefined
  if (texcoordSpan)
    bufferViews.push({ buffer: 0, byteOffset: texcoordSpan.byteOffset, byteLength: texcoordSpan.byteLength, target: 34962 })
  const colorAccessorIndex = colorSpan ? bufferViews.length : undefined
  if (colorSpan)
    bufferViews.push({ buffer: 0, byteOffset: colorSpan.byteOffset, byteLength: colorSpan.byteLength, target: 34962 })
  const featureAccessorIndex = bufferViews.length
  bufferViews.push({ buffer: 0, byteOffset: featureSpan.byteOffset, byteLength: featureSpan.byteLength, target: 34962 })
  const indexAccessorIndex = bufferViews.length
  bufferViews.push({ buffer: 0, byteOffset: indexSpan.byteOffset, byteLength: indexSpan.byteLength, target: 34963 })
  const metadataBufferViewBase = bufferViews.length
  for (const buffer of metadataBuffers)
    bufferViews.push({ buffer: 0, byteOffset: buffer.span.byteOffset, byteLength: buffer.span.byteLength })

  const primitive: Record<string, unknown> = {
    attributes: {
      POSITION: 0,
      NORMAL: 1,
      ...(texcoordAccessorIndex !== undefined ? { TEXCOORD_0: texcoordAccessorIndex } : {}),
      ...(colorAccessorIndex !== undefined ? { COLOR_0: colorAccessorIndex } : {}),
      _FEATURE_ID_0: featureAccessorIndex,
    },
    indices: indexAccessorIndex,
    material: 0,
    mode: 4,
    extras: {
      featureMetadata: metadata,
      featureProperties: featurePropertyLookup(metadata),
    },
  }

  const gltf: Record<string, unknown> = {
    asset: {
      version: '2.0',
      generator: '@new-qp3d/pipeline',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          primitive,
        ],
      },
    ],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.15,
          roughnessFactor: 0.38,
        },
      },
    ],
    buffers: [{ byteLength: binLength }],
    bufferViews,
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: mesh.positions.length / 3,
        type: 'VEC3',
        min: positionMin(mesh.positions),
        max: positionMax(mesh.positions),
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: mesh.positions.length / 3,
        type: 'VEC3',
      },
    ],
  }

  if (texcoordSpan) {
    const accessors = gltf.accessors as Array<Record<string, unknown>>
    accessors.push({
      bufferView: texcoordAccessorIndex,
      byteOffset: 0,
      componentType: 5126,
      count: mesh.positions.length / 3,
      type: 'VEC2',
    })
  }
  if (colorSpan) {
    const accessors = gltf.accessors as Array<Record<string, unknown>>
    accessors.push({
      bufferView: colorAccessorIndex,
      byteOffset: 0,
      componentType: 5121,
      count: mesh.positions.length / 3,
      normalized: true,
      type: 'VEC4',
    })
  }
  {
    const accessors = gltf.accessors as Array<Record<string, unknown>>
    accessors.push(
      {
        bufferView: featureAccessorIndex,
        byteOffset: 0,
        componentType: 5125,
        count: mesh.featureIds.length,
        type: 'SCALAR',
      },
      {
        bufferView: indexAccessorIndex,
        byteOffset: 0,
        componentType: 5125,
        count: mesh.indices.length,
        type: 'SCALAR',
      },
    )
  }

  if (metadataBundle) {
    primitive.extensions = {
      EXT_mesh_features: {
        featureIds: [
          {
            attribute: 0,
            propertyTable: 0,
            featureCount: metadataBundle.featureCount,
          },
        ],
      },
    }
    gltf.extensionsUsed = ['EXT_mesh_features', 'EXT_structural_metadata']
    gltf.extensions = {
      EXT_structural_metadata: remapMetadataBufferViews(metadataBundle.rootExtension, metadataBufferViewBase),
    }
  }

  return gltf
}

function featurePropertyLookup(metadata: FeatureMetadata[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(metadata.map(feature => [
    String(feature.featureId),
    {
      businessId: feature.businessId,
      ...feature.properties,
    },
  ]))
}

function alignSpan(previous: BufferSpan, byteLength = 0): BufferSpan {
  return {
    byteOffset: align4(previous.byteOffset + previous.byteLength),
    byteLength,
  }
}

function align4(value: number): number {
  return (value + 3) & ~3
}

function asBytes(value: Float32Array | Uint32Array | Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function normalizedNormalsForMesh(mesh: Mesh): Float32Array {
  if (mesh.normals.length === mesh.positions.length)
    return mesh.normals

  const normals = new Float32Array(mesh.positions.length)
  for (let index = 0; index < normals.length; index += 3) {
    normals[index] = 0
    normals[index + 1] = 0
    normals[index + 2] = 1
  }
  return normals
}

function normalizedTexcoordsForMesh(mesh: Mesh): Float32Array | null {
  const expectedLength = (mesh.positions.length / 3) * 2
  if (mesh.texcoords?.length === expectedLength)
    return mesh.texcoords

  return null
}

function normalizedColorsForMesh(mesh: Mesh): Uint8Array | null {
  const expectedLength = (mesh.positions.length / 3) * 4
  if (mesh.colors?.length === expectedLength) {
    const colors = new Uint8Array(mesh.colors.length)
    for (let index = 0; index < mesh.colors.length; index += 1)
      colors[index] = Math.round(Math.min(Math.max(mesh.colors[index] ?? 0, 0), 1) * 255)
    return colors
  }

  return null
}

function createStructuralMetadataBundle(
  mesh: Mesh,
  metadata: FeatureMetadata[],
  startSpan: BufferSpan,
): StructuralMetadataBundle {
  const rowIndexByFeatureId = new Map<number, number>()
  const remappedFeatureIds = new Uint32Array(mesh.featureIds.length)

  metadata.forEach((feature, index) => {
    rowIndexByFeatureId.set(feature.featureId, index)
  })

  for (let index = 0; index < mesh.featureIds.length; index += 1) {
    const featureId = mesh.featureIds[index] ?? 0
    remappedFeatureIds[index] = rowIndexByFeatureId.get(featureId) ?? 0
  }

  const binaryChunks: MetadataBuffer[] = []
  const propertyDefinitions: Record<string, Record<string, unknown>> = {}
  const propertyTableProperties: Record<string, { values: number, stringOffsets?: number }> = {}
  let currentSpan = startSpan

  const sourceIds = new Uint32Array(metadata.map(feature => feature.featureId))
  const sourceIdBuffer = asBytes(sourceIds).slice()
  currentSpan = alignSpan(currentSpan, sourceIdBuffer.byteLength)
  binaryChunks.push({ data: sourceIdBuffer, span: currentSpan })
  propertyDefinitions.sourceFeatureId = { type: 'SCALAR', componentType: 'UINT32' }
  propertyTableProperties.sourceFeatureId = { values: binaryChunks.length - 1 }

  const stringFields = new Set<string>(STRING_METADATA_FIELDS)

  for (const field of stringFields) {
    const values = metadata.map((feature) => {
      if (field === 'businessId')
        return feature.businessId

      const value = feature.properties[field]
      return typeof value === 'string' ? value : ''
    })
    const { valuesBuffer, offsetsBuffer } = encodeStringProperty(values)

    currentSpan = alignSpan(currentSpan, valuesBuffer.byteLength)
    binaryChunks.push({ data: valuesBuffer, span: currentSpan })
    currentSpan = alignSpan(currentSpan, offsetsBuffer.byteLength)
    binaryChunks.push({ data: offsetsBuffer, span: currentSpan })

    propertyDefinitions[field] = { type: 'STRING' }
    propertyTableProperties[field] = {
      values: binaryChunks.length - 2,
      stringOffsets: binaryChunks.length - 1,
    }
  }

  return {
    remappedFeatureIds,
    featureCount: metadata.length,
    binaryChunks,
    rootExtension: {
      schema: {
        id: 'pipe-network-feature-metadata',
        classes: {
          pipeNetworkFeature: {
            properties: propertyDefinitions,
          },
        },
      },
      propertyTables: [
        {
          name: 'pipeNetworkFeatures',
          class: 'pipeNetworkFeature',
          count: metadata.length,
          properties: propertyTableProperties,
        },
      ],
    },
  }
}

function encodeStringProperty(values: string[]): { valuesBuffer: Uint8Array, offsetsBuffer: Uint8Array } {
  const encoder = new TextEncoder()
  const encodedValues = values.map(value => encoder.encode(value))
  const totalLength = encodedValues.reduce((sum, value) => sum + value.byteLength, 0)
  const valuesBuffer = new Uint8Array(totalLength)
  const offsets = new Uint32Array(values.length + 1)
  let byteOffset = 0

  encodedValues.forEach((value, index) => {
    valuesBuffer.set(value, byteOffset)
    offsets[index] = byteOffset
    byteOffset += value.byteLength
  })
  offsets[values.length] = byteOffset

  return {
    valuesBuffer,
    offsetsBuffer: asBytes(offsets).slice(),
  }
}

function remapMetadataBufferViews(value: unknown, baseIndex: number): unknown {
  if (Array.isArray(value))
    return value.map(item => remapMetadataBufferViews(item, baseIndex))

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(objectValue)) {
      if ((key === 'values' || key === 'stringOffsets') && typeof entry === 'number') {
        result[key] = baseIndex + entry
        continue
      }
      result[key] = remapMetadataBufferViews(entry, baseIndex)
    }
    return result
  }

  return value
}

function paddedJsonChunk(value: Record<string, unknown>): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  const length = align4(encoded.byteLength)
  const chunk = new Uint8Array(length)
  chunk.fill(0x20)
  chunk.set(encoded)
  return chunk
}

function positionMin(positions: Float32Array): [number, number, number] {
  if (positions.length === 0)
    return [0, 0, 0]

  const min: [number, number, number] = [positions[0] ?? 0, positions[1] ?? 0, positions[2] ?? 0]
  for (let index = 3; index < positions.length; index += 3) {
    min[0] = Math.min(min[0], positions[index] ?? min[0])
    min[1] = Math.min(min[1], positions[index + 1] ?? min[1])
    min[2] = Math.min(min[2], positions[index + 2] ?? min[2])
  }
  return min
}

function positionMax(positions: Float32Array): [number, number, number] {
  if (positions.length === 0)
    return [0, 0, 0]

  const max: [number, number, number] = [positions[0] ?? 0, positions[1] ?? 0, positions[2] ?? 0]
  for (let index = 3; index < positions.length; index += 3) {
    max[0] = Math.max(max[0], positions[index] ?? max[0])
    max[1] = Math.max(max[1], positions[index + 1] ?? max[1])
    max[2] = Math.max(max[2], positions[index + 2] ?? max[2])
  }
  return max
}
