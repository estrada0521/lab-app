from __future__ import annotations

import argparse
import datetime
import json
import logging
import subprocess
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

_log = logging.getLogger(__name__)

from . import core

from pipeline.datagen import core as data_core
from pipeline.datagen import gui as data_gui

from .analysis import (
    collect_source_data_ids_from_cells,
    generate_plot_py,
    validate_analysis_grid_cells,
)
from . import catalog
from .records import cascade_rename, delete_entity, update_record_display_name


STATIC_DIR = Path(__file__).with_name("static")
STATIC_TYPES = {
    "index.html": "text/html; charset=utf-8",
    "calculators.html": "text/html; charset=utf-8",
    "records.html": "text/html; charset=utf-8",
    "analysis.html": "text/html; charset=utf-8",
    "build.html": "text/html; charset=utf-8",
    "info/common.js": "application/javascript; charset=utf-8",
    "info/data.js": "application/javascript; charset=utf-8",
    "info/rawdata.js": "application/javascript; charset=utf-8",
    "theme.css": "text/css; charset=utf-8",
    "lab.css": "text/css; charset=utf-8",
    "viewer.js": "application/javascript; charset=utf-8",
    "datagen.css": "text/css; charset=utf-8",
    "calculators.js": "application/javascript; charset=utf-8",
    "page_menu.js": "application/javascript; charset=utf-8",
    "info_render.js": "application/javascript; charset=utf-8",
    "pane_resize.js": "application/javascript; charset=utf-8",
    "plot_animation.js": "application/javascript; charset=utf-8",
    "plot_export.js": "application/javascript; charset=utf-8",
    "records.js": "application/javascript; charset=utf-8",
    "raw_memo.js": "application/javascript; charset=utf-8",
    "markdown_render.js": "application/javascript; charset=utf-8",
    "analysis.js": "application/javascript; charset=utf-8",
    "analysis_startup.html": "text/html; charset=utf-8",
    "analysis_startup.js": "application/javascript; charset=utf-8",
    "build.js": "application/javascript; charset=utf-8",
    "add_record.js": "application/javascript; charset=utf-8",
    "drop_upload.js": "application/javascript; charset=utf-8",
    "datparser.js": "application/javascript; charset=utf-8",
}
STATIC_VERSION = str(
    max(path.stat().st_mtime_ns for path in STATIC_DIR.rglob("*") if path.is_file())
)
DB_ROOT = Path.cwd().resolve()


def _apply_conditions(header: list[str], rows: list[dict[str, str]], conditions: list[dict]) -> list[dict[str, str]]:
    """Filter rows by column min/max conditions."""
    filters: list[tuple[str, float | None, float | None]] = []
    for cond in conditions:
        col = str(cond.get("column", "")).strip()
        if col not in header:
            continue
        min_str = str(cond.get("min", "")).strip()
        max_str = str(cond.get("max", "")).strip()
        if not min_str and not max_str:
            continue
        try:
            min_val: float | None = float(min_str) if min_str else None
            max_val: float | None = float(max_str) if max_str else None
        except (ValueError, TypeError):
            continue
        filters.append((col, min_val, max_val))
    if not filters:
        return rows
    result = []
    for row in rows:
        keep = True
        for col, min_val, max_val in filters:
            raw = row.get(col, "")
            try:
                val = float(raw)
            except (ValueError, TypeError):
                continue
            if min_val is not None and val < min_val:
                keep = False
                break
            if max_val is not None and val > max_val:
                keep = False
                break
        if keep:
            result.append(row)
    return result


def _table_rows(table: core.TableData) -> list[dict[str, str]]:
    return [
        {header: (row[index] if index < len(row) else "") for index, header in enumerate(table.header)}
        for row in table.rows
    ]


def _data_result_payload(root: Path, result: object) -> dict[str, object]:
    output_paths = getattr(result, "output_paths", {}) or {}
    metadata_path = output_paths.get("json") if isinstance(output_paths, dict) else None
    metadata = data_core.read_metadata(metadata_path) if isinstance(metadata_path, Path) else {}
    csv_output = output_paths.get("csv") if isinstance(output_paths, dict) else None
    csv_rel = core.relative_text(csv_output, root) if isinstance(csv_output, Path) else ""
    payload: dict[str, object] = {
        "rows": getattr(result, "rows", 0),
        "x_column": getattr(result, "x_column", ""),
        "y_column": getattr(result, "y_column", ""),
        "x_label": getattr(result, "x_label", ""),
        "y_label": getattr(result, "y_label", ""),
        "summary": getattr(result, "summary", {}) or {},
    }
    for name in ("moment_column",):
        value = getattr(result, name, None)
        if value is not None:
            payload[name] = value
    if csv_rel:
        payload["csv_path"] = csv_rel
        payload["name"] = Path(csv_rel).stem
        payload["data_id"] = Path(csv_rel).stem
    if isinstance(metadata, dict):
        payload["display_name"] = str(metadata.get("display_name") or "").strip()
    return payload


