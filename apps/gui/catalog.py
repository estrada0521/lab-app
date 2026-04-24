from __future__ import annotations

import datetime
import json
import logging
import re
from pathlib import Path
from typing import Any

from pipeline.datagen import core as datagen_core

from . import core as lab_core

_log = logging.getLogger(__name__)


TIME_KEYS = (
    "time",
    "datetime",
    "measured_at",
    "date",
    "experiment_date",
)


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    return ""


def _first_text(*values: Any) -> str:
    for value in values:
        text = _text(value)
        if text:
            return text
    return ""


def _conditions_sweep_text(metadata: dict[str, Any]) -> str:
    conditions = datagen_core.metadata_conditions(metadata)
    sweep = conditions.get("sweep")
    if isinstance(sweep, list):
        return ", ".join(str(item) for item in sweep if str(item).strip())
    return ""


def _conditions_fixed_text(metadata: dict[str, Any]) -> str:
    conditions = datagen_core.metadata_conditions(metadata)
    fixed = conditions.get("fixed")
    if not isinstance(fixed, dict):
        return ""
    return ", ".join(f"{key}: {value}" for key, value in fixed.items() if _text(value))


def _time_from_metadata(metadata: dict[str, Any]) -> str:
    for key in TIME_KEYS:
        text = _text(metadata.get(key))
        if text:
            return text
    return ""


def record_time(raw_metadata: dict[str, Any], exp_metadata: dict[str, Any], exp_id: str) -> str:
    return _first_text(
        _time_from_metadata(raw_metadata),
        _time_from_metadata(exp_metadata),
        datagen_core.experiment_date(exp_id),
    )


def _file_mtime_ym(path: Path) -> str:
    """Return YYYY-MM-DD string from a file's mtime, or '' on error."""
    try:
        ts = path.stat().st_mtime
        return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except OSError:
        return ""


def _exp_date(exp_id: str) -> str:
    match = re.match(r"^exp-(\d{6})$", exp_id)
    if match:
        d = match.group(1)
        return f"20{d[:2]}-{d[2:4]}-{d[4:6]}"
    return ""


def _rawdata_created(path: Path, raw_metadata: dict[str, Any], exp_id: str) -> str:
    return _first_text(
        _time_from_metadata(raw_metadata),
        _exp_date(exp_id),
        _file_mtime_ym(path),
    )


def _data_created(root: Path, path: Path) -> str:
    """Created date of a data file: use the source rawdata metadata/exp."""
    try:
        raw = lab_core.resolve_raw_source(root, path)
        if raw:
            raw_meta = lab_core.read_raw_meta(raw)
            exp_id = _text(raw_meta.get("exp_id"))
            return _rawdata_created(raw, raw_meta, exp_id)
    except (OSError, json.JSONDecodeError, ValueError):
        pass
    return ""


def raw_entry(root: Path, path: Path) -> dict[str, object]:
    rel = datagen_core.relative_text(path, root)
    parts: dict[str, object] = {"material": "", "sample": "", "measurement": "", "exp": ""}
    metadata: dict[str, Any] = {}
    try:
        context = datagen_core.build_source_context(root, path, source_name=datagen_core.source_record_name(root, path))
        parts = {
            "material": context.material_id,
            "sample": context.sample_id,
            "measurement": context.kind,
            "exp": context.exp_id,
        }
    except Exception as exc:
        _log.debug("build_source_context failed for %s: %s", path, exc)
    try:
        metadata = lab_core.read_raw_meta(path)
    except (OSError, json.JSONDecodeError):
        metadata = {}
    display_name = _first_text(metadata.get("display_name"), path.parent.name)
    return {
        "id": path.parent.name,
        "path": rel,
        "file": path.name,
        "display_name": display_name,
        "created": _rawdata_created(path, metadata, _text(parts.get("exp"))),
        "dependance": _conditions_sweep_text(metadata),
        "fixed": _conditions_fixed_text(metadata),
        **parts,
    }


