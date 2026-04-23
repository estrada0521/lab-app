# lab-app

ローカルの研究データベース (DB) を閲覧・管理・変換するためのリポジトリです。
実データは含まず、起動時に `--db-root` で DB の場所を指定して使います。

> **DB は別管理**（例: Google Drive の `okadaharuto-DB/`）。
> このリポジトリでは GUI ロジック・パイプライン実装・運用文書のみを管理します。

---

## Repo layout

```text
lab-app/
├── apps/
│   └── gui/            # ローカル GUI サーバー (HTTP + SPA)
│       ├── server.py   # エントリーポイント
│       ├── catalog.py  # DB 読み取り・一覧生成
│       ├── core.py     # 共通設定
│       └── static/     # フロントエンド (HTML/CSS/JS)
├── pipeline/
│   ├── datagen/        # rawdata → data 変換エンジン
│   │   ├── core.py     # メタデータ解決・FilterContext
│   │   ├── registry.py # calculator プラグイン管理
│   │   ├── cli.py      # コマンドラインエントリーポイント
│   │   └── gui.py      # GUI 連携ヘルパー
│   └── rawdata_to_data.py  # パイプライン実行スクリプト
├── docs/               # DB 各領域の運用 README
└── logs/               # エージェントログ等
```

---

## DB layout

```text
<db_root>/
│
├── DB/                                   # material DB
│   └── ...
│
├── samples/
│   ├── 000001/
│   │   └── metadata.json
│   └── ...
│
├── exp/
│   ├── 000001/
│   │   └── metadata.json
│   └── ...
│
├── rawdata/
│   ├── 000001/
│   │   ├── <装置出力ファイル>             # ファイル名はそのまま保持
│   │   ├── filterdata/                   # (任意) フィルタ済み中間ファイル
│   │   └── metadata.json
│   └── ...
│
├── data/
│   ├── 000001/
│   │   ├── 000001.csv
│   │   └── metadata.json
│   └── ...
│
├── analysis/
│   ├── 000001/
│   │   ├── plot.py
│   │   ├── plotted_data.csv
│   │   ├── summary.png / summary.pdf
│   │   └── metadata.json
│   └── ...
│
└── calculators/
    ├── magnetization_v1/
    │   ├── calculator.py
    │   ├── calculator.json
    │   └── README.md
    └── strain_raw_v1/
        ├── calculator.py
        ├── calculator.json
        ├── README.md
        └── assets/
            └── cu_thermal_expansion.csv
```

### samples/metadata.json

```json
{
  "display_name": "250707",
  "form": "single_crystal",
  "mass_mg": 22.8,
  "material_id": "NiS2",
  "orientation": "001",
  "owner": "Haruto Okada",
  "polish_date": "250707",
  "synthesis_date": "unknown",
  "synthesizer": "Masato Matsuura",
  "notes": ""
}
```

### exp/metadata.json

```json
{
  "display_name": "NiS2_001_磁場誘起歪み測定_by_低温研PPMS",
  "start_date": "251202",
  "end_date": "251207"
}
```

### rawdata/metadata.json

magnetization の例:

```json
{
  "display_name": "NiS2__mag__mh-10k",
  "kind": "magnetization",
  "sample_id": "000002",
  "session_id": "000006",
  "payload_file": "NiS2__250707-2__magnetization__exp-251217__mh-10k.dat",
  "conditions": {
    "fixed": { "temperature": "10K" },
    "sweep": ["field"]
  },
  "default_x": "Magnetic Field (Oe)",
  "default_y": "DC Moment Fixed Ctr (emu)",
  "uploaded_at": ""
}
```

strain の場合は calculator パラメータを `strain_calculation` ブロックに追加で持つ:

