# LOD 与井篦尺寸高程问题原因分析

生成时间：2026-06-23
分析版本：`network-20260623-0155`
范围：当前 `cesium-pipe-network-clean` 最终版本的 PostGIS 构建链路、3D Tiles 输出、井/篦等点设施程序化模型。

## 结论摘要

当前系统必须补 LOD/分块。现有输出并不是真正的流式 3D Tiles，而是把全部管线和点设施合并成一个 `root.glb`，再挂到单个 root tile 上。当前版本包含 `121,557` 条线、`127,563` 个点，总计 `249,120` 个 feature；`root.glb` 约 `700.8 MB`，`tileset.json` 约 `177.2 MB`，`metadata.json` 约 `154.4 MB`。这会导致首屏加载、内存、拾取和浏览性能都被单个超大资源卡住，Cesium 无法按视距和视锥裁剪逐步加载。

井和篦的大小、高低问题不是单一渲染 bug，而是数据解释和模型生成规则过于粗糙导致的。当前点设施几何只按类别给固定尺寸：井固定 `4m`，篦/进水口/排放口固定 `3m`，并且没有解析 `jgcc`、`jgxz`、`js` 等字段；高度上直接把 `dmbg` 当作模型底面高度，若缺失则用 `0`。这会让井盖/篦子显得过大、过厚、悬浮或插入地面，也会让带井深的数据无法正确表现竖向关系。

## 证据与现状

### 当前 3D Tiles 输出

对 `data/tiles/network-20260623-0155` 的检查结果：

| 文件 | 大小 |
| --- | ---: |
| `root.glb` | `700,763,808` bytes |
| `tileset.json` | `177,232,443` bytes |
| `metadata.json` | `154,360,604` bytes |

`tileset.json` 结构关键值：

| 项 | 当前值 |
| --- | --- |
| root content | `root.glb` |
| root children | `0` |
| root refine | `ADD` |
| root geometricError | `500` |
| root metadata count | `249,120` |

质量报告关键值：

| 项 | 当前值 |
| --- | ---: |
| `totalLines` | `121,557` |
| `totalPoints` | `127,563` |
| `generatedLineFeatures` | `121,557` |
| `generatedPointFeatures` | `127,563` |
| `height-defaulted` | `1,130` |
| `spec-defaulted` | `104` |

### 点表字段覆盖情况

按点类型统计，和井/篦尺寸高度相关的字段覆盖并不均匀：

| 类型 | 总数 | `dmbg` | `kj` | `js` | `gg` | `jgcc` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 雨篦 | 37,379 | 37,370 | 0 | 9,933 | 0 | 15,951 |
| 雨水井 | 36,698 | 36,624 | 0 | 9,570 | 1 | 20,341 |
| 污水井 | 31,474 | 29,658 | 0 | 6,811 | 0 | 15,447 |
| 污篦 | 194 | 194 | 0 | 48 | 0 | 79 |

按大类聚合：

| 大类 | 总数 | `dmbg` | `js` | `jgcc` | `dmbg` 中位数 | `dmbg` 范围 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 井类 | 68,607 | 66,717 | 16,381 | 35,788 | 5.943 | -0.55 到 113.907 |
| 篦/口类 | 38,055 | 38,046 | 9,981 | 16,094 | 5.772 | -0.638 到 60.664 |
| 其他 | 20,902 | 20,754 | 241 | 4,776 | 5.764 | -0.965 到 55.022 |

抽样值显示 `jgcc` 可能是 `700`、`70`、`60X60`、`140X40`、`40X30` 等混合格式；`jgxz` 可能是 `圆形` 或 `矩形`；`js` 可能表示井深/深度。但当前构建链路只把这些字段写入 metadata，没有用来生成点设施几何。

## LOD 缺失原因

### 1. 发布链路把所有 feature 合并为一个 Mesh

`packages/pipeline/src/cli.ts` 中 `buildPostgisOverview()` 会先解析所有线和点，再执行：

- `features = [...parsedLines.map(...), ...parsedPoints.map(...)]`
- `mesh = combineMeshes(features.map(({ mesh }) => mesh))`
- `rootUri: 'root.glb'`

这意味着所有点、线都被合并成一个 GLB。只要用户打开 tileset，Cesium 就必须请求和解析这个大 GLB，没有空间分块可用。

### 2. `tilesetWriter` 只写单 root tile

`packages/pipeline/src/tiles/tilesetWriter.ts` 当前 `TilesetTileJson` 只有 root 的 `content.uri`、`boundingVolume`、`geometricError`、`extras` 等字段，没有 `children` 输出。即使 `refine` 写成 `ADD`，没有 children 时也没有真正的层级细化。