def _next_available_id(directory: Path) -> str:
    if not directory.exists():
        return "000001"
    existing: list[int] = []
    for item in directory.iterdir():
        if item.is_dir():
            try:
                existing.append(int(item.name))
            except ValueError:
                pass
    return f"{max(existing, default=0) + 1:06d}"


_ALLOWED_RECORD_KINDS = {"rawdata", "sample", "exp"}

_ATTACHMENT_KIND_DIR: dict[str, str] = {
    "rawdata": "rawdata",
    "data": "data",
    "sample": "samples",
    "exp": "exp",
    "analysis": "analysis",
    "build": "build",
    "calc": "calculators",
}


def _attachment_dir(root: Path, kind: str, record_id: str) -> Path | None:
    dir_name = _ATTACHMENT_KIND_DIR.get(kind)
    if not dir_name or not record_id or ".." in record_id or "/" in record_id:
        return None
    return root / dir_name / record_id / "uploaded"
_ALLOWED_FILE_EXTS: dict[str, set[str]] = {
    "rawdata:payload": {".dat", ".csv", ".txt", ".tsv"},
    "sample:image": {".jpg", ".jpeg", ".png", ".webp", ".gif"},
    "exp:doc": {".md", ".txt"},
}


def _create_record(root: Path, kind: str, metadata: dict[str, object]) -> str:
    if kind == "rawdata":
        directory = root / "rawdata"
    elif kind == "sample":
        directory = root / "samples"
    elif kind == "exp":
        directory = root / "exp"
    else:
        raise ValueError(f"unknown kind: {kind}")
    new_id = _next_available_id(directory)
    record_dir = directory / new_id
    record_dir.mkdir(parents=True, exist_ok=False)
    meta_path = record_dir / "metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return new_id


def _save_record_file(root: Path, kind: str, record_id: str, filename: str, slot: str, file_bytes: bytes) -> dict[str, object]:
    _entity_id(record_id)
    safe_name = Path(filename).name
    if not safe_name or any(c in safe_name for c in ("/", "\\", "\0")):
        raise ValueError("invalid filename")
    ext = Path(safe_name).suffix.lower()
    slot_key = f"{kind}:{slot}"
    allowed_exts = _ALLOWED_FILE_EXTS.get(slot_key)
    if allowed_exts is not None and ext not in allowed_exts:
        raise ValueError(f"file extension {ext!r} not allowed for {slot_key}")

    if kind == "rawdata":
        record_dir = root / "rawdata" / record_id
        target_path = record_dir / safe_name
    elif kind == "sample":
        record_dir = root / "samples" / record_id
        if slot == "image":
            images_dir = record_dir / "images"
            images_dir.mkdir(exist_ok=True)
            target_path = images_dir / safe_name
        else:
            target_path = record_dir / safe_name
    elif kind == "exp":
        record_dir = root / "exp" / record_id
        if slot == "doc":
            docs_dir = record_dir / "docs"
            docs_dir.mkdir(exist_ok=True)
            target_path = docs_dir / safe_name
        else:
            target_path = record_dir / safe_name
    else:
        raise ValueError(f"unknown kind: {kind}")

    if not record_dir.exists():
        raise FileNotFoundError(f"record not found: {kind}/{record_id}")
    target_path.write_bytes(file_bytes)
    return {"ok": True, "path": core.relative_text(target_path, root)}


def _is_raw_source_path(root: Path, path: Path) -> bool:
    rel = core.relative_text(path, root)
    return rel.startswith("rawdata/") or path.parent.name == "rawdata"


def _record_subdir(kind: str) -> str:
    normalized = kind.strip().lower()
    if normalized == "sample":
        return "samples"
    if normalized in {"exp", "experiment"}:
        return "exp"
    raise ValueError(f"unknown record kind: {kind}")


def _record_dir(root: Path, kind: str, record_id: str) -> Path:
    normalized_id = record_id.strip()
    if not normalized_id or any(c in normalized_id for c in ("/", "\\", "\0")) or normalized_id in {".", ".."}:
        raise ValueError("invalid id")
    return root / _record_subdir(kind) / normalized_id


