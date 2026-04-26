"""新規分析プロジェクト用: グリッド整合性チェックと plot.py 雛形の生成。

HTTP 層は server が担い、ここは「分析セッション開始時のデータ検証とスクリプト生成」に限定する。
"""

from __future__ import annotations

import json
from pathlib import Path

from pipeline.datagen import core as datagen_core


def collect_source_data_ids_from_cells(cells: list) -> list[str]:
    """Stable unique list of data ids from New Analysis grid cells (row/col order in payload)."""
    seen: set[str] = set()
    out: list[str] = []
    for c in cells:
        if not isinstance(c, dict):
            continue
        for did in c.get("data_ids") or []:
            s = str(did).strip()
            if not s or s in seen:
                continue
            seen.add(s)
            out.append(s)
    return out


def _strip_text(v: object) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _data_fixed_legend_label(meta: dict) -> str:
    """Legend text: only fixed *values* (e.g. ``10K``), not keys like ``temperature``."""
    cond = datagen_core.metadata_conditions(meta)
    fixed = cond.get("fixed")
    if not isinstance(fixed, dict) or not fixed:
        return ""
    parts: list[str] = []
    for _key, value in fixed.items():
        vs = _strip_text(value)
        if vs:
            parts.append(vs)
    return ", ".join(parts)


