import { beforeEach, describe, expect, it, vi } from 'vitest'

const styleOptions: unknown[] = []
const customShaderOptions: unknown[] = []

vi.mock('cesium', () => ({
  Cesium3DTileStyle: class {
    constructor(options: unknown) {
      styleOptions.push(options)
    }
  },
  CustomShader: class {
    constructor(options: unknown) {
      customShaderOptions.push(options)
    }
  },
  CustomShaderMode: {
    MODIFY_MATERIAL: 'MODIFY_MATERIAL',
  },
  UniformType: {
    FLOAT: 'float',
  },
}))

describe('createPipeNetworkStyle', () => {
  beforeEach(() => {
    styleOptions.length = 0
    customShaderOptions.length = 0
  })

  it('uses only quality as the temporary visibility filter', async () => {
    const { createPipeNetworkStyle } = await import('../src/cesium/styles')
    const { createLayerState } = await import('../src/state/layerState')

    createPipeNetworkStyle(createLayerState().snapshot())

    expect(styleOptions.at(-1)).toMatchObject({
      show: "(${qualityStatus} !== 'abnormal' || ${qualityStatus} === 'abnormal')",
    })
  })

  it('preserves embedded pipe vertex colors instead of tinting pipes again', async () => {
    const { createPipeNetworkStyle } = await import('../src/cesium/styles')
    const { createLayerState } = await import('../src/state/layerState')

    createPipeNetworkStyle(createLayerState().snapshot())

    const options = styleOptions.at(-1) as {
      color: { conditions: Array<[string, string]> }
    }
    expect(JSON.stringify(options.color.conditions)).not.toContain('${pipeType}')
    expect(JSON.stringify(options.color.conditions)).not.toContain('#00A9CE')
    expect(JSON.stringify(options.color.conditions)).not.toContain('#A23B72')
    expect(JSON.stringify(options.color.conditions)).not.toContain('#D18B00')
    expect(options.color.conditions).toContainEqual(['true', "color('#FFFFFF', 1)"])
  })

  it('does not use pipe type or owner values as temporary visibility filters', async () => {
    const { createPipeNetworkStyle } = await import('../src/cesium/styles')
    const { createLayerState } = await import('../src/state/layerState')
    const state = createLayerState()

    state.setPipeTypeVisible('雨水管', false)
    state.setPipeTypeVisible('污水管', false)
    state.setOwnerVisible('市政', false)
    state.setOwnerVisible('小区', false)
    state.setOwnerVisible('农村', false)
    createPipeNetworkStyle(state.snapshot())

    const options = styleOptions.at(-1) as { show: string }
    expect(options.show).not.toContain('${pipeType}')
    expect(options.show).not.toContain('${owner}')
    expect(options.show).toContain('${qualityStatus}')
  })

  it('creates an opaque radial-gradient flow shader with a seamless phase loop', async () => {
    const { createFlowMaterialShader } = await import('../src/cesium/styles')

    createFlowMaterialShader()

    const options = customShaderOptions.at(-1) as { fragmentShaderText: string, translucencyMode?: unknown }
    expect(customShaderOptions.at(-1)).toMatchObject({
      uniforms: {
        u_time: { type: 'float', value: 0 },
      },
      fragmentShaderText: expect.stringContaining('fsInput.attributes.texCoord_0.x'),
    })
    expect(options.translucencyMode).toBeUndefined()
    expect(JSON.stringify(customShaderOptions.at(-1))).toContain('u_time')
    expect(options.fragmentShaderText).toContain('fsInput.attributes.color_0.rgb')
    expect(options.fragmentShaderText).not.toContain('along * 0.12')
    expect(options.fragmentShaderText).not.toContain('material.alpha')
    expect(options.fragmentShaderText).toContain('float radial = clamp(fsInput.attributes.texCoord_0.y, 0.0, 1.0)')
    expect(options.fragmentShaderText).toContain('float flowEnabled = step(0.0, fsInput.attributes.texCoord_0.y)')
    expect(options.fragmentShaderText).toContain('float phase = fract(u_time * 0.22 - along + 1.0)')
    expect(options.fragmentShaderText).toContain('float endpointFade = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.88, 1.0, along))')
    expect(options.fragmentShaderText).toContain('radialGlow')
    expect(options.fragmentShaderText).toContain('smoothstep(0.05, 1.0, radial)')
    expect(options.fragmentShaderText).not.toContain('smoothstep(0.05, 1.0, 1.0 - radial)')
    expect(options.fragmentShaderText).not.toContain('abs(along - progress)')
    expect(options.fragmentShaderText).not.toContain('float progress = fract')
  })
})