```json
{
  "display_name": "NiS2_strain_001_250709",
  "kind": "strain",
  "sample_id": "000001",
  "session_id": "000002",
  "payload_file": "NiS2__250707__strain__exp-250709__raw.csv",
  "strain_calculation": {
    "calculator": "strain_raw_v1",
    "gauge_factor": 2.0,
    "amplifier_gain": 100.0,
    "input_voltage_v": 0.5,
    "bridge_correction_factor": 0.999,
    "lockin_sign": 1.0,
    "axis_family": "001",
    "copper_thermal_expansion": "calculators/strain_raw_v1/assets/cu_thermal_expansion.csv"
  },
  "uploaded_at": ""
}
```

### data/metadata.json

```json
{
  "display_name": "250709_NiS2_strain_001_10K",
  "calculator": "strain_raw_v1",
  "kind": "strain",
  "rawdata_id": "000012",
  "created_at": "2026-04-21T18:05:53",
  "default_x": "field_t",
  "default_y": "strain_offset_um_per_m",
  "conditions": {
    "fixed": { "temperature": "10K" },
    "sweep": ["field"]
  }
}
```

### analysis/metadata.json

```json
{
  "display_name": "nis2_001_111_field_dependence_summary",
  "created_at": "2026-04-22",
  "source_data": [
    "../../data/000037/000037.csv",
    "../../data/000004/000004.csv"
  ]
}
```

### calculators/calculator.json

```json
{
  "display_name": "Raw Strain Bridge Conversion",
  "description": "...",
  "transform_type": "column",
  "output_columns": ["field_t", "temperature_k", "strain_offset_um_per_m", "..."],
  "required_columns_detail": [ { "all_of": ["Lockin_data_1", "PPMS_temp_K", "Mag_field_Oe"] } ],
  "required_parameters_detail": [
    { "name": "gauge_factor", "fallback": ["rawdata"] },
    { "name": "mass_mg",      "fallback": ["sample"] }
  ],
  "data_metadata_policy": { "..." : "..." },
  "ui_options": []
}
```

calculator の `id` はフォルダ名が SoT のため `calculator.json` には含まれない。

---

## ID ポリシー

`samples` / `exp` / `rawdata` / `data` / `analysis` は **フォルダ名 = ID**（6桁ゼロ埋め整数）。

- `id` は metadata.json には記載しない（フォルダ名が正本）
- 人間向けの名前は `metadata.json` の `display_name` に置く
- GUI では `display_name` を主表示、`id` を副表示（例: `Sample A · 000001`）
- `calculators/` は semantic 名（例: `magnetization_v1`）を使う唯一の例外

---

## GUI の起動

```bash
python3 -m apps.gui.server --db-root "/path/to/okadaharuto-DB"
```

ブラウザが自動で開きます。`--no-open` で抑制できます。

| オプション | デフォルト | 説明 |
|---|---|---|
| `--db-root` | `.` | DB ルートディレクトリ |
| `--host` | `127.0.0.1` | バインドホスト |
| `--port` | `8765` | バインドポート |
| `--no-open` | — | ブラウザ自動起動を抑制 |

---

## パイプライン（rawdata → data）

```bash
python3 pipeline/rawdata_to_data.py <rawdata_source_path> --db-root "/path/to/okadaharuto-DB"
```

| オプション | デフォルト | 説明 |
|---|---|---|
| `--db-root` | `.` | DB ルートディレクトリ |
| `--name` | source 名から自動決定 | 出力フォルダ/ファイル名 |
| `--overwrite` | — | 既存出力を上書き |

計算ロジックは `<db_root>/calculators/` 以下の Python モジュールとして DB 側に置かれています。
パイプラインは rawdata・sample・material のメタデータを解決して計算器に渡し、結果 CSV と metadata.json を `data/` に出力します。

---

## Docs

各領域の詳細な運用方針は `docs/` を参照してください。

| ファイル | 内容 |
|---|---|
| `docs/README_db.md` | DB 全体構成・命名規則 |
| `docs/README_samples.md` | samples 運用 |
| `docs/README_exp.md` | exp (session) 運用 |
| `docs/README_rawdata.md` | rawdata 運用 |
| `docs/README_data.md` | data (変換済みデータ) 運用 |
| `docs/README_analysis.md` | analysis 運用 |
| `docs/README_calculators.md` | calculator プラグイン仕様 |
