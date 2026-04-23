#!/usr/bin/env python3
"""
Local GUI support for browsing rawdata files and preparing derived data.

Run:
  python -m apps.gui

Supported input:
  - CSV files with a header row
  - DAT files whose table starts after a [Data] line

This module contains table parsing, plotting support, and path resolution helpers
used by the GUI server.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote


RAW_FILE_SUFFIXES = {".csv", ".dat"}
DATA_MARKER = "[Data]"
PLOT_MAX_POINTS = 2500
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
REPO_ROOT = Path.cwd().resolve()
FLAT_RAWDATA_DIR = "rawdata"
FLAT_DATA_DIR = "data"
FLAT_METADATA_NAME = "metadata.json"


@dataclass
class TableData:
    source_path: Path
    header: list[str]
    rows: list[list[str]]
    data_start_line: int


def discover_raw_files(root: Path) -> list[Path]:
    files: list[Path] = []
    materials = root / "Materials"
    if materials.exists():
        for raw_dir in materials.rglob("rawdata"):
            if not raw_dir.is_dir():
                continue
            for path in raw_dir.iterdir():
                if path.name.startswith("."):
                    continue
                if path.suffix.lower() in RAW_FILE_SUFFIXES and path.is_file():
                    files.append(path)
    flat_rawdata = root / FLAT_RAWDATA_DIR
    if flat_rawdata.is_dir():
        for record_dir in flat_rawdata.iterdir():
            if record_dir.name.startswith(".") or not record_dir.is_dir():
                continue
            for path in record_dir.iterdir():
                if path.name.startswith("."):
                    continue
                if path.suffix.lower() in RAW_FILE_SUFFIXES and path.is_file():
                    files.append(path)
    return sorted(files)


def read_text_lines(path: Path) -> list[str]:
    encodings = ["utf-8-sig", "utf-8", "cp932", "shift_jis", "latin-1"]
    last_error: UnicodeDecodeError | None = None
    for encoding in encodings:
        try:
            return path.read_text(encoding=encoding).splitlines()
        except UnicodeDecodeError as exc:
            last_error = exc
    raise ValueError(f"could not decode {path}: {last_error}")


def make_unique_headers(raw_header: Iterable[str]) -> list[str]:
    headers: list[str] = []
    counts: dict[str, int] = {}
    for index, value in enumerate(raw_header, start=1):
        name = value.strip() or f"column_{index}"
        counts[name] = counts.get(name, 0) + 1
        if counts[name] > 1:
            name = f"{name}_{counts[name]}"
        headers.append(name)
    return headers


def normalize_rows(header: list[str], rows: list[list[str]]) -> list[list[str]]:
    width = len(header)
    normalized: list[list[str]] = []
    for row in rows:
        if len(row) < width:
            row = row + [""] * (width - len(row))
        elif len(row) > width:
            row = row[:width]
        normalized.append(row)
    return normalized


def trim_empty_tail(header: list[str], rows: list[list[str]]) -> tuple[list[str], list[list[str]]]:
    while header and not header[-1]:
        tail_index = len(header) - 1
        if any(len(row) > tail_index and row[tail_index] != "" for row in rows):
            break
        header = header[:-1]
        rows = [row[:-1] if len(row) > tail_index else row for row in rows]
    return header, rows


def parse_table(path: Path) -> TableData:
    lines = read_text_lines(path)
    data_start_line = 1
    table_lines = lines

    if path.suffix.lower() == ".dat":
        marker_index = next((i for i, line in enumerate(lines) if line.strip() == DATA_MARKER), None)
        if marker_index is None:
            raise ValueError(f"[Data] section not found: {path}")
        data_start_line = marker_index + 2
        table_lines = lines[marker_index + 1 :]

    reader = csv.reader(table_lines)
    try:
        raw_header = next(reader)
    except StopIteration as exc:
        raise ValueError(f"no table header found: {path}") from exc

    raw_rows = [row for row in reader if row]
    raw_header, raw_rows = trim_empty_tail(raw_header, raw_rows)
    header = make_unique_headers(raw_header)
    rows = normalize_rows(header, raw_rows)
    return TableData(source_path=path, header=header, rows=rows, data_start_line=data_start_line)


def parse_float(value: str) -> float | None:
    value = value.strip()
    if not value:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def numeric_range(rows: list[list[str]], column_index: int) -> tuple[float, float] | None:
    values = [parse_float(row[column_index]) for row in rows if column_index < len(row)]
    numbers = [value for value in values if value is not None]
    if not numbers:
        return None
    return min(numbers), max(numbers)


def downsample(points: list[tuple[float, float]], limit: int) -> list[tuple[float, float]]:
    if len(points) <= limit:
        return points
    step = len(points) / limit
    return [points[int(i * step)] for i in range(limit)]


def relative_text(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _root_relative_parts(root: Path, path: Path) -> tuple[str, ...] | None:
    try:
        return path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return None


def _is_flat_record_file(root: Path, path: Path, kind: str) -> bool:
    parts = _root_relative_parts(root, path)
    return bool(parts and len(parts) >= 3 and parts[0] == kind and path.is_file())


def _is_flat_rawdata_file(root: Path, path: Path) -> bool:
    return _is_flat_record_file(root, path, FLAT_RAWDATA_DIR)


def _artifact_meta_path(root: Path, path: Path) -> Path:
    parts = _root_relative_parts(root, path)
    if parts and len(parts) >= 3 and parts[0] in {FLAT_RAWDATA_DIR, FLAT_DATA_DIR}:
        return root / parts[0] / parts[1] / FLAT_METADATA_NAME
    return path.with_suffix(".json")


def path_from_client(root: Path, value: str) -> Path:
    if not value:
        raise ValueError("path is empty")
    decoded = unquote(value)
    path = Path(decoded)
    if not path.is_absolute():
        path = root / path
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise ValueError(f"path must be inside repository root: {decoded}")
    if not resolved.exists():
        raise ValueError(f"file not found: {decoded}")
    return resolved


def preferred_column(headers: list[str], candidates: list[str], fallback_index: int) -> str:
    for candidate in candidates:
        if candidate in headers:
            return candidate
    if not headers:
        return ""
    return headers[min(fallback_index, len(headers) - 1)]


def column_summaries(table: TableData) -> list[dict[str, Any]]:
    columns: list[dict[str, Any]] = []
    for index, name in enumerate(table.header):
        values = [parse_float(row[index]) for row in table.rows if index < len(row)]
        numbers = [value for value in values if value is not None]
        value_range = (min(numbers), max(numbers)) if numbers else None
        columns.append(
            {
                "name": name,
                "min": None if value_range is None else value_range[0],
                "max": None if value_range is None else value_range[1],
                "numeric": bool(numbers),
                "numeric_count": len(numbers),
                "source_index": index,
            }
        )
    return sorted(columns, key=lambda c: (-int(c["numeric_count"]), int(c["source_index"])))


def suggested_axes(columns: list[dict[str, Any]], source_path: Path) -> tuple[str, str]:
    usable = [str(column["name"]) for column in columns if int(column.get("numeric_count", 0)) > 0]
    if not usable:
        names = [str(column["name"]) for column in columns]
        return preferred_column(names, [], 0), preferred_column(names, [], 1)

    path_parts = set(source_path.parts)
    if "magnetization" in path_parts:
        x_axis = preferred_column(
            usable,
            ["Temperature (K)", "Average Temp (K)", "Time Stamp (sec)", "Time"],
            0,
        )
        y_candidates = [name for name in usable if name != x_axis]
        y_axis = preferred_column(
            y_candidates or usable,
            [
                "DC Moment Fixed Ctr (emu)",
                "DC Moment Fixed Car (emu)",
                "Moment (emu)",
                "Long Moment (emu)",
            ],
            0,
        )
        return x_axis, y_axis

    x_axis = preferred_column(usable, ["Time_sec", "Time", "Time Stamp (sec)", "Temperature (K)"], 0)
    y_candidates = [name for name in usable if name != x_axis]
    y_axis = preferred_column(
        y_candidates or usable,
        ["Lockin_data_1", "Long Moment (emu)", "Moment (emu)", "Temperature (K)", "Field (Oe)"],
        0,
    )
    return x_axis, y_axis


def table_summary(table: TableData) -> dict[str, Any]:
    columns = column_summaries(table)
    suggested_x, suggested_y = suggested_axes(columns, table.source_path)
    return {
        "source": relative_text(table.source_path, REPO_ROOT),
        "rows": len(table.rows),
        "data_start_line": table.data_start_line,
        "columns": columns,
        "suggested_x": suggested_x,
        "suggested_y": suggested_y,
    }


def plot_points(table: TableData, x_column: str, y_column: str) -> dict[str, Any]:
    if x_column not in table.header:
        raise ValueError(f"x column not found: {x_column}")
    if y_column not in table.header:
        raise ValueError(f"y column not found: {y_column}")
    x_index = table.header.index(x_column)
    y_index = table.header.index(y_column)
    points: list[tuple[float, float]] = []
    for row in table.rows:
        x = parse_float(row[x_index])
        y = parse_float(row[y_index])
        if x is not None and y is not None:
            points.append((x, y))
    sampled = downsample(points, PLOT_MAX_POINTS)
    return {
        "points": sampled,
        "total_points": len(points),
        "shown_points": len(sampled),
    }


def raw_meta_path(raw_path: Path) -> Path:
    return _artifact_meta_path(REPO_ROOT, raw_path)


def _rawdata_record_id(raw_path: Path) -> str:
    return raw_path.parent.name


def _rawdata_payload_file(raw_path: Path) -> str:
    return raw_path.name


def _rawdata_payload_stem(raw_path: Path) -> str:
    return raw_path.stem or _rawdata_record_id(raw_path)


def read_raw_meta(raw_path: Path) -> dict[str, Any]:
    meta_path = raw_meta_path(raw_path)
    if not meta_path.exists():
        return {
            "memo": "",
            "updated_at": None,
            "display_name": _rawdata_payload_stem(raw_path),
            "payload_file": _rawdata_payload_file(raw_path),
        }
    try:
        payload = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"failed to parse raw metadata: {meta_path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"raw metadata must be a JSON object: {meta_path}")
    payload["display_name"] = str(payload.get("display_name") or payload.get("rawdata_name") or _rawdata_payload_stem(raw_path))
    payload["payload_file"] = str(payload.get("payload_file") or _rawdata_payload_file(raw_path))
    payload.pop("rawdata_id", None)
    payload.pop("rawdata_name", None)
    memo = payload.get("memo", "")
    payload["memo"] = memo if isinstance(memo, str) else ""
    payload["updated_at"] = payload.get("updated_at")
    return payload


def _is_rawdata_file(path: Path) -> bool:
    return (path.parent.name == "rawdata" or _is_flat_rawdata_file(REPO_ROOT, path)) and path.suffix.lower() in RAW_FILE_SUFFIXES and path.is_file()


def _session_dir_for_generated_path(path: Path) -> Path | None:
    parts = path.parts
    marker_indices = [index for index, part in enumerate(parts) if part == "data"]
    if not marker_indices:
        return None
    marker_index = marker_indices[-1]
    if marker_index <= 0:
        return None
    return Path(*parts[:marker_index])


def _candidate_raw_stems(path: Path) -> list[str]:
    stems: list[str] = []
    for stem in [path.stem, path.parent.name]:
        if stem and stem not in {"rawdata", "data"} and stem not in stems:
            stems.append(stem)
        if stem.endswith("-filtered"):
            base = stem.removesuffix("-filtered")
            if base and base not in stems:
                stems.append(base)
    return stems


def _fallback_raw_source(path: Path) -> Path | None:
    session_dir = _session_dir_for_generated_path(path)
    if session_dir is None:
        return None
    raw_dir = session_dir / "rawdata"
    if not raw_dir.is_dir():
        return None
    for stem in _candidate_raw_stems(path):
        for suffix in sorted(RAW_FILE_SUFFIXES):
            candidate = raw_dir / f"{stem}{suffix}"
            if candidate.is_file():
                return candidate.resolve()
    return None


def resolve_raw_source(root: Path, path: Path) -> Path | None:
    """Trace a derived data path back to the rawdata file that fed it.

    Uses the sidecar JSON's ``source`` fields when
    present. Falls back to matching the generated filename against the sibling
    rawdata folder when older metadata is missing.
    """
    visited: set[Path] = set()
    current = path
    for _ in range(6):
        if current in visited:
            return None
        visited.add(current)
        if _is_rawdata_file(current):
            return current
        sidecar = _artifact_meta_path(root, current)
        if not sidecar.exists():
            return _fallback_raw_source(current)
        try:
            payload = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return _fallback_raw_source(current)
        if not isinstance(payload, dict):
            return _fallback_raw_source(current)
        candidate: str | None = None
        source = payload.get("source")
        if isinstance(source, str):
            candidate = source
        elif isinstance(source, dict):
            for key in ("rawdata_csv", "raw_csv", "rawdata", "path"):
                value = source.get(key)
                if isinstance(value, str):
                    candidate = value
                    break
        # New schema: rawdata_id points to the rawdata folder name
        if not candidate:
            rawdata_id = payload.get("rawdata_id")
            if isinstance(rawdata_id, str) and rawdata_id:
                raw_dir = root / "rawdata" / rawdata_id
                if raw_dir.is_dir():
                    for ext in ("*.csv", "*.dat"):
                        candidates = sorted(raw_dir.glob(ext))
                        if candidates:
                            candidate = relative_text(candidates[0], root)
                            break
        if not candidate:
            return _fallback_raw_source(current)
        try:
            next_path = path_from_client(root, candidate)
        except ValueError:
            return _fallback_raw_source(current)
        current = next_path
    return None


def write_raw_meta(raw_path: Path, memo: str) -> dict[str, Any]:
    meta_path = raw_meta_path(raw_path)
    body = memo.strip("\n").rstrip() if isinstance(memo, str) else ""
    updated_at = dt.datetime.now().isoformat(timespec="seconds")
    payload: dict[str, Any] = {}
    if meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text(encoding="utf-8"))
            if isinstance(existing, dict):
                payload = existing
        except json.JSONDecodeError:
            payload = {}
    payload.update(
        {
            "display_name": str(payload.get("display_name") or payload.get("rawdata_name") or _rawdata_payload_stem(raw_path)),
            "payload_file": _rawdata_payload_file(raw_path),
        }
    )
    payload.pop("rawdata_id", None)
    payload.pop("rawdata_name", None)
    if not body:
        payload.pop("memo", None)
        payload.pop("updated_at", None)
        if not _is_flat_rawdata_file(REPO_ROOT, raw_path):
            if meta_path.exists():
                meta_path.unlink()
            return {"memo": "", "updated_at": None, "deleted": True}
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return {"memo": "", "updated_at": None, "deleted": True}
    payload["memo"] = body
    payload["updated_at"] = updated_at
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {"memo": body, "updated_at": updated_at, "deleted": False}
