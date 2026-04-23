# analysis/

`analysis/` は `data/` を入力にした解析・可視化 task の置き場です。

この repo では、`analysis/<id>/metadata.json` の `source_data` を **data_id の配列** として扱います。  
旧 path 形式は使いません。

## 役割

- `rawdata`
  - 測定装置が出した元データ
- `data`
  - calculator により `rawdata` から生成された再利用用データ
- `analysis`
  - `data` を入力にした集約、可視化、補助解析

## ID 規則

- `analysis/<project_id>/` の folder 名が SoT
- `project_id` は 6 桁ゼロ埋め数値
- 人間向け表示名は `metadata.json` の `display_name`

例:

```text
analysis/
├── README.md
├── 000001/
│   ├── metadata.json
│   ├── plot.py
│   ├── summary.png
│   └── plotted_data.csv
└── 000002/
    ├── metadata.json
    ├── plot.py
    └── figure.png
```

## metadata

最小構成:

```json
{
  "created_at": "2026-04-22",
  "display_name": "nis2_001_111_field_dependence_summary",
  "source_data": ["000037", "000036"]
}
```

ルール:

- `source_data` は `data_id` の配列
- `source_data` に `data/000037/000037.csv` のような path を書かない
- `metadata.json` に `id` を重複保存しない
- GUI が参照する入力データは `source_data` だけ

## source_data の意味

`source_data` は `data_id` の配列です。

```json
{
  "source_data": ["000037", "000036", "000043"]
}
```

各要素は次を意味します。

```text
"000037" -> data/000037/000037.csv
```

この変換は code 側で一意に決まります。  
analysis metadata に path を持たせません。

## plot.py

`plot.py` は task directory に置きます。

ルール:

- `data` 入力は `data_id` ベースで扱う
- DB 内 `data` の path を直書きしない
- `source_data` の SoT を path にしない
- local な補助ファイルが必要なら task directory 内に置く

典型的には、script 内で

```text
data_id -> <DB>/data/<data_id>/<data_id>.csv
```

を解決して読みます。

## GUI

GUI の Analysis ページは:

- `metadata.json` の `display_name`
- `created_at`
- `source_data` の `data_id`

を読み、`data` / `rawdata` への Links を組み立てます。

したがって、GUI 互換を保つには:

- `metadata.json` が存在する
- `display_name` がある
- `created_at` がある
- `source_data` が `data_id` 配列になっている

ことが必要です。

## 運用方針

- `data/` と `rawdata/` は read-only に扱う
- 派生生成物は `analysis/<id>/` に閉じる
- 解析対象の切り替えは path 変更ではなく `source_data` の `data_id` 更新で行う
- SoT は
  - analysis input: `metadata.json["source_data"]`
  - analysis identity: folder 名
  - analysis display: `metadata.json["display_name"]`

