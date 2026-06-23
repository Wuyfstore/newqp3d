import {
  Cesium3DTileStyle,
  CustomShader,
  CustomShaderMode,
  UniformType,
} from 'cesium'

import type { LayerStateSnapshot } from '../state/layerState'

const STYLE_ID = 'qp3d-web-shell-styles'

export function installPipeNetworkStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
  color: #e6edf3;
  background: #101418;
}

.qp3d-shell {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

.qp3d-viewer,
.qp3d-viewer .cesium-widget,
.qp3d-viewer canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.qp3d-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 4;
  width: 168px;
  max-height: calc(100vh - 64px);
  overflow: auto;
  padding: 10px;
  box-sizing: border-box;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 8px;
  background: rgb(20 25 31 / 90%);
  box-shadow: 0 8px 24px rgb(0 0 0 / 24%);
}

.qp3d-toolbar__section + .qp3d-toolbar__section {
  margin-top: 12px;
}

.qp3d-toolbar__title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #9fb3c8;
}

.qp3d-check-row {
  display: grid;
  grid-template-columns: 18px 1fr;
  align-items: center;
  min-height: 26px;
  gap: 6px;
  font-size: 13px;
  line-height: 1.2;
  color: #f3f7fb;
  cursor: pointer;
}

.qp3d-check-row input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: #00a9ce;
}

.qp3d-property-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 4;
  width: 280px;
  max-height: calc(100vh - 64px);
  box-sizing: border-box;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 8px;
  background: rgb(20 25 31 / 92%);
}

.qp3d-status {
  position: absolute;
  right: 12px;
  bottom: 10px;
  left: 12px;
  z-index: 4;
  height: 30px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  box-sizing: border-box;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 6px;
  background: rgb(16 20 24 / 88%);
  color: #cbd6e2;
  font-size: 12px;
}
`
  document.head.append(style)
}

export function createPipeNetworkStyle(snapshot: LayerStateSnapshot): Cesium3DTileStyle {
  const normalExpression = snapshot.quality.normal ? "${qualityStatus} !== 'abnormal'" : 'false'
  const abnormalExpression = snapshot.quality.abnormal ? "${qualityStatus} === 'abnormal'" : 'false'
  const qualityExpression = `(${normalExpression} || ${abnormalExpression})`

  return new Cesium3DTileStyle({
    color: {
      conditions: [
        ["${qualityStatus} === 'abnormal'", "color('#E05A47', 1)"],
        ["${featureType} === 'point'", "color('#F7C948', 1)"],
        ['true', "color('#FFFFFF', 1)"],
      ],
    },
    show: qualityExpression,
  })
}

export function createFlowMaterialShader(): CustomShader {
  return new CustomShader({
    mode: CustomShaderMode.MODIFY_MATERIAL,
    uniforms: {
      u_time: {
        type: UniformType.FLOAT,
        value: 0,
      },
    },
    fragmentShaderText: `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float along = fsInput.attributes.texCoord_0.x;
  float radial = clamp(fsInput.attributes.texCoord_0.y, 0.0, 1.0);
  float flowEnabled = step(0.0, fsInput.attributes.texCoord_0.y);
  float phase = fract(u_time * 0.22 - along + 1.0);
  float head = 1.0 - smoothstep(0.0, 0.045, phase);
  float trail = smoothstep(0.28, 0.0, phase);
  float radialGlow = smoothstep(0.05, 1.0, radial);
  float endpointFade = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.88, 1.0, along));
  float glow = clamp(max(head, trail * 0.55) * mix(0.18, 1.0, radialGlow) * endpointFade, 0.0, 1.0) * flowEnabled;
  vec3 base = fsInput.attributes.color_0.rgb;
  vec3 highlight = min(base * 1.85 + vec3(0.10), vec3(1.0));
  material.diffuse = mix(material.diffuse, highlight, glow);
  material.emissive = highlight * glow * 0.72;
}
`,
  })
}
