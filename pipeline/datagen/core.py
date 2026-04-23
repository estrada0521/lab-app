from __future__ import annotations

import csv
import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FLAT_RAWDATA_DIR = "rawdata"
FLAT_DATA_DIR = "data"
FLAT_SAMPLES_DIR = "samples"
FLAT_EXP_DIR = "exp"
FLAT_DB_DIR = "DB"
FLAT_DB_MATERIALS_DIR = "materials"
FLAT_METADATA_NAME = "metadata.json"
RAWDATA_SAMPLE_OVERRIDE_KEYS = {
    "mass_mg",
    "form",
    "orientation",
    "synthesis_date",
    "polish_date",
    "created_by",
    "synthesized_by",
    "provided_by",
}
RAWDATA_PARAMETER_KEYS = {
    "strain_calculation",
}
RAWDATA_MATERIAL_OVERRIDE_KEYS = {
    "formula",
    "molar_mass_g_per_mol",
    "magnetic_element",
    "atoms_per_formula_unit",
    "normalization",
}
PREFERRED_PASSTHROUGH_COLUMNS = [
    "Time_sec",
    "Time (sec)",
    "Time",
    "Time Stamp (sec)",
]

LEGACY_SWEEP_MAP = {
    "magnetic field": "field",
    "field": "field",
    "temperature": "temperature",
}
LEGACY_FIXED_KEY_MAP = {
    "magnetic field": "field",
    "field": "field",
    "temperature": "temperature",
    "pressure": "pressure",
    "angle": "angle",
}


@dataclass(frozen=True)
class FilterContext:
    repo_root: Path
    source_path: Path
    material_id: str
    material_dir: Path
    sample_id: str
    sample_dir: Path
    measurement_type: str
    session_id: str
    session_dir: Path
    filter_id: str
    material_meta: dict[str, Any]
    sample_meta: dict[str, Any]
    parameter_meta: dict[str, Any]

    @property
    def session_meta(self) -> dict[str, Any]:
        # Compatibility shim for older calculators. New code should use parameter_meta.
        return self.parameter_meta


def resolve_path(root: Path, value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = root / path
    return path.resolve()


def relative_text(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"metadata not found: {path}")
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"metadata must be a JSON object: {path}")
    return payload


def load_optional_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return load_json(path)


def _root_relative_parts(root: Path, path: Path) -> tuple[str, ...] | None:
    try:
        return path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return None


def _is_flat_record_path(root: Path, source_path: Path, kind: str) -> bool:
    parts = _root_relative_parts(root, source_path)
    return bool(parts and len(parts) >= 3 and parts[0] == kind)


def source_metadata_path(root: Path, source_path: Path) -> Path:
    parts = _root_relative_parts(root, source_path)
    if parts and len(parts) >= 3 and parts[0] in {FLAT_RAWDATA_DIR, FLAT_DATA_DIR}:
        return root / parts[0] / parts[1] / FLAT_METADATA_NAME
    return source_path.with_suffix(".json")


def source_record_name(root: Path, source_path: Path) -> str:
    parts = _root_relative_parts(root, source_path)
    if parts and len(parts) >= 2 and parts[0] in {FLAT_RAWDATA_DIR, FLAT_DATA_DIR}:
        return parts[1]
    return source_path.parent.name if source_path.parent.name not in {FLAT_RAWDATA_DIR, FLAT_DATA_DIR, "data"} else source_path.stem


def _nested_value(payload: dict[str, Any], *keys: str) -> Any:
    current: Any = payload
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def metadata_kind(payload: dict[str, Any]) -> str:
    return _first_text(
        payload.get("kind"),
        payload.get("type"),
    )


def _normalize_sweep_name(value: Any) -> str:
    text = _first_text(value).lower()
    return LEGACY_SWEEP_MAP.get(text, text)


def _normalize_fixed_key(value: Any) -> str:
    text = _first_text(value).lower()
    return LEGACY_FIXED_KEY_MAP.get(text, text)


def metadata_conditions(payload: dict[str, Any]) -> dict[str, Any]:
    conditions_payload = payload.get("conditions")
    sweep_values: list[str] = []
    fixed_values: dict[str, str] = {}
    if isinstance(conditions_payload, dict):
        raw_sweep = conditions_payload.get("sweep")
        if isinstance(raw_sweep, list):
            for item in raw_sweep:
                name = _normalize_sweep_name(item)
                if name and name not in sweep_values:
                    sweep_values.append(name)
        elif raw_sweep is not None:
            name = _normalize_sweep_name(raw_sweep)
            if name:
                sweep_values.append(name)
        raw_fixed = conditions_payload.get("fixed")
        if isinstance(raw_fixed, dict):
            for key, value in raw_fixed.items():
                fixed_key = _normalize_fixed_key(key)
                fixed_value = _first_text(value)
                if fixed_key and fixed_value:
                    fixed_values[fixed_key] = fixed_value
    result: dict[str, Any] = {}
    if sweep_values:
        result["sweep"] = sweep_values
    if fixed_values:
        result["fixed"] = fixed_values
    return result


