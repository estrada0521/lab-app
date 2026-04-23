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
│   └── 000002/
│       └── metadata.json
│
├── exp/
│   ├── 000001/
│   │   └── metadata.json
│   └── 000002/
│       └── metadata.json
│
├── rawdata/
│   ├── 000001/
│   │   ├── <装置出力ファイル>             # ファイル名はそのまま保持
│   │   └── metadata.json
│   └── 000002/
│       ├── <装置出力ファイル>
│       └── metadata.json
│
├── data/
│   ├── 000001/
│   │   ├── 000001.csv                    # 変換済みデータ
│   │   └── metadata.json
│   └── 000002/
│       ├── 000002.csv
│       └── metadata.json
│
├── analysis/
│   ├── 000001/
│   │   ├── plot.py
│   │   ├── figure.png
│   │   └── metadata.json
│   └── 000002/
│       ├── plot.py
│       └── metadata.json
│
└── calculators/
    ├── magnetization_v1/
    │   ├── calculator.py
    │   ├── calculator.json
    │   └── README.md
    └── strain_raw_v1/
        ├── calculator.py
        ├── calculator.json
        └── README.md
```

### samples/metadata.json

```json
{
  "display_name": "Sample A",
  "material_id": "NiS2",
  "orientation": "[001]",
  "mass_mg": 1.23,
  "owner": "okadaharuto"
}
```

### exp/metadata.json

```json
{
  "display_name": "240501_NiS2_PPMS",
  "start_date": "2024-05-01",
  "end_date": "2024-05-03"
}
```

### rawdata/metadata.json

```json
{
  "display_name": "NiS2 #1 mag FC",
  "sample_id": "000001",
  "session_id": "000001",
  "measurement_type": "magnetization"
}
```

calculator 固有のパラメータ（例: `field_direction`, `applied_field_Oe`）も rawdata metadata に置く。
`material_id` は sample 経由で辿れる場合は省略可。

### data/metadata.json

```json
{
  "rawdata_id": "000001",
  "calculator": "magnetization_v1",
  "created_at": "2024-05-10",
  "source": "rawdata/000001/<ファイル名>",
  "outputs": { "csv": "000001.csv" },
  "bindings": {
    "moment_col": "Moment (emu)",
    "field_col": "Field (Oe)",
    "mass_mg": 1.23
  },
  "summary": { "rows": 512, "measurement_type": "magnetization" },
  "default_x": "field_Oe",
  "default_y": "moment_per_mass"
}
```

### analysis/metadata.json

```json
{
  "display_name": "NiS2 field dependence summary",
  "source_data": ["../data/000001/000001.csv"],
  "created_at": "2024-05-15",
  "updated_at": "2024-05-15",
  "description": "FC/ZFC 比較",
  "analysis_script": "plot.py",
  "outputs": ["figure.png"]
}
```

### calculators/calculator.json

```json
{
  "id": "magnetization_v1",
  "display_name": "Magnetization v1",
  "measurement_type": "magnetization",
  "description": "磁化測定データを emu/g 単位に変換する",
  "handler": "calculator.py",
  "readme": "README.md"
}
```

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
