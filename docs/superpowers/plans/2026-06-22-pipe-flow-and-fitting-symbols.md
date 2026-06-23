# Pipe Flow Direction And Fitting Symbols Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pipe flow direction visualization and replace generic point boxes with recognizable low-poly pipe fitting symbols.

**Architecture:** The main pipe network tileset remains the authoritative mesh. Flow direction is published as an optional second lightweight 3D Tiles layer referenced by `flowTilesetUrl` in `latest.json`. Point fittings are generated as procedural low-poly meshes in the pipeline based on `lbmc`, with topology-aware fitting types deferred unless source data explicitly provides orientation.

**Tech Stack:** TypeScript, Vitest, Cesium 1.117, custom GLB/3D Tiles pipeline, Vite.

## Global Constraints

- Keep existing Cesium 1.117 usage.
- Do not use per-feature Cesium Entity rendering for million-scale flow arrows.
- `lx = 1` means flow from `qdbm` to `zdbm`.
- `lx = -1`, null, empty, or unknown means flow from `zdbm` to `qdbm`.
- Existing versions without flow tiles must still load.
- Keep edits scoped to `cesium-pipe-network-clean`.

---

### Task 1: Persist Flow Direction Metadata

**Files:**
- Modify: `packages/pipeline/src/cli.ts`
- Modify: `packages/pipeline/src/tiles/glbWriter.ts`
- Test: `packages/pipeline/tests/cli.test.ts`
- Test: `packages/pipeline/tests/glbWriter.test.ts`

**Interfaces:**
- Produces metadata property `flowDirection: 'qdbm-to-zdbm' | 'zdbm-to-qdbm'`.
- Produces raw metadata property `lx`.

- [ ] Add failing test that a fake PostGIS line with `lx: '1'` writes `flowDirection: 'qdbm-to-zdbm'`.
- [ ] Add failing test that GLB structural metadata includes string fields `lx` and `flowDirection`.
- [ ] Implement `lineFlowDirection(lx: unknown)` in `cli.ts`.
- [ ] Add `lx` and `flowDirection` to line metadata.
- [ ] Add `lx` and `flowDirection` to `STRING_METADATA_FIELDS`.
- [ ] Run targeted pipeline tests.

### Task 2: Publish Optional Flow Tileset

**Files:**
- Create: `packages/pipeline/src/geometry/flowMesh.ts`
- Modify: `packages/pipeline/src/cli.ts`
- Modify: `packages/pipeline/src/publish/versionStore.ts`
- Test: `packages/pipeline/tests/flowMesh.test.ts`
- Test: `packages/pipeline/tests/cli.test.ts`
- Test: `packages/pipeline/tests/versionStore.test.ts`

**Interfaces:**
- `createFlowArrowMesh(input: { featureId: number, coordinates: Array<[number, number, number]>, direction: 'qdbm-to-zdbm' | 'zdbm-to-qdbm' }): Mesh`
- Latest manifest optional field: `flowTilesetUrl?: string`.

- [ ] Add failing test for `createFlowArrowMesh` direction reversal.
- [ ] Add failing publish test for optional `flowTilesetUrl`.
- [ ] Implement small triangular arrow meshes sampled along each line.
- [ ] Write `flow/tileset.json`, `flow/root.glb`, and metadata sidecar during PostGIS build.
- [ ] Include `flowTilesetUrl` in latest manifest only when flow files exist.
- [ ] Run targeted pipeline tests.

### Task 3: Load And Animate Flow Layer

**Files:**
- Modify: `apps/web/src/cesium/layers.ts`
- Modify: `apps/web/src/cesium/styles.ts`
- Test: `apps/web/tests/layers.test.ts`
- Test: `apps/web/tests/styles.test.ts`

**Interfaces:**
- Consumes `VersionManifest.flowTilesetUrl?: string`.
- Produces optional `LayerHandles.flowTileset`.

- [ ] Add failing test that `loadPipeNetworkLayers` loads the optional flow tileset.
- [ ] Add failing test that missing `flowTilesetUrl` keeps old behavior.
- [ ] Load flow tiles with `modelUpAxis: Axis.Z`.
- [ ] Apply a high-emissive visible style to the flow layer.
- [ ] Add a render-loop pulse using style alpha or color phase.
- [ ] Run targeted web tests.

### Task 4: Procedural Fitting Symbols

**Files:**
- Modify: `packages/pipeline/src/geometry/nodeMesh.ts`
- Modify: `packages/pipeline/src/geometry/mesh.ts`
- Modify: `packages/pipeline/src/cli.ts`
- Test: `packages/pipeline/tests/pipeMesh.test.ts`
- Test: `packages/pipeline/tests/cli.test.ts`

**Interfaces:**
- Extend node symbols to `well`, `rect-grate`, `bend`, `coupling`, `tee`, `cross`, `reducer`, `valve`, `hydrant`, `pump-station`, `outlet`, `unknown-point`.
- `createNodeMesh` returns distinct mesh footprints for grate, bend, tee, cross, and well.

- [ ] Add failing geometry tests for circular well, rectangular grate, L bend, T tee, and cross footprints.
- [ ] Add failing mapping tests for `弯头`, `双通`, `三通`, `四通`, `雨篦`, `雨水井`, `污水井`.
- [ ] Add mesh helpers for cylinders and merged box primitives.
- [ ] Implement symbol mapping from `lbmc`.
- [ ] Keep unknown points visible with a small neutral marker.
- [ ] Run targeted pipeline tests.

### Task 5: Rebuild And Verify

**Files:**
- Generated: `data/tiles/network-YYYYMMDD-HHmm/*`
- Generated: `data/tiles/latest.json`

- [ ] Run full typecheck.
- [ ] Run full tests.
- [ ] Run web build.
- [ ] Rebuild PostGIS tiles using existing config.
- [ ] Validate latest version.
- [ ] Reload `http://127.0.0.1:5173/`.
- [ ] Confirm latest status loads and page console has no project errors.