def data_entry(root: Path, path: Path) -> dict[str, object]:
    rel = datagen_core.relative_text(path, root)
    parts: dict[str, object] = {"material": "", "sample": "", "measurement": "", "exp": ""}
    raw_source = ""
    display_name = path.parent.name
    dependance = ""
    fixed = ""
    try:
        context = datagen_core.build_source_context(root, path, source_name=datagen_core.source_record_name(root, path))
        parts = {
            "material": context.material_id,
            "sample": context.sample_id,
            "measurement": context.kind,
            "exp": context.exp_id,
        }
    except Exception as exc:
        _log.debug("build_source_context failed for %s: %s", path, exc)
    try:
        meta_path = path.parent / datagen_core.FLAT_METADATA_NAME
        meta = datagen_core.load_optional_json(meta_path)
        display_name = _first_text(meta.get("display_name"), path.parent.name)
        dependance = _conditions_sweep_text(meta)
        fixed = _conditions_fixed_text(meta)
        # New schema: rawdata_id replaces source.rawdata_csv
        rawdata_id = meta.get("rawdata_id", "")
        if rawdata_id:
            raw_dir = root / datagen_core.FLAT_RAWDATA_DIR / rawdata_id
            candidates = list(raw_dir.glob("*.csv")) + list(raw_dir.glob("*.dat"))
            if candidates:
                raw_source = datagen_core.relative_text(candidates[0], root)
        else:
            # Legacy schema fallback
            src = meta.get("source", {})
            raw_csv = src.get("rawdata_csv", "") if isinstance(src, dict) else ""
            if raw_csv:
                raw_source = str(raw_csv)
    except (OSError, json.JSONDecodeError, ValueError, KeyError) as exc:
        _log.debug("data_entry metadata failed for %s: %s", path, exc)
    return {
        "id": path.parent.name,
        "path": rel,
        "file": path.name,
        "display_name": display_name,
        "created": _data_created(root, path),
        "raw_source": raw_source,
        "dependance": dependance,
        "fixed": fixed,
        **parts,
    }


def _raw_entries(root: Path) -> list[dict[str, object]]:
    return [raw_entry(root, path) for path in lab_core.discover_raw_files(root)]


def _data_entries(root: Path) -> list[dict[str, object]]:
    return [data_entry(root, path) for path in datagen_core.discover_data_files(root)]


def _find_main_image(record_dir: Path) -> Path | None:
    images_dir = record_dir / "images"
    if not images_dir.is_dir():
        return None
    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    for ext in image_exts:
        candidate = images_dir / f"main{ext}"
        if candidate.exists():
            return candidate
    for path in sorted(images_dir.iterdir()):
        if path.suffix.lower() in image_exts:
            return path
    return None


def _sample_metadata_paths(root: Path) -> list[Path]:
    return sorted((root / datagen_core.FLAT_SAMPLES_DIR).glob(f"*/{datagen_core.FLAT_METADATA_NAME}"))


def _experiment_metadata_paths(root: Path) -> list[Path]:
    return sorted((root / datagen_core.FLAT_EXP_DIR).glob(f"*/{datagen_core.FLAT_METADATA_NAME}"))


def sample_entries(root: Path) -> list[dict[str, object]]:
    raw_entries = _raw_entries(root)
    data_entries = _data_entries(root)
    entries: list[dict[str, object]] = []
    for meta_path in _sample_metadata_paths(root):
        metadata = datagen_core.load_optional_json(meta_path)
        sample_id = meta_path.parent.name
        display_name = _first_text(metadata.get("display_name"), sample_id)
        entries.append(
            {
                "id": sample_id,
                "display_name": display_name,
                "path": datagen_core.relative_text(meta_path, root),
                "material": _text(metadata.get("material_id")),
                "owner": _text(metadata.get("owner")),
                "orientation": _text(metadata.get("orientation")),
                "sample": sample_id,
                "type": _text(metadata.get("form")),
                "time": _first_text(metadata.get("polish_date"), metadata.get("synthesis_date")),
                "raw_count": sum(1 for item in raw_entries if item.get("sample") == sample_id),
                "data_count": sum(1 for item in data_entries if item.get("sample") == sample_id),
            }
        )
    return entries