def _entity_id(value: str) -> str:
    normalized = value.strip()
    if not normalized or any(c in normalized for c in ("/", "\\", "\0")) or normalized in {".", ".."}:
        raise ValueError("invalid id")
    return normalized


def _read_json_dict(path: Path) -> dict[str, object]:
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    if not isinstance(payload, dict):
        raise ValueError(f"metadata must be a JSON object: {path}")
    return payload


def _memo_payload_from_meta(meta_path: Path, *, updated_key: str) -> dict[str, object]:
    if not meta_path.exists():
        return {"memo": "", "updated_at": None}
    meta = _read_json_dict(meta_path)
    return {"memo": str(meta.get("memo", "") or ""), "updated_at": meta.get(updated_key) or None}


def _write_memo_meta(meta_path: Path, memo: str, *, updated_key: str) -> dict[str, object]:
    meta = _read_json_dict(meta_path) if meta_path.exists() else {}
    body = str(memo).strip("\n").rstrip()
    updated_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    if body:
        meta["memo"] = body
        meta[updated_key] = updated_at
    else:
        meta.pop("memo", None)
        meta.pop(updated_key, None)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    return {"memo": body, "updated_at": updated_at if body else None}


def _memo_request_from_query(query: dict[str, list[str]]) -> tuple[str, str, str]:
    return (
        query.get("kind", [""])[0],
        query.get("id", [""])[0],
        query.get("path", [""])[0],
    )


def _memo_request_from_payload(payload: dict[str, object]) -> tuple[str, str, str, str]:
    return (
        str(payload.get("kind", "")),
        str(payload.get("id", "")),
        str(payload.get("path", "")),
        str(payload.get("memo", "")),
    )


def _memo_get(root: Path, *, kind: str, record_id: str = "", path_text: str = "") -> dict[str, object]:
    normalized_kind = kind.strip().lower()
    if normalized_kind == "rawdata":
        path = core.path_from_client(root, path_text)
        payload = core.read_raw_meta(path)
        payload["raw_path"] = core.relative_text(path, root)
        return payload
    if normalized_kind in {"rawdata-for", "upstream"}:
        path = core.path_from_client(root, path_text)
        raw_path = core.resolve_raw_source(root, path)
        if raw_path is None:
            return {"memo": "", "updated_at": None, "raw_path": None, "resolved": False}
        payload = core.read_raw_meta(raw_path)
        payload["raw_path"] = core.relative_text(raw_path, root)
        payload["resolved"] = True
        return payload
    if normalized_kind == "data":
        path = core.path_from_client(root, path_text)
        return _memo_payload_from_meta(path.parent / "metadata.json", updated_key="memo_updated_at")
    if normalized_kind in {"sample", "exp", "experiment"}:
        return _memo_payload_from_meta(_record_dir(root, normalized_kind, record_id) / "metadata.json", updated_key="memo_updated_at")
    if normalized_kind == "analysis":
        entity_id = _entity_id(record_id)
        return _memo_payload_from_meta(root / "analysis" / entity_id / "metadata.json", updated_key="memo_updated_at")
    if normalized_kind == "build":
        entity_id = _entity_id(record_id)
        return _memo_payload_from_meta(root / "build" / entity_id / "metadata.json", updated_key="memo_updated_at")
    raise ValueError(f"unknown memo kind: {kind}")


