# Pipe Network Model Asset List

| Category | Strategy | Required in Phase 1 | Asset |
| --- | --- | --- | --- |
| 雨篦 | generated-low-poly | yes | no external model |
| 污篦 | generated-low-poly | yes | no external model |
| 雨水进水口 | generated-low-poly | yes | no external model |
| 污水进水口 | generated-low-poly | yes | no external model |
| 雨水井 | generated-parametric | yes | no external model |
| 污水井 | generated-parametric | yes | no external model |
| 消防栓 | model | no | `assets/models/hydrant.glb` |
| 闸门 | model | no | `assets/models/gate.glb` |
| 泵站 | model | no | `assets/models/pump-station.glb` |
| 雨水排放口 | model | no | `assets/models/outfall-rain.glb` |
| 污水排放口 | model | no | `assets/models/outfall-sewage.glb` |

Generated-low-poly and generated-parametric categories are produced from source data first. Model categories are optional Phase 1 extensions and must be loaded through a manifest rather than hard-coded source-table values.
