from __future__ import annotations

import datetime
import re
from pathlib import Path
from typing import Any

from pipeline.datagen import core as datagen_core

from . import core as datparser_core


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


def _time_from_metadata(metadata: dict[str, Any]) -> str:
    for key in TIME_KEYS:
        text = _text(metadata.get(key))
        if text:
            return text
    return ""


def record_time(raw_metadata: dict[str, Any], session_metadata: dict[str, Any], session_id: str) -> str:
    return _first_text(
        _time_from_metadata(raw_metadata),
        _time_from_metadata(session_metadata),
        datagen_core.experiment_date(session_id),
    )


def _file_mtime_ym(path: Path) -> str:
    """Return YYYY-MM-DD string from a file's mtime, or '' on error."""
    try:
        ts = path.stat().st_mtime
        return datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except OSError:
        return ""


def _session_date(session_id: str) -> str:
    match = re.match(r"^exp-(\d{6})$", session_id)
    if match:
        d = match.group(1)
        return f"20{d[:2]}-{d[2:4]}-{d[4:6]}"
    return ""


def _rawdata_detail(label: str) -> str:
    """Return the condition suffix from a human-readable rawdata label."""
    parts = label.split("__")
    return parts[4] if len(parts) >= 5 else ""


def _parse_dependance_fixed(measurement: str, suffix: str) -> tuple[str, str]:
    """Derive (dependance, fixed) from measurement type and folder suffix.

    Only handles magnetization for now; strain returns ("", "").
    """
    if measurement != "magnetization":
        return "", ""

    s = suffix.lower()

    # ── Pressure-cell measurements ─────────────────────────────────────────
    m_pa = re.match(r"(\d+)(mpa|pa)-", s)
    if m_pa:
        val = m_pa.group(1)
        unit = "MPa" if m_pa.group(2) == "mpa" else "MPa"
        return "temperature", f"pressure: {val}{unit}"

    # ── mh (field sweep) ───────────────────────────────────────────────────
    if s.startswith("mh-") or re.search(r"-mh-", s):
        m_t = re.search(r"mh-(\d+)k", s)
        fixed = f"temperature: {m_t.group(1)}K" if m_t else "temperature"
        return "magnetic field", fixed

    # ── mt / hpc temperature sweep ─────────────────────────────────────────
    # Extract measuring field (Oe takes priority over T)
    m_oe = re.search(r"(?:fc|zfc)-(neg)?(\d+)oe", s)
    if m_oe:
        sign = "-" if m_oe.group(1) else ""
        return "temperature", f"magnetic field: {sign}{m_oe.group(2)}Oe"

    m_t_after_fc = re.search(r"(?:fc|zfc)-(neg)?(\d+)t(?!\d)", s)
    if m_t_after_fc:
        sign = "-" if m_t_after_fc.group(1) else ""
        return "temperature", f"magnetic field: {sign}{m_t_after_fc.group(2)}T"

    # Simple mt-1000oe or hpc-1000oe
    m_simple_oe = re.match(r"(?:mt|hpc)-(\d+)oe", s)
    if m_simple_oe:
        return "temperature", f"magnetic field: {m_simple_oe.group(1)}Oe"

    # Fallback: mt-7t or hpc- without explicit field
    m_main_t = re.match(r"(?:mt|hpc)-(\d+)t", s)
    if m_main_t:
        return "temperature", f"magnetic field: {m_main_t.group(1)}T"

    return "temperature", ""


def _rawdata_created(path: Path, raw_metadata: dict[str, Any], session_id: str) -> str:
    return _first_text(
        _time_from_metadata(raw_metadata),
        _session_date(session_id),
        _file_mtime_ym(path),
    )


def _data_created(root: Path, path: Path) -> str:
    """Created date of a data file: use the source rawdata metadata/session."""
    try:
        raw = datparser_core.resolve_raw_source(root, path)
        if raw:
            raw_meta = datparser_core.read_raw_meta(raw)
            session_id = _text(raw_meta.get("session_id"))
            return _rawdata_created(raw, raw_meta, session_id)
    except Exception:
        pass
    return ""


def raw_entry(root: Path, path: Path) -> dict[str, object]:
    rel = datagen_core.relative_text(path, root)
    parts: dict[str, object] = {"material": "", "sample": "", "measurement": "", "session": ""}
    metadata: dict[str, Any] = {}
    try:
        context = datagen_core.build_source_context(root, path, source_name=datagen_core.source_record_name(root, path))
        parts = {
            "material": context.material_id,
            "sample": context.sample_id,
            "measurement": context.measurement_type,
            "session": context.session_id,
        }
    except Exception:
        pass
    try:
        metadata = datparser_core.read_raw_meta(path)
    except Exception:
        metadata = {}
    display_name = _first_text(metadata.get("display_name"), path.parent.name)
    label_parts = display_name.split("__")
    measurement = str(parts.get("measurement", "")) or (label_parts[2] if len(label_parts) >= 3 else "")
    suffix = _rawdata_detail(display_name)
    dependance, fixed = _parse_dependance_fixed(measurement, suffix)
    return {
        "id": path.parent.name,
        "path": rel,
        "file": path.name,
        "display_name": display_name,
        "created": _rawdata_created(path, metadata, _text(parts.get("session"))),
        "dependance": dependance,
        "fixed": fixed,
        **parts,
    }