def _memo_post(root: Path, *, kind: str, record_id: str = "", path_text: str = "", memo: str = "") -> dict[str, object]:
    normalized_kind = kind.strip().lower()
    if normalized_kind == "rawdata":
        path = core.path_from_client(root, path_text)
        result = core.write_raw_meta(path, memo)
        result["raw_path"] = core.relative_text(path, root)
        return result
    if normalized_kind in {"rawdata-for", "upstream"}:
        path = core.path_from_client(root, path_text)
        raw_path = core.resolve_raw_source(root, path)
        if raw_path is None:
            raise ValueError("rawdata source could not be resolved")
        result = core.write_raw_meta(raw_path, memo)
        result["raw_path"] = core.relative_text(raw_path, root)
        result["resolved"] = True
        return result
    if normalized_kind == "data":
        path = core.path_from_client(root, path_text)
        meta_path = path.parent / "metadata.json"
        if not meta_path.exists():
            raise FileNotFoundError("data metadata not found")
        return _write_memo_meta(meta_path, memo, updated_key="memo_updated_at")
    if normalized_kind in {"sample", "exp", "experiment"}:
        record_dir = _record_dir(root, normalized_kind, record_id)
        if not record_dir.exists():
            raise FileNotFoundError("record not found")
        return _write_memo_meta(record_dir / "metadata.json", memo, updated_key="memo_updated_at")
    if normalized_kind == "analysis":
        entity_id = _entity_id(record_id)
        meta_path = root / "analysis" / entity_id / "metadata.json"
        if not meta_path.exists():
            raise FileNotFoundError("analysis project not found")
        return _write_memo_meta(meta_path, memo, updated_key="memo_updated_at")
    if normalized_kind == "build":
        entity_id = _entity_id(record_id)
        meta_path = root / "build" / entity_id / "metadata.json"
        if not meta_path.exists():
            raise FileNotFoundError("build not found")
        return _write_memo_meta(meta_path, memo, updated_key="memo_updated_at")
    raise ValueError(f"unknown memo kind: {kind}")


class DatParserHTTPServer(ThreadingHTTPServer):
    db_root: Path


