# 解析プロジェクト運用ルール (README_ANALYSIS.md)

このディレクトリ（`okadaharuto-DB/analysis/`）は、物理量に変換されたデータを用いて、科学的な議論や図表作成を行うための「Layer 4: 解析・解釈」層です。

## 0. 解析の基本構造

各解析プロジェクトは `data/` 層のデータを入力として成立します。

```
analysis/<analysis_id>/
├── metadata.json   # source_data に使用する data_id を列挙する
└── plot.py         # metadata.json を読み込んでデータを取得し、プロット・解析を行う
```

### 必須の契約（これだけは守ること）

1. **`metadata.json` の `source_data` が正とする**: 解析で使用する data_id はすべてここに記載する
2. **`plot.py` は `metadata.json` 経由でのみデータを知る**: data_id や CSV パスを `plot.py` 内にハードコードしない

### data_id とは

`data_id` は `data/` 以下のフォルダ名です（例: `"000012"`）。各 data_id の実体は `data/<data_id>/metadata.json` と `data/<data_id>/<data_id>.csv` です。`data/<data_id>/metadata.json` には `rawdata_id`・`calculator`・`display_name` などが記載されており、**そのデータが何を測定したものかはここを読めばわかります**。解析を一から作成する際は、まず `data/` 以下を確認して適切な data_id を特定してください。

### metadata.json の構成（固定）

```json
{
  "display_name": "解析の内容を示す名前",
  "created_at": "YYYY-MM-DD",
  "source_data": [
    "000012",
    "000015"
  ]
}
```

このキー以外は追加しないでください。解析の補足情報は `README.md` か `plot.py` 内のコメントに記載してください。

### GUI との関係

GUI の「New Analysis」ページを使うと、人間がデータ選択・レイアウト設定を行い `metadata.json` と `plot.py` の雛形が生成されます。

---

## 1. 出力

- **`output.png`**: 必須。GUI に表示される解析結果の図。スクリプトを実行するだけで常に同一の画像が再生成されること。
- **`plotted_data.csv`** (任意): プロットに使用した加工済み数値データ。

## 2. plot.py の推奨記述スタイル（人間が後から編集しやすくするために）

- 全ての関数に役割・引数・戻り値を**日本語**で記述した docstring を付与する
- 配色・軸範囲・凡例などのプロット設定は、1項目ごとに改行して記述する
- マジックナンバーにはコメントで意図を補足する

---
詳細はルート直下の [STRUCTURE.md](../../STRUCTURE.md) を参照してください。