def merge_conditions(base: dict[str, Any] | None, extra: dict[str, Any] | None) -> dict[str, Any]:
    base = base or {}
    extra = extra or {}
    merged_sweep: list[str] = []
    for source in (base.get("sweep"), extra.get("sweep")):
        if isinstance(source, list):
            for item in source:
                name = _normalize_sweep_name(item)
                if name and name not in merged_sweep:
                    merged_sweep.append(name)
        elif source is not None:
            name = _normalize_sweep_name(source)
            if name and name not in merged_sweep:
                merged_sweep.append(name)
    merged_fixed: dict[str, str] = {}
    for source in (base.get("fixed"), extra.get("fixed")):
        if isinstance(source, dict):
            for key, value in source.items():
                fixed_key = _normalize_fixed_key(key)
                fixed_value = _first_text(value)
                if fixed_key and fixed_value and fixed_key not in merged_fixed:
                    merged_fixed[fixed_key] = fixed_value
    result: dict[str, Any] = {}
    if merged_sweep:
        result["sweep"] = merged_sweep
    if merged_fixed:
        result["fixed"] = merged_fixed
    return result


def inherited_data_metadata(context: FilterContext) -> dict[str, Any]:
    source_meta = load_optional_json(source_metadata_path(context.repo_root, context.source_path))
    payload: dict[str, Any] = {}
    kind = metadata_kind(source_meta)
    if kind:
        payload["kind"] = kind
    conditions = metadata_conditions(source_meta)
    if conditions:
        payload["conditions"] = conditions
    return payload


def _merge_metadata(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_metadata(merged[key], value)
        else:
            merged[key] = value
    return merged


def _load_first_json(paths: list[Path], *, required: bool = False, label: str = "metadata") -> tuple[dict[str, Any], Path | None]:
    for path in paths:
        if path.exists():
            return load_json(path), path
    if required and paths:
        raise FileNotFoundError(f"{label} not found: {paths[0]}")
    return {}, None


def _top_level_overrides(payload: dict[str, Any], keys: set[str]) -> dict[str, Any]:
    return {key: payload[key] for key in keys if key in payload}


def _material_meta_candidates(root: Path, material_id: str) -> list[Path]:
    return [
        root / FLAT_DB_DIR / FLAT_DB_MATERIALS_DIR / f"{material_id}.json",
    ]


def _sample_meta_candidates(root: Path, material_id: str, sample_id: str) -> list[Path]:
    del material_id
    return [
        root / FLAT_SAMPLES_DIR / sample_id / FLAT_METADATA_NAME,
    ]


def _build_flat_source_context(root: Path, source_path: Path, source_name: str | None = None) -> FilterContext:
    source_meta = load_json(source_metadata_path(root, source_path))

    # For data files: chain through rawdata metadata to resolve IDs and parameters.
    # Data metadata only stores rawdata_id; all entity IDs live in rawdata.
    rawdata_meta: dict[str, Any] = {}
    rawdata_id = _first_text(source_meta.get("rawdata_id"))
    if rawdata_id and _is_flat_record_path(root, source_path, FLAT_DATA_DIR):
        rawdata_meta = load_optional_json(root / FLAT_RAWDATA_DIR / rawdata_id / FLAT_METADATA_NAME)

    material_id = _first_text(
        source_meta.get("material_id"),
        rawdata_meta.get("material_id"),
        source_meta.get("material"),
        source_meta.get("materials"),
        _nested_value(source_meta, "source", "material_id"),
    )
    sample_id = _first_text(
        source_meta.get("sample_id"),
        rawdata_meta.get("sample_id"),
        source_meta.get("sample"),
        _nested_value(source_meta, "source", "sample_id"),
    )
    measurement_type = _first_text(
        source_meta.get("kind"),
        rawdata_meta.get("kind"),
        source_meta.get("type"),
    )
    session_id = _first_text(
        source_meta.get("session_id"),
        rawdata_meta.get("session_id"),
        source_meta.get("session"),
        source_meta.get("exp_id"),
        rawdata_meta.get("exp_id"),
        source_meta.get("exp"),
        _nested_value(source_meta, "source", "session_id"),
    )
    sample_meta: dict[str, Any] = {}
    sample_meta_path: Path | None = None
    if sample_id:
        sample_meta, sample_meta_path = _load_first_json(
            _sample_meta_candidates(root, material_id, sample_id),
            label="sample metadata",
            required=False,
        )

    material_id = _first_text(sample_meta.get("material_id"), material_id)

    material_meta: dict[str, Any] = {}
    material_meta_path: Path | None = None
    if material_id:
        material_meta, material_meta_path = _load_first_json(
            _material_meta_candidates(root, material_id),
            label="material metadata",
            required=False,
        )

    parameter_meta: dict[str, Any] = {}
    if isinstance(source_meta.get("material"), dict):
        material_meta = _merge_metadata(material_meta, source_meta["material"])
    material_meta = _merge_metadata(material_meta, _top_level_overrides(source_meta, RAWDATA_MATERIAL_OVERRIDE_KEYS))
    material_meta = _merge_metadata(material_meta, _top_level_overrides(rawdata_meta, RAWDATA_MATERIAL_OVERRIDE_KEYS))
    if isinstance(source_meta.get("sample"), dict):
        sample_meta = _merge_metadata(sample_meta, source_meta["sample"])
    sample_meta = _merge_metadata(sample_meta, _top_level_overrides(source_meta, RAWDATA_SAMPLE_OVERRIDE_KEYS))
    sample_meta = _merge_metadata(sample_meta, _top_level_overrides(rawdata_meta, RAWDATA_SAMPLE_OVERRIDE_KEYS))
    parameter_meta = _merge_metadata(parameter_meta, _top_level_overrides(rawdata_meta, RAWDATA_PARAMETER_KEYS))
    parameter_meta = _merge_metadata(parameter_meta, _top_level_overrides(source_meta, RAWDATA_PARAMETER_KEYS))

    filter_id = source_name or source_record_name(root, source_path) or source_path.stem
    material_dir = material_meta_path.parent if material_meta_path else root / FLAT_DB_DIR / FLAT_DB_MATERIALS_DIR / material_id
    sample_dir = sample_meta_path.parent if sample_meta_path else root / FLAT_SAMPLES_DIR / sample_id
    session_dir = root / FLAT_EXP_DIR / session_id
    return FilterContext(
        repo_root=root,
        source_path=source_path,
        material_id=material_id,
        material_dir=material_dir,
        sample_id=sample_id,
        sample_dir=sample_dir,
        measurement_type=measurement_type,
        session_id=session_id,
        session_dir=session_dir,
        filter_id=filter_id,
        material_meta=material_meta,
        sample_meta=sample_meta,
        parameter_meta=parameter_meta,
    )


def build_source_context(root: Path, source_path: Path, source_name: str | None = None) -> FilterContext:
    if not (_is_flat_record_path(root, source_path, FLAT_RAWDATA_DIR) or _is_flat_record_path(root, source_path, FLAT_DATA_DIR)):
        raise ValueError("source path must be under rawdata/<record>/<file> or data/<record>/<file>")
    return _build_flat_source_context(root, source_path, source_name=source_name)


def read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"CSV has no header: {path}")
        header = [name.strip() for name in reader.fieldnames]
        rows: list[dict[str, str]] = []
        for row in reader:
            rows.append({(key or "").strip(): (value or "").strip() for key, value in row.items()})
    return header, rows


