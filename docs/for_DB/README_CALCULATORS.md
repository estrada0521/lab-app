# Calculator 作成ガイド

この文書だけを参照して、GUI の「Make Data」から実行できる Calculator を作成できることを目標に書かれています。

Calculator の責務は「rawdata（生データ）を再利用可能な物理量 CSV へ変換すること」です。科学的比較・解釈は `analysis/` の責務であり、ここでは行いません。

---

## 1. ディレクトリ構成

フォルダ名がそのまま Calculator ID になります。

```
calculators/<calculator_id>/
├── calculator.json   # GUI が読み込む宣言ファイル
├── calculator.py     # GUI が直接 import する変換ロジック
└── README.md         # 物理モデル・入出力仕様のドキュメント
```

---

## 2. calculator.json

GUI に「この Calculator が何を必要とし、何を出力するか」を伝える宣言ファイルです。

```json
{
  "display_name": "人間向けの表示名",
  "description": "何をする Calculator か一文で",
  "transform_type": "column",
  "output_columns": [
    "field_t",
    "temperature_k",
    "magnetization_muB_per_Ni"
  ],
  "required_columns_detail": [
    { "any_of": ["Magnetic Field (Oe)", "Field (Oe)"] },
    { "any_of": ["Temperature (K)", "Average Temp (K)"] },
    { "all_of": ["Lockin_data_1"] }
  ],
  "required_parameters": [
    "mass_mg",
    "molar_mass_g_per_mol"
  ]
}
```

| フィールド | 説明 |
|:---|:---|
| `display_name` | GUI に表示される名前 |
| `description` | Calculator の概要 |
| `transform_type` | `"column"`（行ごとの変換）または `"processing"`（非線形処理） |
| `output_columns` | 出力 CSV のカラム名リスト |
| `required_columns_detail` | rawdata に必要な列を宣言する。`any_of`（いずれか1つ）または `all_of`（すべて必須）で列名候補を列挙 |
| `required_parameters` | 計算に必要なパラメータ名を宣言するだけでよい。値の解決は GUI が行う |

---

## 3. calculator.py の実装

`_template/calculator.py` をコピーして `# TODO` の箇所を実装してください。

GUI は `calculator.py` を直接 import し、以下の **3 関数を必ず呼び出します**。テンプレートにはすべてのシグネチャ・戻り値構造・メタデータ書き込みパターンが含まれています。

| 関数 | 役割 | 実装すること |
|:---|:---|:---|
| `inspect_source` | 使用可否の判定 | `REQUIRED_COLUMNS` と `REQUIRED_PARAMS` を定数として定義する |
| `analyze_source` | データ構造の解析 | `resolved_params` からパラメータを取り出し、`kind` / `x_column` / `summary` を返す |
| `create_data` | 変換と出力 | 物理量への変換処理と CSV 書き出しを実装する |

---

## 4. FilterContext の主要フィールド

| フィールド | 型 | 内容 |
|:---|:---|:---|
| `repo_root` | `Path` | DB ルート（`rawdata/`, `samples/` などの親） |
| `source_path` | `Path` | 変換元の rawdata ファイルパス |
| `resolved_params` | `dict` | `required_parameters` に宣言したパラメータの解決済み値 |
| `filter_id` | `str` | rawdata フォルダ名（デフォルト出力名） |

---

## 5. calculator.py で使える主要ユーティリティ

```python
from pipeline.datagen.core import (
    FilterContext,
    read_csv_rows,           # (path) -> (header, rows)
    parse_float,             # (str) -> float | None
    first_existing,          # (header, candidates) -> str | None
    write_csv,               # (path, header, rows)
    write_metadata,          # (path, dict)
    read_metadata,           # (path) -> dict
    ensure_output_paths,     # (context, name, overwrite, keys) -> paths_dict
    inherited_data_metadata, # (context) -> dict  — kind / conditions を rawdata から継承
    timestamp,               # () -> str
    source_record_name,      # (repo_root, path) -> str
    relative_text,           # (path, root) -> str
    remove_legacy_file,      # (path)
    PREFERRED_PASSTHROUGH_COLUMNS,  # ["Time_sec", ...] — 自動引き継ぎ候補列
)
```

---

## 6. 新規作成チェックリスト

- [ ] `calculators/<calculator_id>/` フォルダを作成した（フォルダ名 = Calculator ID）
- [ ] `calculator.json` に `display_name`, `description`, `transform_type`, `output_columns`, `required_columns_detail`, `required_parameters` を記載した
- [ ] `_template/calculator.py` をコピーして `# TODO` をすべて実装した
- [ ] `README.md` に物理モデルと入出力仕様を記載した
