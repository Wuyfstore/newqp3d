import type { NormalizedLine, TopologyGraph } from './graph.js'

export interface MergeChain {
  displayId: string
  originalGuids: string[]
  coordinates: Array<[number, number]>
  gwlx: string | null
  gs: string | null
  cz: string | null
  gg: string | null
}

interface ChainLine {
  line: NormalizedLine
  fromNode: string | null
  toNode: string | null
}

export function planMergeChains(lines: NormalizedLine[], graph: TopologyGraph): MergeChain[] {
  const linesByGuid = new Map(lines.map(line => [line.guid, line]))
  const visited = new Set<string>()
  const chains: MergeChain[] = []

  for (const line of lines) {
    if (visited.has(line.guid))
      continue

    const orderedLines = collectChain(line, linesByGuid, graph, visited)
    chains.push(toMergeChain(orderedLines))
  }

  return chains
}

function collectChain(
  startLine: NormalizedLine,
  linesByGuid: Map<string, NormalizedLine>,
  graph: TopologyGraph,
  visited: Set<string>,
): ChainLine[] {
  const chainSeen = new Set([startLine.guid])
  const backward = collectDirection(startLine, 'qdbm', linesByGuid, graph, visited, chainSeen)
  const forward = collectDirection(startLine, 'zdbm', linesByGuid, graph, visited, chainSeen)
  const orderedLines = [
    ...backward.reverse(),
    { line: startLine, fromNode: startLine.qdbm, toNode: startLine.zdbm },
    ...forward,
  ]

  for (const item of orderedLines) {
    visited.add(item.line.guid)
  }

  return orderedLines
}

function collectDirection(
  startLine: NormalizedLine,
  endpoint: 'qdbm' | 'zdbm',
  linesByGuid: Map<string, NormalizedLine>,
  graph: TopologyGraph,
  visited: Set<string>,
  chainSeen: Set<string>,
): ChainLine[] {
  const collected: ChainLine[] = []
  let currentLine = startLine
  let currentNode = startLine[endpoint]

  while (currentNode && graph.degreeByNode.get(currentNode) === 2) {
    const nextGuid = graph.lineIdsByNode.get(currentNode)?.find(guid => guid !== currentLine.guid)
    const nextLine = nextGuid ? linesByGuid.get(nextGuid) : undefined

    if (!nextLine || visited.has(nextLine.guid) || chainSeen.has(nextLine.guid) || !hasSameMergeAttributes(startLine, nextLine))
      break

    const nextNode = nextLine.qdbm === currentNode ? nextLine.zdbm : nextLine.qdbm
    collected.push({
      line: nextLine,
      fromNode: endpoint === 'qdbm' ? nextNode : currentNode,
      toNode: endpoint === 'qdbm' ? currentNode : nextNode,
    })
    chainSeen.add(nextLine.guid)
    currentNode = nextNode
    currentLine = nextLine
  }

  return collected
}

function toMergeChain(items: ChainLine[]): MergeChain {
  const originalGuids = items.map(item => item.line.guid)
  const firstItem = items[0]
  if (!firstItem)
    throw new Error('Cannot create merge chain without source lines')

  return {
    displayId: `pipe-display-${originalGuids.join('-')}`,
    originalGuids,
    coordinates: mergeCoordinates(items),
    gwlx: firstItem.line.gwlx,
    gs: firstItem.line.gs,
    cz: firstItem.line.cz,
    gg: firstItem.line.gg,
  }
}

function mergeCoordinates(items: ChainLine[]): Array<[number, number]> {
  const coordinates: Array<[number, number]> = []

  for (const [index, item] of items.entries()) {
    const lineCoordinates = orientCoordinates(item.line.coordinates, coordinates.at(-1), items[index + 1]?.line.coordinates)
    if (coordinates.length === 0) {
      coordinates.push(...lineCoordinates)
      continue
    }

    coordinates.push(...lineCoordinates.slice(1))
  }

  return coordinates
}

function orientCoordinates(
  coordinates: Array<[number, number]>,
  previousEndpoint: [number, number] | undefined,
  nextCoordinates: Array<[number, number]> | undefined,
): Array<[number, number]> {
  if (!previousEndpoint) {
    if (!nextCoordinates)
      return coordinates

    const [first] = coordinates
    const last = coordinates.at(-1)
    const [nextFirst] = nextCoordinates
    const nextLast = nextCoordinates.at(-1)

    const firstTouchesNext = Boolean(first && ((nextFirst && sameCoordinate(first, nextFirst)) || (nextLast && sameCoordinate(first, nextLast))))
    const lastTouchesNext = Boolean(last && ((nextFirst && sameCoordinate(last, nextFirst)) || (nextLast && sameCoordinate(last, nextLast))))

    if (firstTouchesNext && !lastTouchesNext)
      return [...coordinates].reverse()

    return coordinates
  }

  const [first] = coordinates
  const last = coordinates.at(-1)

  if (first && sameCoordinate(first, previousEndpoint))
    return coordinates

  if (last && sameCoordinate(last, previousEndpoint))
    return [...coordinates].reverse()

  return coordinates
}

function sameCoordinate(left: [number, number], right: [number, number]): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

function hasSameMergeAttributes(left: NormalizedLine, right: NormalizedLine): boolean {
  return left.gwlx === right.gwlx
    && left.gs === right.gs
    && left.cz === right.cz
    && left.gg === right.gg
}