### 3. `tileGrid` 未进入实际构建链路

`packages/pipeline/src/tiles/tileGrid.ts` 已经有四叉树分割雏形，但当前只在测试中验证稳定 id 和 bounds 拆分；实际 `buildPostgisOverview()` 没有调用它，也没有按 tile 分配 feature、按 tile 写多个 GLB、按 tile 写 children。

### 4. metadata 被塞进 root tile 的 `extras`

当前 `tileset.json` 的 root `extras.featureMetadata` 包含全部 `249,120` 条 metadata，这导致 `tileset.json` 本身达到 `177.2 MB`。即使 GLB 后续分块，如果仍把所有 metadata 放 root，首屏仍会被大 JSON 拖慢。metadata 应按 tile sidecar 或按 feature table/metadata extension 分片。

### 5. 缺少近中远三档模型策略

当前管线与点设施只有一套模型：

- 管线固定径向段数，全部 detail 写入同一个 GLB。
- 井固定 16 段圆柱。
- 弯头、三通、四通、阀门等都是同一套近景盒体/组合体。
- 远景没有简化线、点 sprite、billboard 或低面数替代。

所以即使未来加了空间分块，如果每个 tile 只有一种 detail，也只能做到按空间加载，不能做到按距离降模。

## 井和篦尺寸问题原因

### 1. 点设施尺寸当前按类别写死

`packages/pipeline/src/cli.ts` 的 `pointSymbolSizeMeters()` 当前规则：

| 符号 | 当前尺寸 |
| --- | ---: |
| `well` | `4m` |
| `rect-grate` / `inlet` / `reserved-outlet` | `3m` |
| `bend` / `coupling` / `tee` / `cross` / `reducer` / `valve` | `4m` |
| `hydrant` | `3m` |
| `pump-station` | `5m` |
| `unknown-point` | `3.2m` |

这只是可见性占位尺寸，不是设施真实尺寸。实际井盖常见直径约 0.7m，篦子常见为矩形尺寸，例如抽样中的 `40X30`、`140X40`。固定 3-4m 会明显偏大。

### 2. `jgcc`、`jgxz`、`js`、`gg` 只进入 metadata，没有参与几何

`parsePointFeature()` 读取并保留了：

- `kj`
- `js`
- `gg`
- `jgcz`
- `jgxz`
- `jgcc`

但 `buildPointFeature()` 只使用：

- `pointType -> pointSymbol`
- `pointSymbol -> fixed sizeMeters`
- `position -> createNodeMesh`

因此 `jgcc=700`、`jgcc=60X60`、`jgxz=圆形/矩形`、`js=1.28` 等数据不会影响模型宽度、长度、直径或高度。

### 3. `jgcc` 格式未归一化，单位不明确

抽样中 `jgcc` 同时出现：

- `700`
- `70`
- `60X60`
- `140X40`
- `40X30`

这些值可能分别使用 mm、cm 或本地采集习惯单位。当前系统没有解析和单位判定，所以即使开始使用该字段，也需要先建立规则，例如：

- 单值 `700`：优先按 mm 解析为 0.7m。
- 单值 `70`：结合 `jgxz=圆形` 时可能是 cm，应解析为 0.7m。
- 矩形 `60X60`：可能是 cm，应解析为 0.6m x 0.6m。
- 矩形 `140X40`：可能是 cm，应解析为 1.4m x 0.4m。

### 4. 程序化模型没有区分“井盖/井筒/井室”

`createNodeMesh()` 中：

- `well` 生成一个圆柱，半径为 `sizeMeters / 2`，高度为 `max(1.6, sizeMeters * 0.45)`。
- `rect-grate` 生成一个盒子，尺寸为 `[size * 1.45, size * 0.7, 0.45]`。

这把地表井盖、地下井筒、井室体积混在一个视觉模型里。真实展示通常至少需要区分：

- 地表井盖/篦面：薄、贴近地面，尺寸由 `jgcc/jgxz` 决定。
- 井筒或井室：可选，只有近景或剖切模式显示，高度由 `js` 或关联管底标高估算。
- 连接管件：应结合相连管线方向和口径，而不是固定朝向。

## 井和篦高低问题原因

### 1. 当前把 `dmbg` 当作模型底面高度

`parsePointFeature()` 把点位置高度设为：

```ts
finiteOrNull(point.dmbg) ?? 0
```

随后 `createNodeMesh()` 以该 position 作为模型底部/基准。`createBoxMesh()` 内部也是 `minZ = cz`，`maxZ = cz + height`。这意味着井和篦会从 `dmbg` 往上长出 0.45m 到数米。

