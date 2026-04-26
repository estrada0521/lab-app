"""既定の全体スタイル（内向き目盛り・マイナー目盛り・メジャー点線グリッド・Arial 優先）。

生成される ``plot.py`` 先頭にも同内容が ``rcParams.update`` として埋め込まれる（単一ソースは本モジュールの ``RCPARAMS``）。
"""

from __future__ import annotations

import matplotlib as mpl

# https://matplotlib.org/stable/users/explain/customizing.html
RCPARAMS: dict[str, object] = {
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
    "xtick.direction": "in",
    "ytick.direction": "in",
    "xtick.minor.visible": True,
    "ytick.minor.visible": True,
    "xtick.major.size": 3.5,
    "xtick.minor.size": 2.0,
    "ytick.major.size": 3.5,
    "ytick.minor.size": 2.0,
    "grid.linestyle": ":",
    "grid.linewidth": 0.45,
    "grid.color": "#999999",
    "grid.alpha": 0.55,
}


def apply_rcparams() -> None:
    mpl.rcParams.update(RCPARAMS)