class DatParserHandler(BaseHTTPRequestHandler):
    server: DatParserHTTPServer

    def log_message(self, format: str, *args: object) -> None:
        return

    def send_no_cache_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")

    def send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_no_cache_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_no_cache_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_html(self) -> None:
        self.send_html_template("index.html")

    def send_calculators_html(self) -> None:
        self.send_html_template("calculators.html")

    def send_records_html(self, record_kind: str, title: str) -> None:
        self.send_html_template(
            "records.html",
            replacements={
                "__PAGE_TITLE__": title,
                "__RECORD_KIND__": record_kind,
            },
        )

    def send_html_template(self, name: str, replacements: dict[str, str] | None = None) -> None:
        body_text = (STATIC_DIR / name).read_text(encoding="utf-8").replace("__STATIC_VERSION__", STATIC_VERSION)
        for key, value in (replacements or {}).items():
            body_text = body_text.replace(key, value)
        body = body_text.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", STATIC_TYPES[name])
        self.send_header("Content-Length", str(len(body)))
        self.send_no_cache_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_static(self, request_path: str) -> None:
        name = request_path.removeprefix("/static/")
        parts = Path(name).parts
        if not name or any(part in {"", ".", ".."} for part in parts) or name not in STATIC_TYPES:
            self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        self.send_file(STATIC_DIR / name, STATIC_TYPES[name])

    def send_repo_file(self, path: Path) -> None:
        content_types = {
            ".svg": "image/svg+xml; charset=utf-8",
            ".csv": "text/csv; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".log": "text/plain; charset=utf-8",
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }
        content_type = content_types.get(path.suffix.lower())
        if not content_type:
            self.send_json({"error": f"unsupported file type: {path.suffix}"}, HTTPStatus.BAD_REQUEST)
            return
        self.send_file(path, content_type)

    def do_GET(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                self.send_html()
            elif parsed.path in {"/calculators", "/calculators/"}:
                self.send_calculators_html()
            elif parsed.path in {"/samples", "/samples/"}:
                self.send_records_html("samples", "Samples")
            elif parsed.path in {"/experiments", "/experiments/"}:
                self.send_records_html("experiments", "Experiments")
            elif parsed.path in {"/analysis", "/analysis/"}:
                self.send_html_template("analysis.html")
            elif parsed.path in {"/build", "/build/"}:
                self.send_html_template("build.html")
            elif parsed.path in {"/analysis-startup", "/analysis-startup/"}:
                self.send_html_template("analysis_startup.html")
            elif parsed.path.startswith("/static/"):
                self.send_static(parsed.path)
            elif parsed.path == "/api/raw-files":
                raw_paths = core.discover_raw_files(self.server.db_root)
                sample_entries = catalog.sample_entries(self.server.db_root)
                exp_entries = catalog.experiment_entries(self.server.db_root)
                samples_idx = {e["id"]: e.get("display_name", e["id"]) for e in sample_entries}
                sample_material_idx = {e["id"]: e.get("material", "") for e in sample_entries}
                exps_idx = {e["id"]: e.get("display_name", e["id"]) for e in exp_entries}
                exps_start_idx = {e["id"]: e.get("start_date", "") for e in exp_entries}
                self.send_json(
                    {
                        "files": [core.relative_text(path, self.server.db_root) for path in raw_paths],
                        "entries": [catalog.raw_entry(self.server.db_root, path) for path in raw_paths],
                        "samples_index": samples_idx,
                        "sample_material_index": sample_material_idx,
                        "exps_index": exps_idx,
                        "exps_start_index": exps_start_idx,
                    }
                )
            elif parsed.path == "/api/data-files":
                data_paths = data_core.discover_data_files(self.server.db_root)
                sample_entries = catalog.sample_entries(self.server.db_root)
                exp_entries = catalog.experiment_entries(self.server.db_root)
                samples_idx = {e["id"]: e.get("display_name", e["id"]) for e in sample_entries}
                sample_material_idx = {e["id"]: e.get("material", "") for e in sample_entries}
                exps_idx = {e["id"]: e.get("display_name", e["id"]) for e in exp_entries}
                exps_start_idx = {e["id"]: e.get("start_date", "") for e in exp_entries}
                self.send_json(
                    {
                        "files": [core.relative_text(path, self.server.db_root) for path in data_paths],
                        "entries": [catalog.data_entry(self.server.db_root, path) for path in data_paths],
                        "samples_index": samples_idx,
                        "sample_material_index": sample_material_idx,
                        "exps_index": exps_idx,
                        "exps_start_index": exps_start_idx,
                    }
                )
            elif parsed.path == "/api/samples":
                self.send_json({"entries": catalog.sample_entries(self.server.db_root)})
            elif parsed.path == "/api/sample":
                query = parse_qs(parsed.query)
                sample_id = query.get("id", [""])[0]
                self.send_json(catalog.sample_detail(self.server.db_root, sample_id))
            elif parsed.path == "/api/experiments":
                self.send_json({"entries": catalog.experiment_entries(self.server.db_root)})
            elif parsed.path == "/api/experiment":
                query = parse_qs(parsed.query)
                exp_id = query.get("id", [""])[0]
                self.send_json(catalog.experiment_detail(self.server.db_root, exp_id))
            elif parsed.path == "/api/analyses":
                self.send_json({"entries": catalog.analysis_entries(self.server.db_root)})
            elif parsed.path == "/api/analysis":
                query = parse_qs(parsed.query)
                project_id = query.get("id", [""])[0]
                self.send_json(catalog.analysis_detail(self.server.db_root, project_id))
            elif parsed.path == "/api/builds":
                self.send_json({"entries": catalog.build_entries(self.server.db_root)})
            elif parsed.path == "/api/build":
                query = parse_qs(parsed.query)
                build_id = query.get("id", [""])[0]
                self.send_json(catalog.build_detail(self.server.db_root, build_id))
            elif parsed.path == "/api/meta-ref":
                query = parse_qs(parsed.query)
                ref_kind = query.get("kind", [""])[0]
                ref_id = query.get("id", [""])[0]
                if not ref_id:
                    self.send_json({"error": "id required"}, HTTPStatus.BAD_REQUEST)
                    return
                if ref_kind == "material":
                    meta_path = self.server.db_root / "DB" / "materials" / f"{ref_id}.json"
                elif ref_kind == "sample":
                    meta_path = self.server.db_root / "samples" / ref_id / "metadata.json"
                elif ref_kind == "experiment":
                    meta_path = self.server.db_root / "exp" / ref_id / "metadata.json"
                elif ref_kind == "rawdata":
                    meta_path = self.server.db_root / "rawdata" / ref_id / "metadata.json"
                else:
                    self.send_json({"error": f"unknown kind: {ref_kind}"}, HTTPStatus.BAD_REQUEST)
                    return
                if not meta_path.exists():
                    self.send_json({"error": f"not found: {ref_kind}/{ref_id}"}, HTTPStatus.NOT_FOUND)
                    return
                with open(meta_path, encoding="utf-8") as f:
                    self.send_json(json.load(f))
            elif parsed.path == "/api/config":
                self.send_json({"db_root": str(self.server.db_root)})
            elif parsed.path == "/api/attachments":
                query = parse_qs(parsed.query)
                kind = query.get("kind", [""])[0].strip().lower()
                record_id = query.get("id", [""])[0].strip()
                adir = _attachment_dir(self.server.db_root, kind, record_id)
                files: list[dict[str, object]] = []
                if adir and adir.exists():
                    for f in sorted(adir.iterdir()):
                        if f.is_file():
                            rel = str(f.relative_to(self.server.db_root))
                            files.append({"name": f.name, "path": rel, "size": f.stat().st_size})
                self.send_json({"files": files})
            elif parsed.path == "/api/calculators":
                self.send_json({"calculators": data_gui.list_calculators(self.server.db_root, include_readme=True)})
            elif parsed.path == "/api/table":
                query = parse_qs(parsed.query)
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                summary = core.table_summary(core.parse_table(path))
                # Override suggested axes with defaults from rawdata metadata if present
                meta_path = path.parent / "metadata.json"
                if meta_path.exists():
                    try:
                        import json as _json
                        meta = _json.loads(meta_path.read_text(encoding="utf-8"))
                        if meta.get("default_x"):
                            summary["suggested_x"] = meta["default_x"]
                        if meta.get("default_y"):
                            summary["suggested_y"] = meta["default_y"]
                    except (OSError, json.JSONDecodeError):
                        pass
                self.send_json(summary)
            elif parsed.path == "/api/data-summary":
                query = parse_qs(parsed.query)
                calculator = query.get("calculator", [""])[0] or None
                display_name = query.get("display_name", [""])[0] or None
                calculator_options_raw = query.get("calculator_options", ["{}"])[0] or "{}"
                calculator_options = json.loads(calculator_options_raw) if calculator_options_raw else {}
                if not isinstance(calculator_options, dict):
                    calculator_options = {}
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                if not _is_raw_source_path(self.server.db_root, path):
                    raise ValueError("data summary expects a rawdata source")
                table = core.parse_table(path)
                self.send_json(
                    data_gui.summarize_raw_source(
                        self.server.db_root,
                        path,
                        table.header,
                        _table_rows(table),
                        display_name=display_name,
                        calculator_id=calculator,
                        calculator_options=calculator_options,
                    )
                )
            elif parsed.path == "/api/plot":
                query = parse_qs(parsed.query)
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                x_column = query.get("x", [""])[0]
                y_column = query.get("y", [""])[0]
                table = core.parse_table(path)
                conditions_text = query.get("conditions", [""])[0]
                if conditions_text:
                    conditions = [c for c in json.loads(conditions_text) if isinstance(c, dict)]
                    filtered = _apply_conditions(table.header, _table_rows(table), conditions)
                    rows = [[row.get(header, "") for header in table.header] for row in filtered]
                    table = core.TableData(source_path=table.source_path, header=table.header, rows=rows, data_start_line=table.data_start_line)
                self.send_json(core.plot_points(table, x_column, y_column))
            elif parsed.path == "/api/repo-file":
                query = parse_qs(parsed.query)
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                self.send_repo_file(path)
            elif parsed.path == "/api/data-meta":
                query = parse_qs(parsed.query)
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                meta_path = path.parent / "metadata.json"
                if not meta_path.exists():
                    self.send_json({"error": "metadata not found"}, HTTPStatus.NOT_FOUND)
                    return
                with open(meta_path, encoding="utf-8") as f:
                    self.send_json(json.load(f))
            elif parsed.path == "/api/memo":
                query = parse_qs(parsed.query)
                kind, record_id, path_text = _memo_request_from_query(query)
                self.send_json(_memo_get(self.server.db_root, kind=kind, record_id=record_id, path_text=path_text))
            elif parsed.path == "/api/next-id":
                query = parse_qs(parsed.query)
                kind = query.get("kind", [""])[0].strip().lower()
                if kind not in _ALLOWED_RECORD_KINDS:
                    self.send_json({"error": f"unknown kind: {kind}"}, HTTPStatus.BAD_REQUEST)
                    return
                dir_map = {
                    "rawdata": self.server.db_root / "rawdata",
                    "sample": self.server.db_root / "samples",
                    "exp": self.server.db_root / "exp",
                }
                self.send_json({"id": _next_available_id(dir_map[kind]), "kind": kind})
            elif parsed.path == "/api/experiment-doc":
                query = parse_qs(parsed.query)
                exp_id = query.get("id", [""])[0]
                doc_path = self.server.db_root / "exp" / exp_id / "docs" / "main.md"
                if doc_path.exists():
                    content = doc_path.read_text(encoding="utf-8")
                    self.send_json({"content": content, "path": f"exp/{exp_id}/docs/main.md"})
                else:
                    self.send_json({"content": "", "path": None})
            else:
                self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except FileNotFoundError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_POST(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/shutdown":
                self.send_json({"stopping": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if parsed.path == "/api/upload-attachment":
                query = parse_qs(parsed.query)
                kind = query.get("kind", [""])[0].strip().lower()
                record_id = query.get("id", [""])[0].strip()
                filename = query.get("filename", [""])[0].strip()
                if not filename or ".." in filename or "/" in filename:
                    self.send_json({"error": "invalid filename"}, HTTPStatus.BAD_REQUEST)
                    return
                adir = _attachment_dir(self.server.db_root, kind, record_id)
                if adir is None:
                    self.send_json({"error": "invalid kind or id"}, HTTPStatus.BAD_REQUEST)
                    return
                length = int(self.headers.get("Content-Length", "0"))
                file_bytes = self.rfile.read(length) if length else b""
                adir.mkdir(parents=True, exist_ok=True)
                (adir / filename).write_bytes(file_bytes)
                rel = str((adir / filename).relative_to(self.server.db_root))
                self.send_json({"ok": True, "path": rel})
                return
            if parsed.path == "/api/upload-record-file":
                query = parse_qs(parsed.query)
                kind = query.get("kind", [""])[0].strip().lower()
                record_id = query.get("id", [""])[0].strip()
                filename = query.get("filename", [""])[0].strip()
                slot = query.get("slot", ["payload"])[0].strip()
                length = int(self.headers.get("Content-Length", "0"))
                file_bytes = self.rfile.read(length) if length else b""
                result = _save_record_file(self.server.db_root, kind, record_id, filename, slot, file_bytes)
                self.send_json(result)
                return
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8") if length else ""
            payload = json.loads(body) if body else {}
            if parsed.path == "/api/data-create":
                source_path = core.path_from_client(self.server.db_root, str(payload.get("path", "")))
                if not _is_raw_source_path(self.server.db_root, source_path):
                    raise ValueError("data creation expects a rawdata source")
                table = core.parse_table(source_path)
                conditions = [c for c in payload.get("conditions", []) if isinstance(c, dict)]
                rows = _apply_conditions(table.header, _table_rows(table), conditions)
                calculator_options = payload.get("calculator_options") if isinstance(payload.get("calculator_options"), dict) else {}
                result = data_gui.create_data(
                    self.server.db_root,
                    source_path,
                    display_name=str(payload.get("display_name") or payload.get("name") or "").strip() or None,
                    overwrite=bool(payload.get("overwrite")),
                    calculator_id=str(payload.get("calculator") or "").strip() or None,
                    calculator_options=calculator_options,
                    retained_source_columns=[str(name) for name in payload.get("retained_source_columns", []) if str(name).strip()],
                    source_header=table.header,
                    source_rows=rows,
                )
                response = _data_result_payload(self.server.db_root, result)
                response["direct_rawdata"] = {"source": core.relative_text(source_path, self.server.db_root)}
                self.send_json(response)
            elif parsed.path == "/api/create-record":
                kind = str(payload.get("kind", "")).strip().lower()
                if kind not in _ALLOWED_RECORD_KINDS:
                    self.send_json({"error": f"unknown kind: {kind}"}, HTTPStatus.BAD_REQUEST)
                    return
                metadata = payload.get("metadata", {})
                if not isinstance(metadata, dict):
                    raise ValueError("metadata must be an object")
                new_id = _create_record(self.server.db_root, kind, metadata)
                self.send_json({"id": new_id, "kind": kind})
            elif parsed.path == "/api/memo":
                kind, record_id, path_text, memo = _memo_request_from_payload(payload)
                self.send_json(_memo_post(self.server.db_root, kind=kind, record_id=record_id, path_text=path_text, memo=memo))
            elif parsed.path == "/api/rename":
                kind = str(payload.get("kind", ""))
                old_id = str(payload.get("old_id", ""))
                new_id = str(payload.get("new_id", "")).strip()
                new_name = str(payload.get("new_name", "")).strip()
                if kind in {"rawdata", "data", "sample", "exp", "analysis", "build", "calc"} and old_id and new_name:
                    result = update_record_display_name(self.server.db_root, kind, old_id, new_name)
                    status = HTTPStatus.OK if not result.get("error") else HTTPStatus.BAD_REQUEST
                    self.send_json(result, status)
                    return
                if not kind or not old_id or not new_id:
                    self.send_json({"error": "kind, old_id and new_id required"}, HTTPStatus.BAD_REQUEST)
                    return
                if old_id == new_id:
                    self.send_json({"ok": True, "new_id": new_id, "updated_refs": 0})
                    return
                if any(c in new_id for c in ("/", "\\", "\0")) or new_id in (".", ".."):
                    self.send_json({"error": "invalid new_id"}, HTTPStatus.BAD_REQUEST)
                    return
                result = cascade_rename(self.server.db_root, kind, old_id, new_id)
                self.send_json(result)
            elif parsed.path == "/api/delete-data":
                data_id = str(payload.get("id", "")).strip()
                if not data_id or any(c in data_id for c in ("/", "\\", "\0")) or data_id in (".", ".."):
                    self.send_json({"error": "invalid id"}, HTTPStatus.BAD_REQUEST)
                    return
                result = delete_entity(self.server.db_root, "data", data_id)
                status = HTTPStatus.OK if not result.get("error") else HTTPStatus.BAD_REQUEST
                self.send_json(result, status)
            elif parsed.path == "/api/delete-entity":
                kind = str(payload.get("kind", "")).strip()
                entity_id = str(payload.get("id", "")).strip()
                if not kind or not entity_id:
                    self.send_json({"error": "kind and id required"}, HTTPStatus.BAD_REQUEST)
                    return
                result = delete_entity(self.server.db_root, kind, entity_id)
                status = HTTPStatus.OK if not result.get("error") else HTTPStatus.BAD_REQUEST
                self.send_json(result, status)
            elif parsed.path == "/api/analysis-start":
                display_name = str(payload.get("display_name", "")).strip()
                grid_data = payload.get("grid", {})
                if not isinstance(grid_data, dict):
                    self.send_json({"error": "grid required"}, HTTPStatus.BAD_REQUEST)
                    return
                rows = int(grid_data.get("rows", 2))
                cols = int(grid_data.get("cols", 2))
                cells = [c for c in grid_data.get("cells", []) if isinstance(c, dict)]
                grid_err = validate_analysis_grid_cells(self.server.db_root, cells)
                if grid_err:
                    self.send_json({"error": grid_err}, HTTPStatus.BAD_REQUEST)
                    return
                analysis_dir = self.server.db_root / "analysis"
                analysis_dir.mkdir(exist_ok=True)
                new_id = _next_available_id(analysis_dir)
                record_dir = analysis_dir / new_id
                record_dir.mkdir(parents=True, exist_ok=False)
                source_data = collect_source_data_ids_from_cells(cells)
                meta = {
                    "display_name": display_name or new_id,
                    "created_at": datetime.datetime.now().isoformat(timespec="milliseconds"),
                    "source_data": source_data,
                }
                (record_dir / "metadata.json").write_text(
                    json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
                plot_path = record_dir / "plot.py"
                plot_path.write_text(generate_plot_py(self.server.db_root, rows, cols, cells), encoding="utf-8")
                subprocess.Popen([sys.executable, str(plot_path)], cwd=str(record_dir))
                try:
                    subprocess.Popen(["open", "-a", "Antigravity", str(plot_path)])
                except Exception:
                    pass
                self.send_json({"id": new_id, "path": f"analysis/{new_id}"})
            elif parsed.path == "/api/open-external":
                # Open a file in Antigravity (or another app via "app" param)
                rel_path = str(payload.get("path", "")).strip()
                if not rel_path:
                    self.send_json({"error": "path required"}, HTTPStatus.BAD_REQUEST)
                    return
                abs_path = core.path_from_client(self.server.db_root, rel_path)
                app = str(payload.get("app", "Antigravity")).strip() or "Antigravity"
                if app == "Finder":
                    subprocess.Popen(["open", "-R", str(abs_path)])
                else:
                    subprocess.Popen(["open", "-a", app, str(abs_path)])
                self.send_json({"ok": True, "path": rel_path, "app": app})
            else:
                self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except FileNotFoundError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Start the DatParser local GUI.")
    parser.add_argument("--db-root", "--root", dest="db_root", default=".", help="database root containing rawdata/, samples/, exp/, data/, analysis/, DB/, calculators/")
    parser.add_argument("--host", default=core.DEFAULT_HOST, help="host to bind")
    parser.add_argument("--port", type=int, default=core.DEFAULT_PORT, help="port to bind; use 0 for any free port")
    parser.add_argument("--no-open", action="store_true", help="do not open the browser automatically")
    return parser


def main() -> None:
    global DB_ROOT
    args = build_parser().parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    DB_ROOT = Path(args.db_root).resolve()
    core.REPO_ROOT = DB_ROOT
    server = DatParserHTTPServer((args.host, args.port), DatParserHandler)
    server.db_root = DB_ROOT
    host, port = server.server_address
    url = f"http://{host}:{port}/"
    print(f"DatParser: {url}")
    print("Press Ctrl-C to stop.")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