如果 `dmbg` 表示地面标高或井盖面标高，更合理的是把井盖/篦面放在 `dmbg` 附近，并让薄面围绕或略高于该标高，而不是把整个模型底面放在 `dmbg`。

### 2. 缺失 `dmbg` 时直接落到 0

对点设施没有像管线那样记录 `height-defaulted` 标记，也没有局部地面/邻近管线推断。缺失 `dmbg` 时高度直接为 `0`。在当前区域 `dmbg` 中位数约 5-6m 的情况下，缺失值会明显偏低。

### 3. `js` 未用于竖向高度

井类有 `16,381 / 68,607` 条有 `js`，篦/口类有 `9,981 / 38,055` 条有 `js`。抽样里 `js` 出现 `0.31`、`0.91`、`1.10`、`1.28`、`2.55` 等值，可能表示深度。当前没有使用它，所以：

- 井筒高度不是实际井深。
- 篦/口厚度不是实际深度。
- 近景模型无法反映地下结构。

### 4. 点高程和管线高程没有关联校准

管线高度使用 `qdndbg/zdndbg` 或 `qdms/zdms` 推导中心线；点设施只用自己的 `dmbg`。当前没有根据 `qdbm/zdbm` 与 `gdbm` 的关联关系校准井底、管底、井盖之间的竖向关系，因此会出现管线和井/篦在高度上不贴合的情况。

## 建议修复方向

### 第一优先级：加真正的空间分块 LOD

1. 在 `buildPostgisOverview()` 中不要全量 `combineMeshes()` 后只写 `root.glb`。
2. 使用四叉树或网格分块，把线和点按 bounds 分配到子 tile。
3. 每个 tile 独立输出 GLB，例如 `tiles/root-0-1.glb`。
4. `tilesetWriter` 支持 `children`、每级 `geometricError`、每个 child 的 `boundingVolume` 和 `content.uri`。
5. metadata 改为 tile 级 sidecar，或者至少不要全部塞进 root `extras`。
6. 目标单 tile 压缩后控制在 1-5MB，异常密集区域继续拆分。

### 第二优先级：增加近中远模型策略

建议至少三档：

| LOD | 管线 | 点设施 |
| --- | --- | --- |
| 远景 | 低段数线/简化中心线 | billboard 或极简点 |
| 中景 | 低面数管道 | 简化井盖/篦面 |
| 近景 | 当前管道或更细段数 | 参数化井盖、篦面、必要时井筒 |

### 第三优先级：建立点设施尺寸解析器

新增 `pointSpec` 或类似模块，专门解析：

- `lbmc`：设施类别。
- `jgxz`：圆形、矩形等形状。
- `jgcc`：尺寸字符串。
- `js`：深度或竖向尺寸。
- `dmbg`：盖面/地面标高。

输出应是结构化参数，例如：

```ts
{
  symbol: 'well',
  footprint: { shape: 'round', diameterMeters: 0.7 },
  coverThicknessMeters: 0.12,
  shaftDepthMeters: 1.28,
  heightQuality: 'cover-elevation'
}
```

### 第四优先级：调整井/篦的高程锚点

建议把点设施模型分为地表盖面和地下体：

- 井盖/篦面：以 `dmbg` 为盖面顶或中心，厚度 0.08-0.15m。
- 井筒：从盖面向下延伸，使用 `js` 或关联管底估算，仅近景显示。
- 缺失 `dmbg`：优先从相连管线端点、周边点或地形/默认地面推断，并写入质量标记。

### 第五优先级：补充质量报告

质量报告应新增点设施质量项：

- `point-height-defaulted`
- `point-size-defaulted`
- `point-size-parsed`
- `point-size-ambiguous-unit`
- `point-depth-parsed`
- `point-depth-missing`
- `point-shape-parsed`
- `point-shape-defaulted`

这样可以在构建后明确知道哪些井/篦是按真实数据生成，哪些仍是占位模型。

## 后续验收口径

LOD 验收：

- `tileset.json` root 必须有 children。
- 单个 GLB 不应再接近数百 MB。
- root `extras` 不应包含全量 feature metadata。
- 首屏只加载根节点或低 LOD，不一次性下载全部细节。
- dense area 缩放时逐步加载子 tile。

井/篦验收：

- `jgcc=700` 或 `70` 的井盖应接近 0.7m，而不是 4m。
- `jgcc=60X60` 的井/篦应显示为约 0.6m x 0.6m。
- `jgcc=140X40` 的篦应显示为约 1.4m x 0.4m。
- 井盖/篦面应贴近 `dmbg` 标高，不应从 `dmbg` 往上长出几米。
- 有 `js` 的井在近景可显示向下井筒；远景只显示盖面或图标。
