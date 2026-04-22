from __future__ import annotations

import importlib.util
import json
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any

from .core import FilterContext, build_source_context, data_output_paths, read_metadata, relative_text, resolve_path


@dataclass(frozen=True)
class CalculatorEntry:
    id: str
    title: str
    measurement_type: str
    description: str
    required_columns: list[str]
    required_metadata: list[str]
    required_parameters: list[str]
    dependencies: dict[str, Any]
    manifest_path: Path
    package_dir: Path
    handler_path: Path
    readme_path: Path
    ui_options: list[dict[str, Any]]
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
    measurement_type = str(payload.get("measurement_type") or "").strip()
    title = str(payload.get("title") or calculator_id).strip()
    description = str(payload.get("description") or "").strip()
    if not calculator_id:
        raise ValueError(f"calculator manifest must define id: {manifest_path}")
    handler_rel = str(payload.get("handler") or "calculator.py").strip()
    readme_rel = str(payload.get("readme") or "README.md").strip()
    dependencies = payload.get("dependencies") if isinstance(payload.get("dependencies"), dict) else {}
    ui_options = payload.get("ui_options") if isinstance(payload.get("ui_options"), list) else []
    transform_type = str(payload.get("transform_type") or "column").strip()
    output_columns = [str(c) for c in payload.get("output_columns", []) if str(c).strip()]
    return CalculatorEntry(
        id=calculator_id,
        title=title,
        measurement_type=measurement_type,
        description=description,
        required_columns=[str(item) for item in payload.get("required_columns", [])],
        required_metadata=[str(item) for item in payload.get("required_metadata", [])],
        required_parameters=[str(item) for item in payload.get("required_parameters", [])],
        dependencies=dependencies,
        manifest_path=manifest_path.resolve(),
        package_dir=package_dir,
        handler_path=(package_dir / handler_rel).resolve(),
        readme_path=(package_dir / readme_rel).resolve(),
        ui_options=[dict(item) for item in ui_options if isinstance(item, dict)],
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


def _entry_payload(root: Path, entry: CalculatorEntry, *, include_readme: bool = False) -> dict[str, Any]:
    payload = {
        "id": entry.id,
        "title": entry.title,
        "measurement_type": entry.measurement_type,
        "description": entry.description,
        "required_columns": entry.required_columns,
        "required_metadata": entry.required_metadata,
        "required_parameters": entry.required_parameters,
        "dependencies": entry.dependencies,
        "package_path": relative_text(entry.package_dir, root),
        "manifest_path": relative_text(entry.manifest_path, root),
        "handler_path": relative_text(entry.handler_path, root),
        "readme_path": relative_text(entry.readme_path, root),
        "ui_options": entry.ui_options,
        "transform_type": entry.transform_type,
        "output_columns": entry.output_columns,
    }
    if include_readme:
        payload["readme"] = _readme_text(entry)
    return payload


def list_calculators(root: Path, *, include_readme: bool = False) -> list[dict[str, Any]]:
    return [_entry_payload(root, entry, include_readme=include_readme) for entry in _calculator_entries(root)]


def _inspect_calculator(
    entry: CalculatorEntry,
    context: FilterContext,
    header: list[str],
    rows: list[dict[str, str]],
    *,
    source_name: str,
) -> dict[str, Any]:
    module = _handler(entry)
    inspect_fn = getattr(module, "inspect_source", None)
    if callable(inspect_fn):
        payload = inspect_fn(context, header, rows, source_name=source_name)
        if not isinstance(payload, dict):
            raise ValueError(f"inspect_source must return a dict: {entry.id}")
    else:
        analysis = module.analyze_source(context, header, rows, source_name=source_name)
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
    }


def assess_calculators(
    context: FilterContext,
    header: list[str],
    rows: list[dict[str, str]],
    *,
    source_name: str,
) -> list[tuple[CalculatorEntry, dict[str, Any]]]:
    assessments: list[tuple[CalculatorEntry, dict[str, Any]]] = []
    for entry in _calculator_entries(context.repo_root):
        try:
            assessments.append((entry, _inspect_calculator(entry, context, header, rows, source_name=source_name)))
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


