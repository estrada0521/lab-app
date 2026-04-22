# analysis/ 運用ガイド

`analysis/` ディレクトリは、実験データの高度な解析と可視化のための作業領域です。

目的は単に図を描くことではなく、元データから解析結果、最終的な図に至るまでの経路を、明確かつ再現可能で、あとから編集できる形で保つことにあります。

> **このディレクトリは `~/workspace/lab-app` repo から操作することを前提にしています。**
> DB 側のファイルを直接編集するのではなく、lab-app の GUI・pipeline・スクリプトを通じて管理します。

---

## 1. ディレクトリの役割

`analysis/` は、解析と可視化のための workspace です。

基となる `data` は DB 内の `data/` ディレクトリにあります。

```txt
<DB>/data/
```

`analysis/` は `data/` を参照してよいですが、それを使い捨ての作業ファイル置き場として扱ってはいけません。

想定している流れは次の通りです。

```txt
rawdata
  -> 測定装置が出した元データ

data
  -> calculator により rawdata から生成された再利用可能データ

analysis
  -> 高度な解析、変換、フィッティング、集約、可視化
```

---

## 2. ソースデータの保全

次のディレクトリが公式な source of truth です。

```txt
<DB>/data/
<DB>/rawdata/
```

ルール:

- source data は原則として read-only として扱う
- `analysis/` から source data を上書き、改名、移動、削除、整理、変更しない
- 派生データ、処理途中のデータ、図、その他の中間生成物は analysis task のディレクトリ内に保存する
- source data 自体を変更する必要がある場合、それは通常の plotting / analysis script の責務ではなく、pipeline 側の workflow で扱う

---

## 3. task 単位の構成・ID 規則

各 analysis task は `analysis/<project_id>/` の独立したディレクトリとして完結しているべきです。

**ID 規則:**

- `project_id` はフォルダ名であり、6桁ゼロ埋め数値（`000001`, `000002`, …）を使います
- `project_id` が SoT です。`metadata.json` に `id` フィールドを重複保存しません
- human readable な表示名は `metadata.json` の `display_name` に持たせます

例:

```txt
analysis/
├── README.md
├── 000001/
│   ├── metadata.json        <- display_name: "nis2_001_111_field_dependence_summary"
│   ├── plot.py
│   ├── figure.png
│   └── plotted_data.csv
└── 000002/
    ├── metadata.json        <- display_name: "nis2_mt_and_strain_T_dep"
    ├── plot.py
    └── figure.png
```

ルール:

- script、生成画像、metadata、中間生成物は task directory の中にまとめる
- 出力を DB root に散らさない
- 各 task directory には `metadata.json` を必ず置く
- `display_name` は後から自由に変えられる。`project_id`（フォルダ名）は変えない

---

## 4. metadata を唯一の参照元にする

各 task において、source data の参照先は `metadata.json` を唯一の参照元にします。

最も重要なルールは次です。

```txt
source_data は metadata.json にだけ書く。
plot.py に source data の path を直書きしない。
```

こうしておくと、`metadata.json` と plotting script が別々の source data を指してしまう事故を避けられます。

ルール:

- source file path は `metadata.json` にのみ書く
- source file path を plotting script に重複記載しない
- plotting script は `metadata.json` から `source_data` を読む
- source data を変えるときは `plot.py` ではなく `metadata.json` を更新する
- plotting script は metadata に書かれた path を解決・検証・読み込みしてよいが、自分で source file list を定義してはいけない

図は次の 3 つから再現できるべきです。

```txt
1. metadata.json
2. analysis script
3. 不変な source data
```

---

## 5. 必須 metadata 項目

各 task directory は最低限、次のような `metadata.json` を持つべきです。

```json
{
  "source_data": [],
  "display_name": "",
  "created_at": "YYYY-MM-DD",
  "updated_at": "YYYY-MM-DD",
  "description": ""
}
```

GUI 互換を強く意識するなら、実務上は次も必須扱いにしてください。

- `display_name`
- `analysis_script`
- `outputs`

推奨する拡張形:

```json
{
  "display_name": "解析タスクの人間向け名前",
  "source_data": [
    "../data/000001/000001.csv"
  ],
  "created_at": "2026-04-22",
  "updated_at": "2026-04-22",
  "description": "解析内容の簡潔な要約",

  "analysis_script": "plot.py",
  "outputs": [
    "figure.png",
    "figure.pdf"
  ],
  "plotted_data": "plotted_data.csv",

  "analysis_parameters": {
    "x_col": "x",
    "y_col": "y",
    "group_col": null,
    "drop_na": true,
    "sort_by_x": true,
    "normalize_y": false,
    "baseline_correction": false,
    "smoothing": false
  },

  "plot_parameters": {
    "output_basename": "figure",
    "x_label": "x / unit",
    "y_label": "y / unit",
    "figsize": [3.5, 2.6],
    "dpi": 300
  },

  "tags": [],
  "notes": ""
}
```

---

## 6. plotting script の基本構造

plotting script は、metadata-driven な thin executor であるべきです。

どの source file を使うかを script 自身が勝手に決めるべきではありません。`metadata.json` を読み、宣言された source data を読み込み、明示的な解析を行い、図を描き、出力を保存する構造にします。

推奨する関数順:

```txt
load_metadata()
validate_metadata()
resolve_source_paths()
load_data()
validate_data()
prepare_plot_data()
plot_data()
save_outputs()
main()
```

推奨する script の並び:

```txt
1. imports
2. 固定 path 設定
3. 既定の可視化・解析設定
4. metadata 読み込み
5. metadata 検証
6. source_data path 解決
7. data 読み込み
8. data 検証
9. 解析 / 変換 / 前処理
10. plotting
11. 出力保存
12. main
```

上から下に実行順で追える構造にしてください。

---

## 6.5. GUI 互換のための最低条件

Analysis ページに出ることを期待する task は、少なくとも次を満たしてください。

- `analysis/<project_id>/metadata.json` が存在する（`project_id` は6桁数値）
- `display_name` が `metadata.json` にある
- `source_data` が `metadata.json` にある
- `analysis_script` が task directory 内の実在 file を指す
- `outputs` は task directory 内の生成物を列挙する
- script 側に source path を直書きしない

正確な一覧化・詳細表示の仕様が必要な場合は次を読むこと。

- `~/workspace/lab-app/apps/gui/catalog.py`
- `~/workspace/lab-app/apps/gui/server.py`

---

## 7. 責務の分離

次の段階は概念的に分けて扱います。

```txt
source_data
analysis_data
plot_data
figure
metadata
```

意味:

- `source_data`: `../src/data/` から読む元データ
- `analysis_data`: fit、補正、集約、抽出などを行った後のデータ
- `plot_data`: 実際に plot に使う x / y / error / label 値
- `figure`: 生成した画像出力
- `metadata`: 何をどう使って生成したかの記録

科学的な変換を plot 呼び出しの中に埋め込まないでください。

良い例:

```python
# y値を最大値で正規化するか
if normalize_y:
    df_plot["y_normalized"] = df_plot[y_col] / df_plot[y_col].max()
    y_plot_col = "y_normalized"
```

悪い例:

```python
ax.plot(df[x_col], df[y_col] / df[y_col].max())
```

前者は変換が明示されています。後者は科学的な変換が描画呼び出しの中に隠れています。

---