def discover_data_files(root: Path) -> list[Path]:
    discovered: set[Path] = set()
    flat_data = root / FLAT_DATA_DIR
    if not flat_data.is_dir():
        return []
    for path in flat_data.rglob("*.csv"):
        if path.name.startswith(".") or not path.is_file():
            continue
        try:
            build_source_context(root, path, source_name=source_record_name(root, path))
        except Exception:
            continue
        discovered.add(path.resolve())
    return sorted(discovered)


def write_csv(path: Path, header: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=header)
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row.get(name, "") for name in header})


def parse_float(value: str) -> float | None:
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def first_existing(header: list[str], candidates: list[str]) -> str | None:
    for candidate in candidates:
        if candidate in header:
            return candidate
    return None


def data_output_paths(context: FilterContext, name: str) -> dict[str, Path]:
    data_dir = context.repo_root / FLAT_DATA_DIR / name
    return {
        "dir": data_dir,
        "csv": data_dir / f"{name}.csv",
        "json": data_dir / FLAT_METADATA_NAME,
    }


def next_data_id(root: Path, *, width: int = 6) -> str:
    data_root = root / FLAT_DATA_DIR
    used_ids = {
        path.name
        for path in data_root.iterdir()
        if path.is_dir()
    } if data_root.is_dir() else set()
    next_index = 1
    while True:
        candidate = f"{next_index:0{width}d}"
        if candidate not in used_ids:
            return candidate
        next_index += 1


def ensure_paths(paths: dict[str, Path], keys: list[str], overwrite: bool, repo_root: Path) -> dict[str, Path]:
    existing = [paths[key] for key in keys if key in paths and paths[key].exists()]
    if existing and not overwrite:
        names = ", ".join(relative_text(path, repo_root) for path in existing)
        raise FileExistsError(f"output already exists: {names}; use --overwrite")
    paths["dir"].mkdir(parents=True, exist_ok=True)
    return paths


def ensure_output_paths(context: FilterContext, name: str, overwrite: bool, keys: list[str] | None = None) -> dict[str, Path]:
    paths = data_output_paths(context, name)
    return ensure_paths(paths, keys or ["csv", "json"], overwrite, context.repo_root)


def write_metadata(path: Path, payload: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def remove_legacy_file(path: Path) -> None:
    if path.exists():
        path.unlink()


def timestamp() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def read_metadata(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"metadata must be a JSON object: {path}")
    return payload


def read_filter_metadata(source_path: Path) -> dict[str, Any]:
    return read_metadata(source_path.with_suffix(".json"))


def experiment_date(session_id: str) -> str:
    return session_id.removeprefix("exp-") if session_id.startswith("exp-") else session_id
