"""Analysis startup: grid validation and generated plot.py content."""

from __future__ import annotations

import json
from pathlib import Path


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
        f'        "title": {repr(title)},\n'
        "    },\n"
    )


_PLOT_PY_TAIL = """
# --- 以下の定数・描画ループの役割（必要に応じて編集してください）---
# LINE_STYLES … 1 つのサブプロットに複数の data 系列を重ねるとき、線種を順に切り替えるためのタプル。
# for cfg in _AX_SPECS: … ループ … _AX_SPECS の各要素を 1 サブプロットとして、CSV から列を取り出して描画する（サブプロットのタイトルは cfg["title"]）。
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
    ax.grid(True, linestyle="-", linewidth=0.45, color="#999999", alpha=0.55)

    data_ids = cfg["data_ids"]
    if not data_ids:
        ax.set_axis_off()
        continue

    x_col, y_col = cfg["x_col"], cfg["y_col"]
    x_label, y_label = cfg["x_label"], cfg["y_label"]
    line_color = cfg["line_color"]
    linewidth = cfg["linewidth"]
    marker = cfg["marker"]

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
        ax.plot(
            xs,
            ys,
            color=line_color,
            linestyle=sty,
            linewidth=linewidth,
            marker=marker,
            markersize=2.5,
            markevery=slice(0, None, step),
            markerfacecolor=line_color,
            markeredgecolor=line_color,
        )

    ax.set_title(cfg["title"], fontsize=9, color="black")
    if x_label:
        ax.set_xlabel(x_label, fontsize=9, color="black")
    if y_label:
        ax.set_ylabel(y_label, fontsize=9, color="black")

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
    lines.append("from pathlib import Path\n\n")
    lines.append("import pandas as pd\n")
    lines.append("import matplotlib.pyplot as plt\n")
    lines.append("from matplotlib.gridspec import GridSpec\n\n")
    lines.append("HERE = Path(__file__).parent\n")
    lines.append("DB_ROOT = HERE.parents[1]\n\n")
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
        title = _plot_cell_title(root, ids_raw, r, c0)
        ax_blocks.append(
            _format_ax_spec_list_entry(
                r, c0, rs, cs_, ids, x_col, y_col, x_lab, y_lab, line_color, linewidth, marker, title
            )
        )

    lines.append("# ---- per-axis defaults (edit) ----\n")
    lines.append("# _AX_SPECS … サブプロット（ax）ごとに 1 要素のリスト。JSON に近い辞書を並べただけなので、このリストだけ編集すればよい。\n\n")
    lines.append("_AX_SPECS = [\n")
    lines.extend(ax_blocks)
    lines.append("]\n\n")
    lines.append(_PLOT_PY_TAIL)
    return "".join(lines)