def experiment_entries(root: Path) -> list[dict[str, object]]:
    raw_entries = _raw_entries(root)
    data_entries = _data_entries(root)
    entries: list[dict[str, object]] = []
    for meta_path in _experiment_metadata_paths(root):
        metadata = datagen_core.load_optional_json(meta_path)
        exp_id = meta_path.parent.name
        display_name = _first_text(metadata.get("display_name"), exp_id)
        exp_raws = [item for item in raw_entries if item.get("exp") == exp_id]
        material = _first_text(*(str(item.get("material", "")) for item in exp_raws))
        sample = _first_text(*(str(item.get("sample", "")) for item in exp_raws))
        mtype = _first_text(*(str(item.get("measurement", "")) for item in exp_raws))
        entries.append(
            {
                "id": exp_id,
                "display_name": display_name,
                "path": datagen_core.relative_text(meta_path, root),
                "material": material,
                "sample": sample,
                "type": mtype,
                "samples": list({str(item.get("sample", "")) for item in exp_raws if item.get("sample")}),
                "start_date": _text(metadata.get("start_date")),
                "end_date": _text(metadata.get("end_date")),
                "time": record_time(metadata, metadata, exp_id),
                "raw_count": len(exp_raws),
                "data_count": sum(1 for item in data_entries if item.get("exp") == exp_id),
            }
        )
    return entries


def _attachments(record_dir: Path, root: Path) -> list[str]:
    return sorted(
        datagen_core.relative_text(path, root)
        for path in record_dir.iterdir()
        if path.name != datagen_core.FLAT_METADATA_NAME
    )


def sample_detail(root: Path, sample_id: str) -> dict[str, object]:
    record_dir = root / datagen_core.FLAT_SAMPLES_DIR / sample_id
    metadata_path = record_dir / datagen_core.FLAT_METADATA_NAME
    metadata = datagen_core.load_json(metadata_path)
    raw_links = [item for item in _raw_entries(root) if item.get("sample") == sample_id]
    data_links = [item for item in _data_entries(root) if item.get("sample") == sample_id]
    record_dir = root / datagen_core.FLAT_SAMPLES_DIR / sample_id
    main_image = _find_main_image(record_dir)
    exp_links = [item for item in experiment_entries(root) if sample_id in item.get("samples", [item.get("sample", "")])]
    return {
        "id": sample_id,
        "display_name": _first_text(metadata.get("display_name"), sample_id),
        "dir_path": datagen_core.relative_text(record_dir, root),
        "metadata_path": datagen_core.relative_text(metadata_path, root),
        "metadata": metadata,
        "main_image": datagen_core.relative_text(main_image, root) if main_image else None,
        "attachments": _attachments(record_dir, root) if record_dir.exists() else [],
        "rawdata": raw_links,
        "data": data_links,
        "experiments": exp_links,
    }


def experiment_detail(root: Path, exp_id: str) -> dict[str, object]:
    record_dir = root / datagen_core.FLAT_EXP_DIR / exp_id
    metadata_path = record_dir / datagen_core.FLAT_METADATA_NAME
    metadata = datagen_core.load_json(metadata_path)
    raw_links = [item for item in _raw_entries(root) if item.get("exp") == exp_id]
    data_links = [item for item in _data_entries(root) if item.get("exp") == exp_id]
    sample_ids = list(dict.fromkeys(
        str(item["sample"]) for item in raw_links if item.get("sample")
    ))
    sample_entries_by_id = {str(item.get("id")): item for item in sample_entries(root)}
    sample_links = [sample_entries_by_id[sid] for sid in sample_ids if sid in sample_entries_by_id]
    return {
        "id": exp_id,
        "display_name": _first_text(metadata.get("display_name"), exp_id),
        "dir_path": datagen_core.relative_text(record_dir, root),
        "metadata_path": datagen_core.relative_text(metadata_path, root),
        "metadata": metadata,
        "attachments": _attachments(record_dir, root) if record_dir.exists() else [],
        "samples": sample_links,
        "rawdata": raw_links,
        "data": data_links,
    }


