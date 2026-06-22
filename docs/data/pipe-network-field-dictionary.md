# Pipe Network Field Dictionary

This dictionary covers the two source tables used by the pipeline:

- `public.sys_016_tancexbtjinfo_sde` for pipe lines
- `public.sys_016_tancedbtjinfo_sde` for point facilities

## Line table fields

| Field | Meaning |
| --- | --- |
| `guid` | Unique business identifier for the pipe segment. |
| `qdbm` | Start-node business code used to link the segment to a point facility. |
| `zdbm` | End-node business code used to link the segment to a point facility. |
| `gwlx` | Pipe network category such as rainwater or sewage. |
| `gs` | Ownership or scope classification such as municipal, residential, or rural. |
| `cz` | Pipe material or construction material description. |
| `gg` | Pipe specification string, including round or box dimensions. |
| `qdms` | Start-side burial depth, usually expressed in meters. |
| `zdms` | End-side burial depth, usually expressed in meters. |
| `qdndbg` | Start-side inner-bottom elevation. |
| `zdndbg` | End-side inner-bottom elevation. |
| `geom` | Pipe geometry used for SRID validation, topology, and display generation. |

## Point table fields

| Field | Meaning |
| --- | --- |
| `gdbm` | Facility business code used to match line endpoints. |
| `lbmc` | Facility category name. |
| `dmbg` | Burial depth for the facility. |
| `kj` | Pipe or facility caliber / aperture reference where applicable. |
| `js` | Facility count or level field used by the source table. |
| `gg` | Specification or size string associated with the point facility. |
| `jgcz` | Structural material or construction attribute. |
| `jgxz` | Structural form or function attribute. |
| `geom` | Facility geometry used for SRID validation and endpoint matching. |

## Shared interpretation notes

- `geom` is the authoritative spatial column for both source tables.
- `gg` is parsed by the pipeline into a normalized pipe specification when possible.
- `cz`, `jgcz`, and `jgxz` should be preserved as source text unless a later normalization rule explicitly maps them.
