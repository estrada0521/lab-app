from __future__ import annotations

import argparse
import json
from pathlib import Path

from .core import build_source_context, relative_text, resolve_path
from .registry import create_data_for_context


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Convert one rawdata source into data CSV and calculation metadata JSON.")
    parser.add_argument("source", help="rawdata source path")
    parser.add_argument("--db-root", "--root", dest="db_root", default=".", help="database root containing rawdata/, samples/, exp/, data/, DB/, calculators/")
    parser.add_argument("--name", default=None, help="output data folder/file stem; default is the source record name")
    parser.add_argument("--overwrite", action="store_true", help="overwrite existing output files")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    root = Path(args.db_root).resolve()
    source_path = resolve_path(root, args.source)
    context = build_source_context(root, source_path)
    result = create_data_for_context(context, output_name=args.name, overwrite=args.overwrite)

    payload = {
        "source": relative_text(source_path, root),
        "data": relative_text(result.output_paths["csv"], root),
        "json": relative_text(result.output_paths["json"], root),
        "rows": result.rows,
        "x": result.x_label,
        "y": result.y_label,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
