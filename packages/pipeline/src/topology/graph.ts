export interface NormalizedLine {
  guid: string
  qdbm: string | null
  zdbm: string | null
  coordinates: Array<[number, number]>
  gwlx: string | null
  gs: string | null
  cz: string | null
  gg: string | null
}

export interface TopologyGraph {
  degreeByNode: Map<string, number>
  lineIdsByNode: Map<string, string[]>
}

export function buildTopology(lines: NormalizedLine[]): TopologyGraph {
  const lineIdsByNode = new Map<string, string[]>()

  for (const line of lines) {
    for (const node of [line.qdbm, line.zdbm]) {
      if (!node)
        continue

      const ids = lineIdsByNode.get(node) ?? []
      ids.push(line.guid)
      lineIdsByNode.set(node, ids)
    }
  }

  const degreeByNode = new Map<string, number>()
  for (const [node, ids] of lineIdsByNode) {
    degreeByNode.set(node, ids.length)
  }

  return { degreeByNode, lineIdsByNode }
}

export function coordinateKey(coordinate: [number, number]): string {
  return coordinate.map(value => roundCoordinate(value)).join(',')
}

export function geometryKey(coordinates: Array<[number, number]>): string {
  return coordinates.map(coordinate => coordinateKey(coordinate)).join('|')
}

export function reverseGeometryKey(coordinates: Array<[number, number]>): string {
  return geometryKey([...coordinates].reverse())
}

function roundCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : String(value)
}