ANALYSIS_DIR = "analysis"
ANALYSIS_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ANALYSIS_SCRIPT_EXTS = {".py", ".ipynb", ".r", ".jl"}

BUILD_DIR = "build"


def _analysis_metadata_paths(root: Path) -> list[Path]:
    d = root / ANALYSIS_DIR
    if not d.is_dir():
        return []
    return sorted(d.glob(f"*/{datagen_core.FLAT_METADATA_NAME}"))


def analysis_entries(root: Path) -> list[dict[str, object]]:
    entries = []
    for meta_path in _analysis_metadata_paths(root):
        meta = datagen_core.load_optional_json(meta_path)
        project_id = meta_path.parent.name
        entries.append({
            "id": project_id,
            "display_name": _first_text(meta.get("display_name"), project_id),
            "description": _text(meta.get("description")),
            "created_at": _text(meta.get("created_at")),
            "updated_at": _text(meta.get("updated_at")),
            "source_count": len(meta.get("source_data") or []),
        })
    return entries


def analysis_detail(root: Path, project_id: str) -> dict[str, object]:
    record_dir = root / ANALYSIS_DIR / project_id
    if not record_dir.is_dir():
        return {"error": f"analysis/{project_id} not found"}
    metadata_path = record_dir / datagen_core.FLAT_METADATA_NAME
    meta = datagen_core.load_optional_json(metadata_path)

    images: list[str] = []
    scripts: list[str] = []
    for f in sorted(record_dir.iterdir()):
        if f.name.startswith(".") or f.name == datagen_core.FLAT_METADATA_NAME:
            continue
        if f.is_file():
            ext = f.suffix.lower()
            rel = datagen_core.relative_text(f, root)
            if ext in ANALYSIS_IMAGE_EXTS:
                images.append(rel)
            elif ext in ANALYSIS_SCRIPT_EXTS:
                scripts.append(rel)

    # source_data is data-id based.
    source_data_raw = meta.get("source_data") or []
    source_data: list[dict[str, object]] = []
    data_entries_by_id = {str(item.get("id")): item for item in _data_entries(root)}
    raw_entries_by_path = {str(item.get("path")): item for item in _raw_entries(root)}
    for raw_ref in source_data_raw:
        ref_text = _text(raw_ref)
        if not ref_text:
            continue
        data_id = ref_text
        rel_path = f"data/{data_id}/{data_id}.csv"
        raw_source = None
        if data_id:
            data_meta_path = root / "data" / data_id / datagen_core.FLAT_METADATA_NAME
            if data_meta_path.exists():
                data_meta = datagen_core.load_optional_json(data_meta_path)
                rawdata_id = _text(data_meta.get("rawdata_id"))
                if rawdata_id:
                    raw_dir = root / "rawdata" / rawdata_id
                    candidates = list(raw_dir.glob("*.csv")) + list(raw_dir.glob("*.dat"))
                    if candidates:
                        raw_source = datagen_core.relative_text(candidates[0], root)
        source_data.append({
            "ref": ref_text,
            "path": rel_path,
            "data_id": data_id,
            "display_name": _first_text(data_entries_by_id.get(data_id, {}).get("display_name"), data_id),
            "exists": (root / rel_path).exists(),
            "raw_source": raw_source,
            "raw_display_name": _first_text(raw_entries_by_path.get(raw_source or "", {}).get("display_name"), raw_source),
        })

    return {
        "id": project_id,
        "display_name": _first_text(meta.get("display_name"), project_id),
        "description": _text(meta.get("description")),
        "created_at": _text(meta.get("created_at")),
        "updated_at": _text(meta.get("updated_at")),
        "memo": _text(meta.get("memo")),
        "memo_updated_at": _text(meta.get("memo_updated_at")),
        "dir_path": datagen_core.relative_text(record_dir, root),
        "metadata_path": datagen_core.relative_text(metadata_path, root),
        "source_data": source_data,
        "images": images,
        "scripts": scripts,
        "metadata": meta,
    }


