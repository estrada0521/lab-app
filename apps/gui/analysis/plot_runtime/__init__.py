"""全 ax 共通の Matplotlib スタイル（rcParams）。

軸ラベル・x/y の範囲など ax ごとに変える設定は、生成される ``plot.py`` の ``_AX_SPECS`` 側で行う。
複数の見た目テンプレートを切り替えられるよう、プリセット名で登録する形にしておく（選択 UI は未実装）。
"""

from __future__ import annotations

from collections.abc import Callable

from .presets import default as _preset_default

# 新テンプレート: presets/<name>.py に apply_rcparams を定義し、ここに "name": module.apply_rcparams を追加する。
_APPLY: dict[str, Callable[[], None]] = {
    "default": _preset_default.apply_rcparams,
}


def apply_matplotlib_preset(name: str = "default") -> None:
    """プリセット名に対応する rcParams を一括適用する。未知の名前は default にフォールバック。"""
    fn = _APPLY.get(name) or _APPLY["default"]
    fn()