def available_calculators(context: FilterContext) -> list[CalculatorEntry]:
    try:
        from .core import read_csv_rows

        header, rows = read_csv_rows(context.source_path)
    except Exception:
        return []
    matches: list[CalculatorEntry] = []
    for entry, assessment in assess_calculators(context, header, rows, source_name=context.filter_id):
        if assessment.get("ready"):
            matches.append(entry)
    return matches


def get_calculator(context: FilterContext, calculator_id: str | None = None) -> CalculatorEntry:
    matches = available_calculators(context)
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
    overwrite: bool = False,
    calculator_id: str | None = None,
    retained_source_columns: list[str] | None = None,
    source_header: list[str] | None = None,
    source_rows: list[dict[str, str]] | None = None,
):
    from .core import read_csv_rows

    if source_header is None or source_rows is None:
        header, rows = read_csv_rows(context.source_path)
    else:
        header, rows = source_header, source_rows
    assessments = assess_calculators(context, header, rows, source_name=context.filter_id)
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
    return _handler(calculator).create_data(
        context,
        output_name=output_name,
        overwrite=overwrite,
        retained_source_columns=retained_source_columns,
        source_header=header,
        source_rows=rows,
    )


def create_data(
    root: Path,
    source: str | Path,
    output_name: str | None = None,
    overwrite: bool = False,
    calculator_id: str | None = None,
    retained_source_columns: list[str] | None = None,
    source_header: list[str] | None = None,
    source_rows: list[dict[str, str]] | None = None,
):
    source_path = resolve_path(root, str(source))
    context = build_source_context(root, source_path, source_name=source_path.stem)
    return create_data_for_context(
        context,
        output_name=output_name,
        overwrite=overwrite,
        calculator_id=calculator_id,
        retained_source_columns=retained_source_columns,
        source_header=source_header,
        source_rows=source_rows,
    )


def summarize_raw_source(
    root: Path,
    source_path: Path,
    header: list[str],
    rows: list[dict[str, str]],
    output_name: str | None = None,
    calculator_id: str | None = None,
) -> dict[str, Any]:
    context = build_source_context(root, source_path, source_name=source_path.stem)
    assessments = assess_calculators(context, header, rows, source_name=source_path.stem)
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

    current_name = output_name or context.filter_id
    outputs = data_output_paths(context, current_name)
    existing_outputs = {
        key: (relative_text(path, root) if path.exists() else None)
        for key, path in outputs.items()
        if key != "dir"
    }
    existing_data_meta = read_metadata(outputs["json"])
    bindings = existing_data_meta.get("bindings", {}) if isinstance(existing_data_meta, dict) else {}
    selected_passthrough = []
    if isinstance(bindings, dict) and isinstance(bindings.get("selected_passthrough_columns"), list):
        selected_passthrough = [str(name) for name in bindings["selected_passthrough_columns"] if str(name) in header]
    required_source_columns = [str(name) for name in selected_assessment.get("required_source_columns", selected_analysis.get("required_source_columns", []))]
    optional_source_columns = [name for name in header if name not in required_source_columns]

    return {
        "source": relative_text(source_path, root),
        "rows": len(rows),
        "material_id": context.material_id,
        "sample_id": context.sample_id,
        "measurement_type": context.measurement_type,
        "session_id": context.session_id,
        "filter_id": context.filter_id,
        "default_name": context.filter_id,
        "selected_name": current_name,
        "kind": selected_analysis.get("kind", ""),
        "calculator": selected_entry.id,
        "calculator_ready": bool(selected_assessment.get("ready")),
        "x_label": selected_analysis.get("summary", {}).get("x_label", ""),
        "y_label": selected_analysis.get("summary", {}).get("y_label", ""),
        "source_x_column": selected_analysis.get("x_column", ""),
        "source_y_column": selected_analysis.get("moment_column") or selected_analysis.get("y_column") or "",
        "output_dir": relative_text(outputs["dir"], root),
        "outputs": existing_outputs,
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
        "session": {},
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
