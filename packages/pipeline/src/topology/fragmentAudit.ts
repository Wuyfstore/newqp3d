import type { NormalizedLine } from './graph.js'

import { geometryKey, reverseGeometryKey } from './graph.js'

export interface FragmentAuditReport {
  total: number
  exactDuplicateGeometryRows: number
  reverseDuplicateGeometryRows: number
  directedEndpointDuplicateRows: number
  shorterThan10m: number
}

export function auditFragments(lines: NormalizedLine[]): FragmentAuditReport {
  return {
    total: lines.length,
    exactDuplicateGeometryRows: countDuplicateRows(lines.map(line => geometryKey(line.coordinates))),
    reverseDuplicateGeometryRows: countReverseDuplicateRows(lines),
    directedEndpointDuplicateRows: countDuplicateRows(lines.flatMap(line => (
      line.qdbm && line.zdbm ? [`${line.qdbm}->${line.zdbm}`] : []
    ))),
    shorterThan10m: lines.filter(line => polylineLength(line.coordinates) < 10).length,
  }
}

function countDuplicateRows(keys: string[]): number {
  const counts = new Map<string, number>()

  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let duplicateRows = 0
  for (const count of counts.values()) {
    if (count > 1)
      duplicateRows += count
  }

  return duplicateRows
}

function countReverseDuplicateRows(lines: NormalizedLine[]): number {
  const counts = new Map<string, number>()

  for (const line of lines) {
    const forwardKey = geometryKey(line.coordinates)
    const backwardKey = reverseGeometryKey(line.coordinates)
    const canonicalKey = forwardKey < backwardKey ? forwardKey : backwardKey
    counts.set(canonicalKey, (counts.get(canonicalKey) ?? 0) + 1)
  }

  let duplicateRows = 0
  for (const count of counts.values()) {
    if (count > 1)
      duplicateRows += count
  }

  return duplicateRows
}

function polylineLength(coordinates: Array<[number, number]>): number {
  let length = 0

  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]
    const current = coordinates[index]
    if (!previous || !current)
      continue

    const [previousX, previousY] = previous
    const [currentX, currentY] = current
    length += Math.hypot(currentX - previousX, currentY - previousY)
  }

  return length
}
