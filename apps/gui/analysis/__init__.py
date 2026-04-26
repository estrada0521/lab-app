"""分析ドメイン（新規分析の入力検証と plot 雛形）。"""

from .plot_template import (
    collect_source_data_ids_from_cells,
    generate_plot_py,
    validate_analysis_grid_cells,
)

__all__ = [
    "collect_source_data_ids_from_cells",
    "generate_plot_py",
    "validate_analysis_grid_cells",
]