def _data_legend_label_for_plot(root: Path, data_id: str) -> str:
    """Hardcoded series label: prefer fixed *values* only; else display_name; else id."""
    mp = root / "data" / data_id / "metadata.json"
    meta: dict = {}
    if mp.exists():
        try:
            meta = json.loads(mp.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            meta = {}
    fixed_label = _data_fixed_legend_label(meta)
    if fixed_label:
        return fixed_label
    raw = meta.get("display_name")
    if raw is not None and _strip_text(raw):
        return _strip_text(raw)
    return str(data_id)


def _series_line_colors(n: int) -> list[str]:
    palette = ("black", "red", "blue")
    return [palette[i % len(palette)] for i in range(n)]


def _meta_default_axis_key(meta: dict, key: str) -> str | None:
    v = meta.get(key)
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _data_csv_header_columns(csv_path: Path) -> list[str]:
    import csv as _csv

    try:
        with open(csv_path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                return [c.strip() for c in next(_csv.reader([line]))]
    except (OSError, StopIteration, ValueError, _csv.Error):
        return []


def validate_analysis_grid_cells(root: Path, cells: list) -> str | None:
    """Reject invalid multi-dataset cells. Return human-readable error or None."""
    for c in cells:
        if not isinstance(c, dict):
            continue
        ids = [str(x).strip() for x in (c.get("data_ids") or []) if str(x).strip()]
        if len(ids) <= 1:
            continue
        pairs: list[tuple[str, str]] = []
        for data_id in ids:
            csv_path = root / "data" / data_id / f"{data_id}.csv"
            meta_path = root / "data" / data_id / "metadata.json"
            if not csv_path.exists():
                return f'data "{data_id}" に CSV がありません。'
            if not meta_path.exists():
                return (
                    "1 つのセルに複数の data を入れる場合、各 data の metadata.json に "
                    f'default_x / default_y が必要です（欠け: "{data_id}"）。'
                )
            try:
                dm = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                return f'data "{data_id}" の metadata が読めません（{exc}）。'
            dx = _meta_default_axis_key(dm, "default_x")
            dy = _meta_default_axis_key(dm, "default_y")
            if not dx or not dy:
                return "1 つのセルに複数の data があるときは、各 data の default_x と default_y の両方を metadata に指定してください。"
            cols = _data_csv_header_columns(csv_path)
            if dx not in cols or dy not in cols:
                return f'data "{data_id}" の CSV に default で指定した列（{dx!r}, {dy!r}）がありません。'
            pairs.append((dx, dy))
        if len({p[0] for p in pairs}) != 1:
            return "1 つのセルに複数の data があるとき、すべて同じ default_x（列名）である必要があります。"
        if len({p[1] for p in pairs}) != 1:
            return "1 つのセルに複数の data があるとき、すべて同じ default_y（列名）である必要があります。"
    return None


def _plot_cell_hardcode_defaults(root: Path, data_ids: list[str]) -> tuple[list[str], str | None, str | None, str, str, str, float, str]:
    """Initial values for plot.py constants (single source at generation time; user edits plot.py freely)."""
    line_color = "black"
    linewidth = 1.2
    marker = "o"
    if not data_ids:
        return [], None, None, "", "", line_color, linewidth, marker
    if len(data_ids) == 1:
        did = data_ids[0]
        csv_path = root / "data" / did / f"{did}.csv"
        meta_path = root / "data" / did / "metadata.json"
        dm: dict = {}
        if meta_path.exists():
            try:
                dm = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                dm = {}
        dx = _meta_default_axis_key(dm, "default_x")
        dy = _meta_default_axis_key(dm, "default_y")
        cols = _data_csv_header_columns(csv_path)
        if dx and dy and dx in cols and dy in cols:
            return [did], dx, dy, str(dx), str(dy), line_color, linewidth, marker
        return [did], None, None, "", "", line_color, linewidth, marker
    first = data_ids[0]
    mp = root / "data" / first / "metadata.json"
    dm = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}
    dx = _meta_default_axis_key(dm, "default_x")
    dy = _meta_default_axis_key(dm, "default_y")
    return list(data_ids), dx, dy, str(dx or ""), str(dy or ""), line_color, linewidth, marker


def _analysis_data_display_name(root: Path, data_id: str) -> str:
    mp = root / "data" / data_id / "metadata.json"
    if mp.exists():
        try:
            dm = json.loads(mp.read_text(encoding="utf-8"))
            raw = dm.get("display_name")
            if raw is not None:
                s = str(raw).strip()
                if s:
                    return s
        except (OSError, json.JSONDecodeError):
            pass
    return str(data_id)


def _plot_cell_title(root: Path, data_ids: list[str], r: int, c0: int) -> str:
    if not data_ids:
        return f"({r + 1},{c0 + 1})"
    return " / ".join(_analysis_data_display_name(root, d) for d in data_ids)


def _format_ax_spec_list_entry(
    r: int,
    c0: int,
    rs: int,
    cs_: int,
    ids: list[str],
    x_col: str | None,
    y_col: str | None,
    x_lab: str,
    y_lab: str,
    line_color: str,
    linewidth: float,
    marker: str,
    title: str,
    legend_labels: list[str],
    line_colors: list[str],
    x_min: float | None,
    x_max: float | None,
    y_min: float | None,
    y_max: float | None,
) -> str:
    """One element of _AX_SPECS as a JSON-like indented dict (valid Python)."""
    return (
        "    {\n"
        f'        "ax": [{r + 1}, {c0 + 1}],\n'
        f'        "row": {r},\n'
        f'        "col": {c0},\n'
        f'        "rowspan": {rs},\n'
        f'        "colspan": {cs_},\n'
        f'        "data_ids": {repr(ids)},\n'
        f'        "x_col": {repr(x_col)},\n'
        f'        "y_col": {repr(y_col)},\n'
        f'        "x_label": {repr(x_lab)},\n'
        f'        "y_label": {repr(y_lab)},\n'
        f'        "line_color": {repr(line_color)},\n'
        f'        "linewidth": {repr(linewidth)},\n'
        f'        "marker": {repr(marker)},\n'
        f'        "legend_labels": {repr(legend_labels)},\n'
        f'        "line_colors": {repr(line_colors)},\n'
        f'        "x_min": {repr(x_min)},\n'
        f'        "x_max": {repr(x_max)},\n'
        f'        "y_min": {repr(y_min)},\n'
        f'        "y_max": {repr(y_max)},\n'
        f'        "title": {repr(title)},\n'
        "    },\n"
    )


_PLOT_PY_TAIL = """
# --- 以下の定数・描画ループの役割（必要に応じて編集してください）---
# 先頭付近の apply_matplotlib_preset … 全 ax 共通の rc（フォント・目盛り・グリッド等）。個別の軸ラベルや lim は _AX_SPECS で編集。
# LINE_STYLES … 1 つのサブプロットに複数の data 系列を重ねるとき、線種を順に切り替えるためのタプル。
# for cfg in _AX_SPECS: … ループ … _AX_SPECS の各要素を 1 サブプロットとして、CSV から列を取り出して描画する（サブプロットのタイトルは cfg["title"]）。
# legend_labels / line_colors … 生成時に各 data の metadata.conditions.fixed の値だけ等から埋め込んだもの（分析 metadata には書かない）。
# x_min / x_max / y_min / y_max … 数を入れればその軸端を固定。None のままなら描画後の自動スケールを維持（片側だけ指定も可）。
# savefig / plt.close … 画像 output.png を書き出して終了する。

LINE_STYLES = ("-", "--", "-.", ":")


fig = plt.figure(
    figsize=(CELL_IN * COLS, CELL_IN * ROWS),
    facecolor="white",
    constrained_layout=True,
)
gs = GridSpec(ROWS, COLS, figure=fig)

for cfg in _AX_SPECS:
    row, col = cfg["row"], cfg["col"]
    rs, cs = cfg["rowspan"], cfg["colspan"]
    ax = fig.add_subplot(gs[row : row + rs, col : col + cs])
    ax.set_facecolor("white")
    for spine in ax.spines.values():
        spine.set_color("black")
        spine.set_linewidth(0.8)
    ax.tick_params(axis="both", colors="black", labelsize=9)
    ax.set_axisbelow(True)

    data_ids = cfg["data_ids"]
    if not data_ids:
        ax.set_axis_off()
        continue

    ax.minorticks_on()
    ax.grid(True, which="both")

    x_col, y_col = cfg["x_col"], cfg["y_col"]
    x_label, y_label = cfg["x_label"], cfg["y_label"]
    linewidth = cfg["linewidth"]
    marker = cfg["marker"]
    legend_labels = cfg.get("legend_labels") or [str(d) for d in data_ids]
    line_colors = cfg.get("line_colors")
    if not line_colors or len(line_colors) != len(data_ids):
        base = cfg.get("line_color", "black")
        line_colors = [base] * len(data_ids)

    for i, data_id in enumerate(data_ids):
        csv_path = DB_ROOT / "data" / data_id / f"{data_id}.csv"
        df = pd.read_csv(csv_path, comment="#")
        if x_col is not None and y_col is not None and x_col in df.columns and y_col in df.columns:
            xs, ys = df[x_col], df[y_col]
        else:
            xs, ys = df.iloc[:, 0], df.iloc[:, 1]
        sty = LINE_STYLES[i % len(LINE_STYLES)]
        pt = max(len(xs), 1)
        step = max(1, pt // 80)
        lc = line_colors[i]
        leg = legend_labels[i] if i < len(legend_labels) else str(data_id)
        ax.plot(
            xs,
            ys,
            color=lc,
            linestyle=sty,
            linewidth=linewidth,
            marker=marker,
            markersize=2.5,
            markevery=slice(0, None, step),
            markerfacecolor=lc,
            markeredgecolor=lc,
            label=leg,
        )

    ax.set_title(cfg["title"], fontsize=9, color="black")
    if x_label:
        ax.set_xlabel(x_label, fontsize=9, color="black")
    if y_label:
        ax.set_ylabel(y_label, fontsize=9, color="black")

    # Optional axis limits (edit in _AX_SPECS). None keeps autoscale for that bound.
    _xlim = ax.get_xlim()
    _xm, _xM = cfg.get("x_min"), cfg.get("x_max")
    if _xm is not None or _xM is not None:
        ax.set_xlim(_xm if _xm is not None else _xlim[0], _xM if _xM is not None else _xlim[1])
    _ylim = ax.get_ylim()
    _ym, _yM = cfg.get("y_min"), cfg.get("y_max")
    if _ym is not None or _yM is not None:
        ax.set_ylim(_ym if _ym is not None else _ylim[0], _yM if _yM is not None else _ylim[1])

    if data_ids:
        ax.legend(fontsize=7, loc="best", frameon=False)

out = HERE / "output.png"
fig.savefig(out, dpi=300, facecolor="white")
plt.close(fig)
print(f"Saved: {out}")
"""


def generate_plot_py(root: Path, rows: int, cols: int, cells: list) -> str:
    """Emit plot.py: _AX_SPECS only — one JSON-like dict per ax (subplot)."""
    lines: list[str] = []
    lines.append(
        "# plot.py — starting point only; edit constants and plotting logic freely.\n"
        "# data id SoT: metadata.json → \"source_data\" (this script does not read that file).\n"
    )
    lines.append("import sys\n")
    lines.append("from pathlib import Path\n\n")
    lines.append("import matplotlib.pyplot as plt\n")
    lines.append("import pandas as pd\n")
    lines.append("from matplotlib.gridspec import GridSpec\n\n")
    lines.append("HERE = Path(__file__).resolve().parent\n")
    lines.append("DB_ROOT = HERE.parents[1]\n\n")
    lines.append(
        "# ---- 全 ax 共通の Matplotlib スタイル（lab の plot_runtime / 将来はテンプレ切替想定）----\n"
        "try:\n"
        "    _pr = DB_ROOT / \"apps\" / \"gui\" / \"analysis\" / \"plot_runtime\"\n"
        "    if _pr.is_dir():\n"
        "        sys.path.insert(0, str(DB_ROOT))\n"
        "        from apps.gui.analysis.plot_runtime import apply_matplotlib_preset\n\n"
        "        apply_matplotlib_preset(\"default\")\n"
        "except Exception:\n"
        "    pass\n\n"
    )
    lines.append("# ---- figure layout (edit) ----\n")
    lines.append(f"ROWS = {rows}\n")
    lines.append(f"COLS = {cols}\n")
    lines.append("CELL_IN = 3.0  # inches per grid slot (width & height)\n\n")

    ax_blocks: list[str] = []
    for c in cells:
        if not isinstance(c, dict):
            continue
        r = int(c["row"])
        c0 = int(c["col"])
        rs = int(c.get("rowspan", 1))
        cs_ = int(c.get("colspan", 1))
        ids_raw = [str(x).strip() for x in (c.get("data_ids") or []) if str(x).strip()]
        ids, x_col, y_col, x_lab, y_lab, line_color, linewidth, marker = _plot_cell_hardcode_defaults(root, ids_raw)
        legend_labels = [_data_legend_label_for_plot(root, did) for did in ids]
        line_colors = _series_line_colors(len(ids))
        title = _plot_cell_title(root, ids_raw, r, c0)
        ax_blocks.append(
            _format_ax_spec_list_entry(
                r,
                c0,
                rs,
                cs_,
                ids,
                x_col,
                y_col,
                x_lab,
                y_lab,
                line_color,
                linewidth,
                marker,
                title,
                legend_labels,
                line_colors,
                None,
                None,
                None,
                None,
            )
        )

    lines.append("# ---- per-axis defaults (edit) ----\n")
    lines.append("# _AX_SPECS … サブプロット（ax）ごとに 1 要素のリスト。JSON に近い辞書を並べただけなので、このリストだけ編集すればよい。\n\n")
    lines.append("_AX_SPECS = [\n")
    lines.extend(ax_blocks)
    lines.append("]\n\n")
    lines.append(_PLOT_PY_TAIL)
    return "".join(lines)
