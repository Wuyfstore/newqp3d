# Build and Publish Runbook

## Backend Config File

Pipeline and API read `config/backend.env` by default. Prepare this file on the build host before startup; `config/backend.example.env` is only a field template.

```text
QP3D_DATABASE_URL=postgres://<user>:<password>@localhost:15432/qcwebserver
QP3D_POINT_TABLE=public.sys_016_tancedbtjinfo_sde
QP3D_LINE_TABLE=public.sys_016_tancexbtjinfo_sde
QP3D_EXPECTED_SRID=3857
QP3D_OUTPUT_ROOT=data/tiles
HOST=0.0.0.0
PORT=4100
```

For production, keep the real file outside the repository and set `QP3D_CONFIG_FILE` in the service environment to an absolute path such as `/etc/new-qp3d/backend.env`.

## Build Commands

```bash
pnpm --filter @new-qp3d/pipeline build
node packages/pipeline/dist/cli.js inspect-db
node packages/pipeline/dist/cli.js build --source postgis --output data/tiles
```

For local smoke verification, build from bundled fixtures:

```bash
node packages/pipeline/dist/cli.js build --source sample --output data/tiles
node packages/pipeline/dist/cli.js validate --version network-YYYYMMDD-HHmm --output data/tiles
```

## Validation Rules

- `tileset.json` exists.
- `quality-report.json` exists.
- `latest.json` points to a version directory that exists.
- New failed builds do not modify the previous `latest.json`.
