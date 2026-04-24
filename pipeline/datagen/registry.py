from __future__ import annotations

import csv
import importlib.util
import json
import logging
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

_log = logging.getLogger(__name__)

from .core import (
    FilterContext,
    build_source_context,
    data_output_paths,
    next_data_id,
    read_metadata,
    relative_text,
    resolve_param,
    resolve_path,
    with_resolved_params,
    write_metadata,
)


@dataclass(frozen=True)
class CalculatorEntry:
    id: str
    display_name: str
    description: str
    ui_options: list[dict[str, Any]]
    required_columns_detail: list[dict[str, Any]]
    required_parameters: list[str]
    data_metadata_policy: dict[str, Any]
    manifest_path: Path
    package_dir: Path
    handler_path: Path
    readme_path: Path
    transform_type: str
    output_columns: list[str]


def _load_manifest(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"calculator manifest must be a JSON object: {path}")
    return payload


def _calculator_entry(root: Path, manifest_path: Path) -> CalculatorEntry:
    payload = _load_manifest(manifest_path)
    package_dir = manifest_path.parent.resolve()
    calculator_id = str(payload.get("id") or package_dir.name).strip()
    display_name = str(payload.get("display_name") or payload.get("title") or calculator_id).strip()
    description = str(payload.get("description") or "").strip()
    if not calculator_id:
        raise ValueError(f"calculator manifest must define id: {manifest_path}")
    handler_rel = "calculator.py"
    readme_rel = "README.md"
    ui_options = payload.get("ui_options") if isinstance(payload.get("ui_options"), list) else []
    transform_type = str(payload.get("transform_type") or "column").strip()
    output_columns = [str(c) for c in payload.get("output_columns", []) if str(c).strip()]
    required_parameters = [str(item).strip() for item in payload.get("required_parameters", []) if str(item).strip()]
    return CalculatorEntry(
        id=calculator_id,
        display_name=display_name,
        description=description,
        ui_options=[dict(item) for item in ui_options if isinstance(item, dict)],
        required_columns_detail=[dict(item) for item in payload.get("required_columns_detail", []) if isinstance(item, dict)],
        required_parameters=required_parameters,
        data_metadata_policy=payload.get("data_metadata_policy") if isinstance(payload.get("data_metadata_policy"), dict) else {},
        manifest_path=manifest_path.resolve(),
        package_dir=package_dir,
        handler_path=(package_dir / handler_rel).resolve(),
        readme_path=(package_dir / readme_rel).resolve(),
        transform_type=transform_type,
        output_columns=output_columns,
    )


def _calculator_entries(root: Path) -> list[CalculatorEntry]:
    manifests = sorted((root / "calculators").glob("*/calculator.json"))
    return [_calculator_entry(root, manifest_path) for manifest_path in manifests]