def _build_metadata_paths(root: Path) -> list[Path]:
    d = root / BUILD_DIR
    if not d.is_dir():
        return []
    return sorted(d.glob(f"*/{datagen_core.FLAT_METADATA_NAME}"))


def build_entries(root: Path) -> list[dict[str, object]]:
    entries = []
    for meta_path in _build_metadata_paths(root):
        meta = datagen_core.load_optional_json(meta_path)
        build_id = meta_path.parent.name
        entries.append({
            "id": build_id,
            "display_name": _first_text(meta.get("display_name"), build_id),
            "description": _text(meta.get("description")),
            "created_at": _text(meta.get("created_at")),
            "updated_at": _text(meta.get("updated_at")),
            "source_count": len(meta.get("source_analysis") or []),
        })
    return entries


def build_detail(root: Path, build_id: str) -> dict[str, object]:
    record_dir = root / BUILD_DIR / build_id
    if not record_dir.is_dir():
        return {"error": f"build/{build_id} not found"}
    metadata_path = record_dir / datagen_core.FLAT_METADATA_NAME
    meta = datagen_core.load_optional_json(metadata_path)

    images: list[str] = []
    attachments: list[str] = []
    for f in sorted(record_dir.iterdir()):
        if f.name.startswith(".") or f.name == datagen_core.FLAT_METADATA_NAME:
            continue
        if f.is_file():
            ext = f.suffix.lower()
            rel = datagen_core.relative_text(f, root)
            if ext in ANALYSIS_IMAGE_EXTS:
                images.append(rel)
            else:
                attachments.append(rel)

    output_files_raw = meta.get("output_files") or []
    output_files: list[dict[str, object]] = []
    for rel in output_files_raw:
        rel_text = _text(rel)
        if not rel_text:
            continue
        abs_path = record_dir / rel_text
        output_files.append({
            "path": datagen_core.relative_text(abs_path, root),
            "name": abs_path.name,
            "suffix": abs_path.suffix.lower(),
            "exists": abs_path.is_file(),
        })

    source_analysis_raw = meta.get("source_analysis") or []
    source_analysis: list[dict[str, object]] = []
    analysis_entries_by_id = {str(item.get("id")): item for item in analysis_entries(root)}
    for raw_ref in source_analysis_raw:
        ref_text = _text(raw_ref)
        if not ref_text:
            continue
        analysis_id = ref_text
        analysis_dir = root / ANALYSIS_DIR / analysis_id
        source_analysis.append({
            "ref": ref_text,
            "analysis_id": analysis_id,
            "display_name": _first_text(
                analysis_entries_by_id.get(analysis_id, {}).get("display_name"),
                analysis_id,
            ),
            "exists": analysis_dir.is_dir(),
        })

    return {
        "id": build_id,
        "display_name": _first_text(meta.get("display_name"), build_id),
        "description": _text(meta.get("description")),
        "created_at": _text(meta.get("created_at")),
        "updated_at": _text(meta.get("updated_at")),
        "memo": _text(meta.get("memo")),
        "memo_updated_at": _text(meta.get("memo_updated_at")),
        "dir_path": datagen_core.relative_text(record_dir, root),
        "metadata_path": datagen_core.relative_text(metadata_path, root),
        "source_analysis": source_analysis,
        "output_files": output_files,
        "images": images,
        "attachments": attachments,
        "metadata": meta,
    }
