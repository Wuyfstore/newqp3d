import { describe, expect, it } from 'vitest'

import { isDirectRun } from '../src/index.js'

describe('API startup entrypoint', () => {
  it('recognizes direct execution when Node passes a Windows filesystem path', () => {
    expect(isDirectRun(
      'file:///D:/Workspace/Personal/new-qp3d/apps/api/dist/index.js',
      'D:\\Workspace\\Personal\\new-qp3d\\apps\\api\\dist\\index.js',
    )).toBe(true)
  })

  it('does not start when imported by another module', () => {
    expect(isDirectRun(
      'file:///D:/Workspace/Personal/new-qp3d/apps/api/dist/index.js',
      'D:\\Workspace\\Personal\\new-qp3d\\scripts\\worker.js',
    )).toBe(false)
  })
})