@lru_cache(maxsize=None)
def _handler_module(handler_path_text: str) -> ModuleType:
    handler_path = Path(handler_path_text).resolve()
    db_root = handler_path.parents[2]
    for path_text in (str(db_root),):
        if path_text not in sys.path:
            sys.path.insert(0, path_text)
    module_name = f"datparser_calculator_{handler_path.parent.name}_{handler_path.stem}"
    spec = importlib.util.spec_from_file_location(module_name, handler_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not load calculator handler: {handler_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _handler(entry: CalculatorEntry) -> ModuleType:
    module = _handler_module(str(entry.handler_path))
    for name in ("inspect_source", "analyze_source", "create_data"):
        if not hasattr(module, name):
            raise AttributeError(f"calculator handler missing {name}: {entry.handler_path}")
    return module


def _readme_text(entry: CalculatorEntry) -> str:
    return entry.readme_path.read_text(encoding="utf-8")


def _raw_default_x(context: FilterContext) -> str:
    source_meta = read_metadata(context.source_path.parent / "metadata.json")
    return str(source_meta.get("default_x") or "").strip()


def _format_template(value: str, analysis: dict[str, Any]) -> str:
    try:
        return value.format(
            element=analysis.get("parameters", {}).get("normalization_element", ""),
        )
    except (KeyError, ValueError, IndexError):
        return value


def _apply_data_metadata_policy(
    entry: CalculatorEntry,
    context: FilterContext,
    metadata: dict[str, Any],
    analysis: dict[str, Any],
    calculator_options: dict[str, Any],
) -> dict[str, Any]:
    payload = dict(metadata)
    payload.pop("measurement_kind", None)
    policy = entry.data_metadata_policy if isinstance(entry.data_metadata_policy, dict) else {}
    defaults = policy.get("defaults") if isinstance(policy.get("defaults"), dict) else {}
    if isinstance(defaults.get("default_y"), str) and defaults.get("default_y"):
        payload["default_y"] = _format_template(str(defaults["default_y"]), analysis)
    default_x_map = defaults.get("default_x_map")
    raw_default_x = _raw_default_x(context)
    if isinstance(default_x_map, list) and raw_default_x:
        for item in default_x_map:
            if not isinstance(item, dict):
                continue
            source_any = item.get("source_any_of")
            if isinstance(source_any, list) and raw_default_x in [str(v) for v in source_any]:
                output = str(item.get("output") or "").strip()
                if output:
                    payload["default_x"] = output
                    break
    by_option = policy.get("by_option") if isinstance(policy.get("by_option"), dict) else {}
    selected_mode = str((calculator_options or {}).get("mode") or "").strip()
    mode_policy = by_option.get(selected_mode) if selected_mode else None
    if isinstance(mode_policy, dict):
        default_x = str(mode_policy.get("default_x") or "").strip()
        default_y = str(mode_policy.get("default_y") or "").strip()
        if default_x:
            payload["default_x"] = default_x
        if default_y:
            payload["default_y"] = default_y
        append_conditions = mode_policy.get("conditions_append")
        if isinstance(append_conditions, dict):
            from .core import merge_conditions
            current_conditions = payload.get("conditions") if isinstance(payload.get("conditions"), dict) else {}
            payload["conditions"] = merge_conditions(current_conditions, append_conditions)
    return payload


def _entry_payload(root: Path, entry: CalculatorEntry, *, include_readme: bool = False) -> dict[str, Any]:
    payload = {
        "id": entry.id,
        "display_name": entry.display_name,
        "description": entry.description,
        "ui_options": entry.ui_options,
        "required_columns_detail": entry.required_columns_detail,
        "required_parameters": entry.required_parameters,
        "data_metadata_policy": entry.data_metadata_policy,
        "package_path": relative_text(entry.package_dir, root),
        "manifest_path": relative_text(entry.manifest_path, root),
        "handler_path": relative_text(entry.handler_path, root),
        "readme_path": relative_text(entry.readme_path, root),
        "transform_type": entry.transform_type,
        "output_columns": entry.output_columns,
    }
    if include_readme:
        payload["readme"] = _readme_text(entry)
    return payload


def list_calculators(root: Path, *, include_readme: bool = False) -> list[dict[str, Any]]:
    return [_entry_payload(root, entry, include_readme=include_readme) for entry in _calculator_entries(root)]


def _required_param_names(entry: CalculatorEntry) -> list[str]:
    return list(entry.required_parameters)


def _context_for_entry(entry: CalculatorEntry, context: FilterContext) -> FilterContext:
    resolved: dict[str, Any] = {}
    for name in _required_param_names(entry):
        try:
            resolved[name] = resolve_param(name, context.raw_meta, context.sample_meta, context.material_meta)[0]
        except KeyError:
            continue
    return with_resolved_params(context, resolved)


def _inspect_calculator(
    entry: CalculatorEntry,
    context: FilterContext,
    header: list[str],
    rows: list[dict[str, str]],
    *,
    source_name: str,
    calculator_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    prepared_context = _context_for_entry(entry, context)
    module = _handler(entry)
    inspect_fn = getattr(module, "inspect_source", None)
    if callable(inspect_fn):
        payload = inspect_fn(prepared_context, header, rows, source_name=source_name, calculator_options=calculator_options or {})
        if not isinstance(payload, dict):
            raise ValueError(f"inspect_source must return a dict: {entry.id}")
    else:
        analysis = module.analyze_source(prepared_context, header, rows, source_name=source_name, calculator_options=calculator_options or {})
        payload = {
            "ready": True,
            "analysis": analysis,
            "missing_columns": [],
            "missing_metadata": [],
            "errors": [],
            "required_source_columns": analysis.get("required_source_columns", []),
            "parameters": analysis.get("parameters", {}),
        }
    analysis = payload.get("analysis") if isinstance(payload.get("analysis"), dict) else None
    return {
        "ready": bool(payload.get("ready")),
        "missing_columns": [str(item) for item in payload.get("missing_columns", [])],
        "missing_metadata": [str(item) for item in payload.get("missing_metadata", [])],
        "errors": [str(item) for item in payload.get("errors", [])],
        "required_source_columns": [str(item) for item in payload.get("required_source_columns", analysis.get("required_source_columns", []) if analysis else [])],
        "parameters": payload.get("parameters", analysis.get("parameters", {}) if analysis else {}),
        "analysis": analysis,
        "resolved_params": dict(prepared_context.resolved_params),
    }


def assess_calculators(
    context: FilterContext,
    header: list[str],
    rows: list[dict[str, str]],
    *,
    source_name: str,
    calculator_options: dict[str, Any] | None = None,
) -> list[tuple[CalculatorEntry, dict[str, Any]]]:
    assessments: list[tuple[CalculatorEntry, dict[str, Any]]] = []
    for entry in _calculator_entries(context.repo_root):
        try:
            assessments.append((entry, _inspect_calculator(entry, context, header, rows, source_name=source_name, calculator_options=calculator_options)))
        except Exception as exc:
            assessments.append(
                (
                    entry,
                    {
                        "ready": False,
                        "missing_columns": [],
                        "missing_metadata": [],
                        "errors": [str(exc)],
                        "required_source_columns": [],
                        "parameters": {},
                        "analysis": None,
                    },
                )
            )
    return assessments


def available_calculators(context: FilterContext, *, calculator_options: dict[str, Any] | None = None) -> list[CalculatorEntry]:
    try:
        from .core import read_source_rows

        header, rows = read_source_rows(context.source_path)
    except (OSError, UnicodeDecodeError, csv.Error, ValueError) as exc:
        _log.debug("Cannot read source table for %s: %s", context.source_path, exc)
        return []
    matches: list[CalculatorEntry] = []
    for entry, assessment in assess_calculators(
        context,
        header,
        rows,
        source_name=context.filter_id,
        calculator_options=calculator_options,
    ):
        if assessment.get("ready"):
            matches.append(entry)
    return matches


def get_calculator(
    context: FilterContext,
    calculator_id: str | None = None,
    *,
    calculator_options: dict[str, Any] | None = None,
) -> CalculatorEntry:
    matches = available_calculators(context, calculator_options=calculator_options)
    if not matches:
        raise ValueError("no calculator is ready for this rawdata")
    if calculator_id is None:
        return matches[0]
    for entry in matches:
        if entry.id == calculator_id:
            return entry
    raise ValueError(f"calculator not available for this rawdata: {calculator_id}")


def create_data_for_context(
    context: FilterContext,
    output_name: str | None = None,
    display_name: str | None = None,
    overwrite: bool = False,
    calculator_id: str | None = None,
    calculator_options: dict[str, Any] | None = None,
    retained_source_columns: list[str] | None = None,
    source_header: list[str] | None = None,
    source_rows: list[dict[str, str]] | None = None,
):
    from .core import read_source_rows

    if source_header is None or source_rows is None:
        header, rows = read_source_rows(context.source_path)
    else:
        header, rows = source_header, source_rows
    assessments = assess_calculators(context, header, rows, source_name=context.filter_id, calculator_options=calculator_options)
    by_id = {entry.id: (entry, assessment) for entry, assessment in assessments}
    if calculator_id:
        if calculator_id not in by_id:
            raise ValueError(f"calculator not available for this rawdata: {calculator_id}")
        calculator, selected_assessment = by_id[calculator_id]
    else:
        calculator, selected_assessment = next(
            ((entry, assessment) for entry, assessment in assessments if assessment.get("ready")),
            (None, None),
        )
        if calculator is None:
            calculator = assessments[0][0]
            selected_assessment = assessments[0][1]
    if not selected_assessment or not selected_assessment.get("ready"):
        missing = [*selected_assessment.get("missing_columns", []), *selected_assessment.get("missing_metadata", []), *selected_assessment.get("errors", [])]
        details = "; ".join(missing) if missing else "dependencies are missing"
        raise ValueError(f"calculator is not ready: {calculator.id} ({details})")
    prepared_context = with_resolved_params(context, selected_assessment.get("resolved_params", {}))
    data_id = output_name or next_data_id(context.repo_root)
    result = _handler(calculator).create_data(
        prepared_context,
        output_name=data_id,
        overwrite=overwrite,
        calculator_options=calculator_options or {},
        retained_source_columns=retained_source_columns,
        source_header=header,
        source_rows=rows,
    )
    output_paths = getattr(result, "output_paths", {}) or {}
    meta_path = output_paths.get("json")
    if isinstance(meta_path, Path) and meta_path.exists():
        metadata = read_metadata(meta_path)
        metadata = _apply_data_metadata_policy(calculator, context, metadata, selected_assessment.get("analysis") if isinstance(selected_assessment.get("analysis"), dict) else {}, calculator_options or {})
        normalized_display_name = str(display_name or "").strip()
        if normalized_display_name:
            metadata["display_name"] = normalized_display_name
        else:
            metadata.setdefault("display_name", data_id)
        write_metadata(meta_path, metadata)
    return result


def create_data(
    root: Path,
    source: str | Path,
    output_name: str | None = None,
    display_name: str | None = None,
    overwrite: bool = False,
    calculator_id: str | None = None,
    calculator_options: dict[str, Any] | None = None,
    retained_source_columns: list[str] | None = None,
    source_header: list[str] | None = None,
    source_rows: list[dict[str, str]] | None = None,
):
    source_path = resolve_path(root, str(source))
    context = build_source_context(root, source_path, source_name=source_path.stem)
    return create_data_for_context(
        context,
        output_name=output_name,
        display_name=display_name,
        overwrite=overwrite,
        calculator_id=calculator_id,
        calculator_options=calculator_options,
        retained_source_columns=retained_source_columns,
        source_header=source_header,
        source_rows=source_rows,
    )


def summarize_raw_source(
    root: Path,
    source_path: Path,
    header: list[str],
    rows: list[dict[str, str]],
    display_name: str | None = None,
    calculator_id: str | None = None,
    calculator_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    context = build_source_context(root, source_path, source_name=source_path.stem)
    assessments = assess_calculators(context, header, rows, source_name=source_path.stem, calculator_options=calculator_options)
    if not assessments:
        raise ValueError("no calculators are installed")

    by_id = {entry.id: (entry, assessment) for entry, assessment in assessments}
    if calculator_id and calculator_id not in by_id:
        raise ValueError(f"calculator not available for this rawdata: {calculator_id}")
    selected_entry, selected_assessment = by_id.get(calculator_id) if calculator_id else next(
        ((entry, assessment) for entry, assessment in assessments if assessment.get("ready")),
        assessments[0],
    )
    selected_analysis = selected_assessment.get("analysis") if isinstance(selected_assessment.get("analysis"), dict) else {}

    current_data_id = next_data_id(root)
    default_display_name = str(read_metadata(source_path.parent / "metadata.json").get("display_name") or context.filter_id).strip() or context.filter_id
    current_display_name = str(display_name or "").strip() or default_display_name
    outputs = data_output_paths(context, current_data_id)
    selected_passthrough: list[str] = []
    required_source_columns = [str(name) for name in selected_assessment.get("required_source_columns", selected_analysis.get("required_source_columns", []))]
    optional_source_columns = [name for name in header if name not in required_source_columns]

    return {
        "source": relative_text(source_path, root),
        "rows": len(rows),
        "material_id": context.material_id,
        "sample_id": context.sample_id,
        "kind": context.kind,
        "exp_id": context.exp_id,
        "filter_id": context.filter_id,
        "default_data_id": current_data_id,
        "data_id": current_data_id,
        "default_display_name": default_display_name,
        "selected_display_name": current_display_name,
        "selected_calculator_options": calculator_options or {},
        "default_name": default_display_name,
        "selected_name": current_display_name,
        "kind": selected_analysis.get("kind", ""),
        "calculator": selected_entry.id,
        "calculator_ready": bool(selected_assessment.get("ready")),
        "x_label": selected_analysis.get("summary", {}).get("x_label", ""),
        "y_label": selected_analysis.get("summary", {}).get("y_label", ""),
        "source_x_column": selected_analysis.get("x_column", ""),
        "source_y_column": selected_analysis.get("moment_column") or selected_analysis.get("y_column") or "",
        "output_dir": relative_text(outputs["dir"], root),
        "material": {
            "formula": context.material_meta.get("formula"),
            "molar_mass_g_per_mol": context.material_meta.get("molar_mass_g_per_mol"),
            "normalization_element": context.material_meta.get("normalization", {}).get("magnetization_per")
            if isinstance(context.material_meta.get("normalization"), dict)
            else None,
        },
        "sample": {
            "mass_mg": context.sample_meta.get("mass_mg"),
            "form": context.sample_meta.get("form"),
            "orientation": context.sample_meta.get("orientation"),
            "synthesis_date": context.sample_meta.get("synthesis_date"),
            "polish_date": context.sample_meta.get("polish_date"),
        },
        "exp": {},
        "parameters": selected_assessment.get("parameters", selected_analysis.get("parameters", {})),
        "missing_columns": selected_assessment.get("missing_columns", []),
        "missing_metadata": selected_assessment.get("missing_metadata", []),
        "calculator_errors": selected_assessment.get("errors", []),
        "source_columns": header,
        "required_source_columns": required_source_columns,
        "optional_source_columns": optional_source_columns,
        "selected_passthrough_columns": selected_passthrough,
        "selected_calculator": {**_entry_payload(root, selected_entry, include_readme=False), **selected_assessment},
        "available_calculators": [
            {**_entry_payload(root, entry, include_readme=False), **assessment}
            for entry, assessment in assessments
        ],
    }
