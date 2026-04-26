"""JSON metadata patching, rename cascade, and entity deletion for the GUI server."""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

_log = logging.getLogger(__name__)


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


def update_record_display_name(root: Path, kind: str, record_id: str, display_name: str) -> dict:
    subdir = (
        "rawdata" if kind == "rawdata"
        else "data" if kind == "data"
        else "samples" if kind == "sample"
        else "exp" if kind == "exp"
        else "analysis" if kind == "analysis"
        else "build" if kind == "build"
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


def cascade_rename(root: Path, kind: str, old_id: str, new_id: str) -> dict:
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
            if data.get("exp_id") == oid:
                data["exp_id"] = nid
                changed = True
            exp = data.get("exp")
            if isinstance(exp, dict) and exp.get("exp_id") == oid:
                exp["exp_id"] = nid
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

        def _fix_analysis_ref(data, oid=old_id, nid=new_id):
            refs = data.get("source_analysis")
            if not isinstance(refs, list):
                return False
            new_refs = [nid if r == oid else r for r in refs]
            if new_refs != refs:
                data["source_analysis"] = new_refs
                return True
            return False

        for meta in _iter_metadata_files(root, "build"):
            if _update_json_file(meta, _fix_analysis_ref):
                updated += 1

    elif kind == "build":
        old_dir = root / "build" / old_id
        new_dir = root / "build" / new_id
        if not old_dir.exists():
            return {"error": f"build/{old_id} not found"}
        if new_dir.exists():
            return {"error": f"build/{new_id} already exists"}
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
    analysis_ids: list[str] = []
    missing_refs = 0
    for meta_path in _iter_metadata_files(root, "analysis"):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            _log.warning("Skipping unreadable analysis metadata %s: %s", meta_path, exc)
            continue
        refs = meta.get("source_data")
        if not isinstance(refs, list):
            continue
        project_id = meta_path.parent.name
        project_missing = 0
        for raw_ref in refs:
            if isinstance(raw_ref, str) and raw_ref == data_id:
                project_missing += 1
        if project_missing:
            analysis_ids.append(project_id)
            missing_refs += project_missing
    return {"analysis_ids": analysis_ids, "missing_refs": missing_refs}


def _build_stale_refs_for_analysis(root: Path, analysis_id: str) -> dict[str, object]:
    build_ids: list[str] = []
    missing_refs = 0
    for meta_path in _iter_metadata_files(root, "build"):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            _log.warning("Skipping unreadable build metadata %s: %s", meta_path, exc)
            continue
        refs = meta.get("source_analysis")
        if not isinstance(refs, list):
            continue
        build_id = meta_path.parent.name
        project_missing = sum(1 for r in refs if isinstance(r, str) and r == analysis_id)
        if project_missing:
            build_ids.append(build_id)
            missing_refs += project_missing
    return {"build_ids": build_ids, "missing_refs": missing_refs}


def delete_entity(root: Path, kind: str, entity_id: str) -> dict[str, object]:
    if not entity_id or any(c in entity_id for c in ("/", "\\", "\0")) or entity_id in (".", ".."):
        return {"error": "invalid id"}

    dir_map = {
        "sample": root / "samples" / entity_id,
        "exp": root / "exp" / entity_id,
        "data": root / "data" / entity_id,
        "analysis": root / "analysis" / entity_id,
        "build": root / "build" / entity_id,
        "calc": root / "calculators" / entity_id,
    }

    if kind == "rawdata":
        return {"error": "rawdata delete is disabled"}
    target_dir = dir_map.get(kind)
    if target_dir is None:
        return {"error": f"unknown kind: {kind}"}
    if not target_dir.is_dir():
        return {"error": "not found"}

    stale_info: dict[str, object] = {"analysis_ids": [], "missing_refs": 0}
    if kind == "data":
        stale_info = _analysis_stale_refs_for_data(root, entity_id)

    build_stale_info: dict[str, object] = {"build_ids": [], "missing_refs": 0}
    if kind == "analysis":
        build_stale_info = _build_stale_refs_for_analysis(root, entity_id)

    shutil.rmtree(target_dir)
    return {
        "ok": True,
        "kind": kind,
        "id": entity_id,
        "stale_analyses": stale_info["analysis_ids"],
        "stale_analysis_count": len(stale_info["analysis_ids"]),
        "stale_builds": build_stale_info["build_ids"],
        "stale_build_count": len(build_stale_info["build_ids"]),
        "missing_reference_count": stale_info["missing_refs"],
    }
