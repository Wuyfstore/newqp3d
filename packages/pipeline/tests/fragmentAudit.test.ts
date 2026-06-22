import { describe, expect, it } from 'vitest'

import { auditFragments } from '../src/topology/fragmentAudit.js'

describe('auditFragments', () => {
  it('counts exact duplicate geometries, reverse duplicates, endpoint duplicates, and short segments', () => {
    const report = auditFragments([
      line('a', 'N1', 'N2', [[0, 0], [1, 0]], '雨水管', '市政', '砼', '300'),
      line('b', 'N3', 'N4', [[0, 0], [1, 0]], '雨水管', '市政', '砼', '300'),
      line('c', 'N5', 'N6', [[1, 0], [0, 0]], '雨水管', '市政', '砼', '300'),
      line('d', 'N1', 'N2', [[0, 1], [1, 1]], '雨水管', '市政', '砼', '300'),
      line('e', 'N7', 'N8', [[0, 2], [20, 2]], '污水管', '小区', 'PE', '200'),
    ])

    expect(report.total).toBe(5)
    expect(report.exactDuplicateGeometryRows).toBe(2)
    expect(report.reverseDuplicateGeometryRows).toBe(3)
    expect(report.directedEndpointDuplicateRows).toBe(2)
    expect(report.shorterThan10m).toBe(4)
  })

  it('does not count unrelated rows with missing endpoint codes as endpoint duplicates', () => {
    const report = auditFragments([
      line('missing-a', null, null, [[0, 0], [20, 0]], '雨水管', '市政', '砼', '300'),
      line('missing-b', null, null, [[0, 1], [20, 1]], '雨水管', '市政', '砼', '300'),
    ])

    expect(report.directedEndpointDuplicateRows).toBe(0)
  })
})

function line(guid: string, qdbm: string | null, zdbm: string | null, coordinates: Array<[number, number]>, gwlx: string, gs: string, cz: string, gg: string) {
  return { guid, qdbm, zdbm, coordinates, gwlx, gs, cz, gg }
}
