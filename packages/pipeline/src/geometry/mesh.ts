export interface Mesh {
  positions: Float32Array
  normals: Float32Array
  texcoords?: Float32Array
  colors?: Float32Array
  indices: Uint32Array
  featureIds: Uint32Array
}

export function createEmptyMesh(): Mesh {
  return {
    positions: new Float32Array(),
    normals: new Float32Array(),
    indices: new Uint32Array(),
    featureIds: new Uint32Array(),
  }
}

export function computeVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length)

  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] ?? 0
    const b = indices[index + 1] ?? 0
    const c = indices[index + 2] ?? 0
    const normal = triangleNormal(positions, a, b, c)

    addNormal(normals, a, normal)
    addNormal(normals, b, normal)
    addNormal(normals, c, normal)
  }

  for (let index = 0; index < normals.length; index += 3) {
    normalizeNormal(normals, index)
  }

  return normals
}

export function createBoxMesh(
  featureId: number,
  center: [number, number, number],
  size: [number, number, number],
): Mesh {
  const [cx, cy, cz] = center
  const [width, depth, height] = size
  const minX = cx - width / 2
  const maxX = cx + width / 2
  const minY = cy - depth / 2
  const maxY = cy + depth / 2
  const minZ = cz
  const maxZ = cz + height
  const positions = new Float32Array([
    minX, minY, minZ, maxX, minY, minZ, maxX, maxY, minZ, minX, maxY, minZ,
    minX, minY, maxZ, minX, maxY, maxZ, maxX, maxY, maxZ, maxX, minY, maxZ,
    minX, minY, minZ, minX, minY, maxZ, maxX, minY, maxZ, maxX, minY, minZ,
    maxX, minY, minZ, maxX, minY, maxZ, maxX, maxY, maxZ, maxX, maxY, minZ,
    maxX, maxY, minZ, maxX, maxY, maxZ, minX, maxY, maxZ, minX, maxY, minZ,
    minX, maxY, minZ, minX, maxY, maxZ, minX, minY, maxZ, minX, minY, minZ,
  ])
  const normals = new Float32Array([
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ])
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 6, 5, 4, 7, 6,
    8, 10, 9, 8, 11, 10,
    12, 14, 13, 12, 15, 14,
    16, 18, 17, 16, 19, 18,
    20, 22, 21, 20, 23, 22,
  ])
  const featureIds = new Uint32Array(positions.length / 3)
  featureIds.fill(featureId)

  return { positions, normals, indices, featureIds }
}

function triangleNormal(positions: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ax = positions[a * 3] ?? 0
  const ay = positions[a * 3 + 1] ?? 0
  const az = positions[a * 3 + 2] ?? 0
  const bx = positions[b * 3] ?? 0
  const by = positions[b * 3 + 1] ?? 0
  const bz = positions[b * 3 + 2] ?? 0
  const cx = positions[c * 3] ?? 0
  const cy = positions[c * 3 + 1] ?? 0
  const cz = positions[c * 3 + 2] ?? 0
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az

  return [
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  ]
}

function addNormal(normals: Float32Array, vertexIndex: number, normal: [number, number, number]): void {
  const index = vertexIndex * 3
  normals[index] = (normals[index] ?? 0) + normal[0]
  normals[index + 1] = (normals[index + 1] ?? 0) + normal[1]
  normals[index + 2] = (normals[index + 2] ?? 0) + normal[2]
}

function normalizeNormal(normals: Float32Array, index: number): void {
  const x = normals[index] ?? 0
  const y = normals[index + 1] ?? 0
  const z = normals[index + 2] ?? 0
  const length = Math.hypot(x, y, z)

  if (length === 0) {
    normals[index] = 0
    normals[index + 1] = 0
    normals[index + 2] = 1
    return
  }

  normals[index] = x / length
  normals[index + 1] = y / length
  normals[index + 2] = z / length
}
