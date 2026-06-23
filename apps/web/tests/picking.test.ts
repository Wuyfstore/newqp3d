import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (movement: { position: unknown }) => void>()

vi.mock('cesium', () => {
  class MockColor {
    constructor(readonly name: string) {}

    withAlpha(alpha: number) {
      return new MockColor(`${this.name}:${alpha}`)
    }

    static clone(color: MockColor) {
      return new MockColor(color.name)
    }

    static YELLOW = new MockColor('yellow')
  }

  return {
    Cartesian3: {
      fromDegrees: vi.fn(),
    },
    Color: MockColor,
    ScreenSpaceEventHandler: class {
      constructor() {}

      setInputAction(callback: (movement: { position: unknown }) => void, eventType: string) {
        handlers.set(eventType, callback)
      }

      destroy() {}
    },
    ScreenSpaceEventType: {
      LEFT_CLICK: 'LEFT_CLICK',
    },
  }
})

describe('installPicking', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('ignores stale detail responses when a newer pick resolves first', async () => {
    const { installPicking } = await import('../src/cesium/picking')
    const { Color } = await import('cesium')
    const firstFeature = feature(Color, { guid: 'slow', type: 'line' })
    const secondFeature = feature(Color, { guid: 'fast', type: 'line' })
    const pickedFeatures = [firstFeature, secondFeature]
    const deferredSlow = deferred<Record<string, unknown>>()
    const apiClient = {
      search: vi.fn(),
      getLine: vi.fn((guid: string) => guid === 'slow' ? deferredSlow.promise : Promise.resolve({ guid })),
      getPoint: vi.fn(),
      getLatestVersion: vi.fn(),
      getLatestQuality: vi.fn(),
      listSchemas: vi.fn(),
      listTables: vi.fn(),
      getTableProfile: vi.fn(),
      createBuildTemplate: vi.fn(),
    }
    const onPick = vi.fn()

    installPicking(viewer(() => pickedFeatures.shift()), apiClient, { onPick })

    handlers.get('LEFT_CLICK')?.({ position: { x: 1, y: 1 } })
    handlers.get('LEFT_CLICK')?.({ position: { x: 2, y: 2 } })
    await flushPromises()

    expect(onPick).toHaveBeenCalledOnce()
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'fast' }))

    deferredSlow.resolve({ guid: 'slow' })
    await flushPromises()

    expect(onPick).toHaveBeenCalledOnce()
  })

})

function viewer(pick: () => unknown) {
  return {
    scene: {
      canvas: {},
      pick,
      requestRender: vi.fn(),
    },
  } as never
}

function feature(Color: new (...args: number[]) => unknown, properties: Record<string, unknown>) {
  return {
    color: new Color(1, 1, 1, 1),
    getPropertyIds: () => Object.keys(properties),
    getProperty: (name: string) => properties[name],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
