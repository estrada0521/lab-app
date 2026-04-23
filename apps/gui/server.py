from __future__ import annotations

import argparse
import datetime
import json
import logging
import shutil
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

from . import catalog


STATIC_DIR = Path(__file__).with_name("static")
STATIC_TYPES = {
    "index.html": "text/html; charset=utf-8",
    "calculators.html": "text/html; charset=utf-8",
    "records.html": "text/html; charset=utf-8",
    "analysis.html": "text/html; charset=utf-8",
    "datparser.css": "text/css; charset=utf-8",
    "datparser.js": "application/javascript; charset=utf-8",
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
}
STATIC_VERSION = str(
    max(path.stat().st_mtime_ns for path in STATIC_DIR.iterdir() if path.is_file())
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


def _is_raw_source_path(root: Path, path: Path) -> bool:
    rel = core.relative_text(path, root)
    return rel.startswith("rawdata/") or path.parent.name == "rawdata"


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
        if "/" in name or name not in STATIC_TYPES:
            self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        self.send_file(STATIC_DIR / name, STATIC_TYPES[name])

    def send_repo_file(self, path: Path) -> None:
        content_types = {
            ".svg": "image/svg+xml; charset=utf-8",
            ".csv": "text/csv; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".log": "text/plain; charset=utf-8",
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
            elif parsed.path.startswith("/static/"):
                self.send_static(parsed.path)
            elif parsed.path == "/api/raw-files":
                raw_paths = core.discover_raw_files(self.server.db_root)
                samples_idx = {e["id"]: e.get("display_name", e["id"]) for e in catalog.sample_entries(self.server.db_root)}
                sessions_idx = {e["id"]: e.get("display_name", e["id"]) for e in catalog.experiment_entries(self.server.db_root)}
                self.send_json(
                    {
                        "files": [core.relative_text(path, self.server.db_root) for path in raw_paths],
                        "entries": [catalog.raw_entry(self.server.db_root, path) for path in raw_paths],
                        "samples_index": samples_idx,
                        "sessions_index": sessions_idx,
                    }
                )
            elif parsed.path == "/api/data-files":
                data_paths = data_core.discover_data_files(self.server.db_root)
                samples_idx = {e["id"]: e.get("display_name", e["id"]) for e in catalog.sample_entries(self.server.db_root)}
                sessions_idx = {e["id"]: e.get("display_name", e["id"]) for e in catalog.experiment_entries(self.server.db_root)}
                self.send_json(
                    {
                        "files": [core.relative_text(path, self.server.db_root) for path in data_paths],
                        "entries": [catalog.data_entry(self.server.db_root, path) for path in data_paths],
                        "samples_index": samples_idx,
                        "sessions_index": sessions_idx,
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
                session_id = query.get("id", [""])[0]
                self.send_json(catalog.experiment_detail(self.server.db_root, session_id))
            elif parsed.path == "/api/analyses":
                self.send_json({"entries": catalog.analysis_entries(self.server.db_root)})
            elif parsed.path == "/api/analysis":
                query = parse_qs(parsed.query)
                project_id = query.get("id", [""])[0]
                self.send_json(catalog.analysis_detail(self.server.db_root, project_id))
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
            elif parsed.path == "/api/raw-meta":
                query = parse_qs(parsed.query)
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                payload = core.read_raw_meta(path)
                payload["raw_path"] = core.relative_text(path, self.server.db_root)
                self.send_json(payload)
            elif parsed.path == "/api/raw-meta-for":
                query = parse_qs(parsed.query)
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                raw_path = core.resolve_raw_source(self.server.db_root, path)
                if raw_path is None:
                    self.send_json({"memo": "", "updated_at": None, "raw_path": None, "resolved": False})
                else:
                    payload = core.read_raw_meta(raw_path)
                    payload["raw_path"] = core.relative_text(raw_path, self.server.db_root)
                    payload["resolved"] = True
                    self.send_json(payload)
            elif parsed.path == "/api/data-meta":
                query = parse_qs(parsed.query)
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                meta_path = path.parent / "metadata.json"
                if not meta_path.exists():
                    self.send_json({"error": "metadata not found"}, HTTPStatus.NOT_FOUND)
                    return
                with open(meta_path, encoding="utf-8") as f:
                    self.send_json(json.load(f))
            elif parsed.path == "/api/data-memo":
                query = parse_qs(parsed.query)
                path = core.path_from_client(self.server.db_root, query.get("path", [""])[0])
                meta_path = path.parent / "metadata.json"
                if meta_path.exists():
                    with open(meta_path, encoding="utf-8") as f:
                        meta = json.load(f)
                    self.send_json({"memo": meta.get("memo", "") or "", "updated_at": meta.get("memo_updated_at") or None})
                else:
                    self.send_json({"memo": "", "updated_at": None})
            elif parsed.path == "/api/record-memo":
                query = parse_qs(parsed.query)
                kind = query.get("kind", [""])[0]
                record_id = query.get("id", [""])[0]
                record_dir = self.server.db_root / ("samples" if kind == "sample" else "exp") / record_id
                meta_path = record_dir / "metadata.json"
                if meta_path.exists():
                    with open(meta_path, encoding="utf-8") as f:
                        meta = json.load(f)
                    self.send_json({"memo": meta.get("memo", "") or "", "updated_at": meta.get("memo_updated_at") or None})
                else:
                    self.send_json({"memo": "", "updated_at": None})
            elif parsed.path == "/api/experiment-doc":
                query = parse_qs(parsed.query)
                session_id = query.get("id", [""])[0]
                doc_path = self.server.db_root / "exp" / session_id / "docs" / "main.md"
                if doc_path.exists():
                    content = doc_path.read_text(encoding="utf-8")
                    self.send_json({"content": content, "path": f"exp/{session_id}/docs/main.md"})
                else:
                    self.send_json({"content": "", "path": None})
            else:
                self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_POST(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/shutdown":
                self.send_json({"stopping": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
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
            elif parsed.path == "/api/raw-meta":
                path = core.path_from_client(self.server.db_root, str(payload.get("path", "")))
                memo = str(payload.get("memo", ""))
                result = core.write_raw_meta(path, memo)
                result["raw_path"] = core.relative_text(path, self.server.db_root)
                self.send_json(result)
            elif parsed.path == "/api/raw-meta-for":
                path = core.path_from_client(self.server.db_root, str(payload.get("path", "")))
                raw_path = core.resolve_raw_source(self.server.db_root, path)
                if raw_path is None:
                    self.send_json({"error": "rawdata source could not be resolved"}, HTTPStatus.BAD_REQUEST)
                    return
                memo = str(payload.get("memo", ""))
                result = core.write_raw_meta(raw_path, memo)
                result["raw_path"] = core.relative_text(raw_path, self.server.db_root)
                result["resolved"] = True
                self.send_json(result)
            elif parsed.path == "/api/record-memo":
                kind = str(payload.get("kind", ""))
                record_id = str(payload.get("id", ""))
                memo = str(payload.get("memo", "")).strip("\n").rstrip()
                record_dir = self.server.db_root / ("samples" if kind == "sample" else "exp") / record_id
                meta_path = record_dir / "metadata.json"
                if meta_path.exists():
                    with open(meta_path, encoding="utf-8") as f:
                        meta = json.load(f)
                else:
                    meta = {}
                if memo:
                    meta["memo"] = memo
                else:
                    meta.pop("memo", None)
                    meta.pop("memo_updated_at", None)
                updated_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
                if memo:
                    meta["memo_updated_at"] = updated_at
                record_dir.mkdir(parents=True, exist_ok=True)
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2, ensure_ascii=False)
                    f.write("\n")
                self.send_json({"memo": memo, "updated_at": updated_at if memo else None})
            elif parsed.path == "/api/data-memo":
                path = core.path_from_client(self.server.db_root, str(payload.get("path", "")))
                memo = str(payload.get("memo", "")).strip("\n").rstrip()
                meta_path = path.parent / "metadata.json"
                if not meta_path.exists():
                    self.send_json({"error": "data metadata not found"}, HTTPStatus.NOT_FOUND)
                    return
                with open(meta_path, encoding="utf-8") as f:
                    meta = json.load(f)
                updated_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
                if memo:
                    meta["memo"] = memo
                    meta["memo_updated_at"] = updated_at
                else:
                    meta.pop("memo", None)
                    meta.pop("memo_updated_at", None)
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, ensure_ascii=False, indent=2, sort_keys=True)
                    f.write("\n")
                self.send_json({"memo": memo, "updated_at": updated_at if memo else None})
            elif parsed.path == "/api/analysis-memo":
                project_id = str(payload.get("id", ""))
                memo = str(payload.get("memo", "")).strip("\n").rstrip()
                meta_path = self.server.db_root / "analysis" / project_id / "metadata.json"
                if not meta_path.exists():
                    self.send_json({"error": "analysis project not found"}, HTTPStatus.NOT_FOUND)
                    return
                with open(meta_path, encoding="utf-8") as f:
                    meta = json.load(f)
                updated_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
                if memo:
                    meta["memo"] = memo
                    meta["memo_updated_at"] = updated_at
                else:
                    meta.pop("memo", None)
                    meta.pop("memo_updated_at", None)
                with open(meta_path, "w", encoding="utf-8") as f:
                    json.dump(meta, f, ensure_ascii=False, indent=2)
                    f.write("\n")
                self.send_json({"memo": memo, "updated_at": updated_at if memo else None})
            elif parsed.path == "/api/rename":
                kind = str(payload.get("kind", ""))
                old_id = str(payload.get("old_id", ""))
                new_id = str(payload.get("new_id", "")).strip()
                new_name = str(payload.get("new_name", "")).strip()
                if kind in {"rawdata", "data", "sample", "exp", "analysis", "calc"} and old_id and new_name:
                    result = _update_record_display_name(self.server.db_root, kind, old_id, new_name)
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
                result = _cascade_rename(self.server.db_root, kind, old_id, new_id)
                self.send_json(result)
            elif parsed.path == "/api/delete-data":
                data_id = str(payload.get("id", "")).strip()
                if not data_id or any(c in data_id for c in ("/", "\\", "\0")) or data_id in (".", ".."):
                    self.send_json({"error": "invalid id"}, HTTPStatus.BAD_REQUEST)
                    return
                result = _delete_entity(self.server.db_root, "data", data_id)
                status = HTTPStatus.OK if not result.get("error") else HTTPStatus.BAD_REQUEST
                self.send_json(result, status)
            elif parsed.path == "/api/delete-entity":
                kind = str(payload.get("kind", "")).strip()
                entity_id = str(payload.get("id", "")).strip()
                if not kind or not entity_id:
                    self.send_json({"error": "kind and id required"}, HTTPStatus.BAD_REQUEST)
                    return
                result = _delete_entity(self.server.db_root, kind, entity_id)
                status = HTTPStatus.OK if not result.get("error") else HTTPStatus.BAD_REQUEST
                self.send_json(result, status)
            elif parsed.path == "/api/open-external":
                # Open a file in Antigravity (or another app via "app" param)
                rel_path = str(payload.get("path", "")).strip()
                if not rel_path:
                    self.send_json({"error": "path required"}, HTTPStatus.BAD_REQUEST)
                    return
                abs_path = (self.server.db_root / rel_path).resolve()
                if not abs_path.exists():
                    self.send_json({"error": "file not found"}, HTTPStatus.NOT_FOUND)
                    return
                app = str(payload.get("app", "Antigravity")).strip() or "Antigravity"
                subprocess.Popen(["open", "-a", app, str(abs_path)])
                self.send_json({"ok": True, "path": rel_path, "app": app})
            else:
                self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def _update_json_file(path: Path, updater) -> bool:
    """Load a JSON file, call updater(data) -> bool, write back if True."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        changed = updater(data)
        if changed:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
        return bool(changed)
    except (OSError, json.JSONDecodeError) as exc:
        _log.warning("Failed to patch metadata at %s: %s", path, exc)
        return False


def _iter_metadata_files(root: Path, *subdirs: str):
    """Yield all metadata.json files found one level deep in the given subdirectories."""
    for subdir in subdirs:
        d = root / subdir
        if d.is_dir():
            for record_dir in d.iterdir():
                if record_dir.is_dir():
                    meta = record_dir / "metadata.json"
                    if meta.exists():
                        yield meta


def _update_record_display_name(root: Path, kind: str, record_id: str, display_name: str) -> dict:
    subdir = (
        "rawdata" if kind == "rawdata"
        else "data" if kind == "data"
        else "samples" if kind == "sample"
        else "exp" if kind == "exp"
        else "analysis" if kind == "analysis"
        else ""
    )
    if any(c in display_name for c in ("/", "\\", "\0")):
        return {"error": "invalid display_name"}
    if kind == "calc":
        manifest_path = root / "calculators" / record_id / "calculator.json"
        if not manifest_path.exists():
            return {"error": f"calculators/{record_id} not found"}

        def _apply_calc(data):
            current = str(data.get("display_name") or data.get("title") or "").strip()
            if current == display_name:
                return False
            data["display_name"] = display_name
            data.pop("title", None)
            return True

        changed = _update_json_file(manifest_path, _apply_calc)
        return {"ok": True, "id": record_id, "display_name": display_name, "updated_refs": 0, "changed": changed}
    if not subdir:
        return {"error": f"unsupported kind: {kind}"}
    meta_path = root / subdir / record_id / "metadata.json"
    if not meta_path.exists():
        return {"error": f"{subdir}/{record_id} not found"}

    def _apply(data):
        if data.get("display_name") == display_name:
            return False
        data["display_name"] = display_name
        return True

    changed = _update_json_file(meta_path, _apply)
    return {"ok": True, "id": record_id, "display_name": display_name, "updated_refs": 0, "changed": changed}


def _cascade_rename(root: Path, kind: str, old_id: str, new_id: str) -> dict:
    """Rename an entity and cascade-update all cross-references."""
    updated = 0

    if kind == "sample":
        old_dir = root / "samples" / old_id
        new_dir = root / "samples" / new_id
        if not old_dir.exists():
            return {"error": f"samples/{old_id} not found"}
        if new_dir.exists():
            return {"error": f"samples/{new_id} already exists"}
        old_dir.rename(new_dir)

        def _fix_sample(data, oid=old_id, nid=new_id):
            changed = False
            if data.get("sample_id") == oid:
                data["sample_id"] = nid
                changed = True
            exp = data.get("exp")
            if isinstance(exp, dict) and exp.get("sample_id") == oid:
                exp["sample_id"] = nid
                changed = True
            return changed

        for meta in _iter_metadata_files(root, "samples", "rawdata", "data", "exp"):
            if _update_json_file(meta, _fix_sample):
                updated += 1

    elif kind == "exp":
        old_dir = root / "exp" / old_id
        new_dir = root / "exp" / new_id
        if not old_dir.exists():
            return {"error": f"exp/{old_id} not found"}
        if new_dir.exists():
            return {"error": f"exp/{new_id} already exists"}
        old_dir.rename(new_dir)

        def _fix_exp(data, oid=old_id, nid=new_id):
            changed = False
            if data.get("session_id") == oid:
                data["session_id"] = nid
                changed = True
            exp = data.get("exp")
            if isinstance(exp, dict) and exp.get("session_id") == oid:
                exp["session_id"] = nid
                changed = True
            return changed

        for meta in _iter_metadata_files(root, "exp", "rawdata", "data"):
            if _update_json_file(meta, _fix_exp):
                updated += 1

    elif kind == "rawdata":
        old_dir = root / "rawdata" / old_id
        new_dir = root / "rawdata" / new_id
        if not old_dir.exists():
            return {"error": f"rawdata/{old_id} not found"}
        if new_dir.exists():
            return {"error": f"rawdata/{new_id} already exists"}
        old_dir.rename(new_dir)

        old_prefix = f"rawdata/{old_id}/"
        new_prefix = f"rawdata/{new_id}/"

        def _fix_rawdata_source(data, op=old_prefix, np=new_prefix, oid=old_id, nid=new_id):
            changed = False
            # New schema: rawdata_id field
            if data.get("rawdata_id") == oid:
                data["rawdata_id"] = nid
                changed = True
            # Legacy schema: source dict with rawdata_csv/rawdata_json paths
            source = data.get("source")
            if isinstance(source, dict):
                for key in ("rawdata_csv", "rawdata_json"):
                    val = source.get(key)
                    if isinstance(val, str) and val.startswith(op):
                        source[key] = np + val[len(op):]
                        changed = True
            return changed

        for meta in _iter_metadata_files(root, "data"):
            if _update_json_file(meta, _fix_rawdata_source):
                updated += 1

    elif kind == "data":
        old_dir = root / "data" / old_id
        new_dir = root / "data" / new_id
        if not old_dir.exists():
            return {"error": f"data/{old_id} not found"}
        if new_dir.exists():
            return {"error": f"data/{new_id} already exists"}
        old_csv = old_dir / f"{old_id}.csv"
        if old_csv.exists():
            old_csv.rename(old_dir / f"{new_id}.csv")
        old_dir.rename(new_dir)

        meta_path = new_dir / "metadata.json"
    elif kind == "analysis":
        old_dir = root / "analysis" / old_id
        new_dir = root / "analysis" / new_id
        if not old_dir.exists():
            return {"error": f"analysis/{old_id} not found"}
        if new_dir.exists():
            return {"error": f"analysis/{new_id} already exists"}
        old_dir.rename(new_dir)

    elif kind == "calc":
        old_dir = root / "calculators" / old_id
        new_dir = root / "calculators" / new_id
        if not old_dir.exists():
            return {"error": f"calculators/{old_id} not found"}
        if new_dir.exists():
            return {"error": f"calculators/{new_id} already exists"}
        old_dir.rename(new_dir)
        manifest = new_dir / "calculator.json"
        if manifest.exists():
            def _fix_manifest(data, oid=old_id, nid=new_id):
                if data.get("id") == oid:
                    data["id"] = nid
                    return True
                return False
            _update_json_file(manifest, _fix_manifest)
        def _fix_calc_ref(data, oid=old_id, nid=new_id):
            if data.get("calculator") == oid:
                data["calculator"] = nid
                return True
            return False
        for meta in _iter_metadata_files(root, "data"):
            if _update_json_file(meta, _fix_calc_ref):
                updated += 1

    else:
        return {"error": f"unknown kind: {kind}"}

    return {"ok": True, "new_id": new_id, "updated_refs": updated}


def _analysis_stale_refs_for_data(root: Path, data_id: str) -> dict[str, object]:
    data_dir = (root / "data" / data_id).resolve()
    analysis_ids: list[str] = []
    missing_refs = 0
    for meta_path in _iter_metadata_files(root, "analysis"):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            _log.warning("Skipping unreadable analysis metadata %s: %s", meta_path, exc)
            continue
        if not isinstance(refs, list):
            continue
        project_id = meta_path.parent.name
        project_missing = 0
        for raw_ref in refs:
            if not isinstance(raw_ref, str) or not raw_ref:
                continue
            try:
                actual = (meta_path.parent / raw_ref).resolve()
            except OSError:
                continue
            if actual == data_dir or data_dir in actual.parents:
                project_missing += 1
        if project_missing:
            analysis_ids.append(project_id)
            missing_refs += project_missing
    return {"analysis_ids": analysis_ids, "missing_refs": missing_refs}


def _delete_entity(root: Path, kind: str, entity_id: str) -> dict[str, object]:
    if not entity_id or any(c in entity_id for c in ("/", "\\", "\0")) or entity_id in (".", ".."):
        return {"error": "invalid id"}

    dir_map = {
        "sample": root / "samples" / entity_id,
        "exp": root / "exp" / entity_id,
        "data": root / "data" / entity_id,
        "analysis": root / "analysis" / entity_id,
        "calc": root / "calculators" / entity_id,
    }

    if kind == "rawdata":
        return {"error": "rawdata delete is disabled"}
    target_dir = dir_map.get(kind)
    if target_dir is None:
        return {"error": f"unknown kind: {kind}"}
    if not target_dir.is_dir():
        return {"error": "not found"}

    stale_info = {"analysis_ids": [], "missing_refs": 0}
    if kind == "data":
        stale_info = _analysis_stale_refs_for_data(root, entity_id)

    shutil.rmtree(target_dir)
    return {
        "ok": True,
        "kind": kind,
        "id": entity_id,
        "stale_analyses": stale_info["analysis_ids"],
        "stale_analysis_count": len(stale_info["analysis_ids"]),
        "missing_reference_count": stale_info["missing_refs"],
    }


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