def data_entry(root: Path, path: Path) -> dict[str, object]:
    rel = datagen_core.relative_text(path, root)
    parts: dict[str, object] = {"material": "", "sample": "", "measurement": "", "session": ""}
    raw_source = ""
    try:
        context = datagen_core.build_source_context(root, path, source_name=datagen_core.source_record_name(root, path))
        parts = {
            "material": context.material_id,
            "sample": context.sample_id,
            "measurement": context.measurement_type,
            "session": context.session_id,
        }
    except Exception:
        pass
    try:
        meta_path = path.parent / datagen_core.FLAT_METADATA_NAME
        meta = datagen_core.load_optional_json(meta_path)
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
    except Exception:
        pass
    return {
        "path": rel,
        "file": path.name,
        "created": _data_created(root, path),
        "raw_source": raw_source,
        **parts,
    }


def _raw_entries(root: Path) -> list[dict[str, object]]:
    return [raw_entry(root, path) for path in datparser_core.discover_raw_files(root)]


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
        session_id = meta_path.parent.name
        display_name = _first_text(metadata.get("display_name"), session_id)
        # Derive material/sample/type from rawdata belonging to this session
        session_raws = [item for item in raw_entries if item.get("session") == session_id]
        material = _first_text(*(str(item.get("material", "")) for item in session_raws))
        sample = _first_text(*(str(item.get("sample", "")) for item in session_raws))
        mtype = _first_text(*(str(item.get("measurement", "")) for item in session_raws))
        entries.append(
            {
                "id": session_id,
                "display_name": display_name,
                "path": datagen_core.relative_text(meta_path, root),
                "material": material,
                "sample": sample,
                "type": mtype,
                "samples": list({str(item.get("sample", "")) for item in session_raws if item.get("sample")}),
                "time": record_time(metadata, metadata, session_id),
                "raw_count": len(session_raws),
                "data_count": sum(1 for item in data_entries if item.get("session") == session_id),
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


def experiment_detail(root: Path, session_id: str) -> dict[str, object]:
    record_dir = root / datagen_core.FLAT_EXP_DIR / session_id
    metadata_path = record_dir / datagen_core.FLAT_METADATA_NAME
    metadata = datagen_core.load_json(metadata_path)
    raw_links = [item for item in _raw_entries(root) if item.get("session") == session_id]
    data_links = [item for item in _data_entries(root) if item.get("session") == session_id]
    return {
        "id": session_id,
        "display_name": _first_text(metadata.get("display_name"), session_id),
        "dir_path": datagen_core.relative_text(record_dir, root),
        "metadata_path": datagen_core.relative_text(metadata_path, root),
        "metadata": metadata,
        "attachments": _attachments(record_dir, root) if record_dir.exists() else [],
        "rawdata": raw_links,
        "data": data_links,
    }


ANALYSIS_DIR = "analysis"
ANALYSIS_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ANALYSIS_SCRIPT_EXTS = {".py", ".ipynb", ".r", ".jl"}


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
            "project_name": _first_text(meta.get("project_name"), project_id),
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

    # Resolve source_data paths to repo-relative using proper relative resolution
    root_resolved = root.resolve()
    source_data_raw = meta.get("source_data") or []
    source_data: list[dict[str, object]] = []
    for raw_ref in source_data_raw:
        # Resolve relative to the actual analysis project directory
        try:
            actual = (record_dir / raw_ref).resolve()
            rel_path = str(actual.relative_to(root_resolved))
        except (ValueError, OSError):
            rel_path = str(raw_ref)

        data_id = None
        raw_source = None
        rel_parts = rel_path.replace("\\", "/").split("/")
        if len(rel_parts) >= 2 and rel_parts[0] == "data":
            data_id = rel_parts[1]
            data_meta_path = root / "data" / data_id / datagen_core.FLAT_METADATA_NAME
            if data_meta_path.exists():
                data_meta = datagen_core.load_optional_json(data_meta_path)
                raw_csv = data_meta.get("source", {}).get("rawdata_csv", "")
                if raw_csv:
                    raw_source = str(raw_csv)
        source_data.append({
            "ref": raw_ref,
            "path": rel_path,
            "data_id": data_id,
            "exists": (root / rel_path).exists(),
            "raw_source": raw_source,
        })

    return {
        "id": project_id,
        "project_name": _first_text(meta.get("project_name"), project_id),
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
