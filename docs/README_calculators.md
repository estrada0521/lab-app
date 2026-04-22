# Calculator 作成ガイド

この文書は、`calculators/` 配下に置く calculator の役割、責務範囲、実装方針を定義するものです。

この repository で calculator を追加・修正する agent / developer 向けに書かれています。

---

## 1. `calculators/` の役割

calculator は、1 つの `rawdata` を 1 つの `data` に変換する単位です。

想定する流れは次の通りです。

```text
rawdata
  -> 1 つの calculator
  -> 1 つの data
```

calculator は analysis task ではなく、汎用 workflow script でもありません。
測定出力を、安定して再利用できる物理量データへ変換するための再利用可能な変換規約です。

---

## 2. 責務範囲と責務外

calculator の責務:

- 1 本の rawdata file を読む
- source context から必要な metadata を解決する
- source column を選択し、検証する
- source value を output value に変換する
- output CSV を 1 つ書く
- output `metadata.json` を 1 つ書く

calculator の責務外:

- 複数 rawdata の統合
- 平均、fitting、grouping、複数 file 比較
- publication 用 figure の生成
- 自由な試行錯誤としての解析
- source rawdata や source metadata の編集

複数 source file を要する処理、task 固有の集約、figure 作成は `analysis/` の責務です。calculator 側に持ち込まないでください。

---

## 3. calculator directory の標準構成

各 calculator は独立した directory を持ちます。

```text
calculators/<calculator_id>/
├── calculator.py
├── calculator.json
└── README.md
```

必要なら次も持てます。

```text
calculators/<calculator_id>/assets/
```

`assets/` は、lookup table のような、その変換自体に必要な安定した local resource に限定してください。

---

## 4. calculator の契約

registry は `calculators/*/calculator.json` を起点に calculator を読み込みます。

各 calculator package は最低限、次を持つ必要があります。

- `calculator.json`
- `calculator.py`
- `README.md`

現在の handler module は、次の関数を提供している必要があります。

- `inspect_source(context, header, rows, *, source_name=None)`
- `analyze_source(context, header, rows, *, source_name=None)`
- `create_data(context, output_name=None, overwrite=False, retained_source_columns=None, source_header=None, source_rows=None)`

追加の helper function は自由に定義して構いません。

calculator によっては、次のような補助的 entry point を持っていてもよいです。

- `can_handle(context)`
- `summarize_source_data(context, output_name=None)`

ただし、registry が主契約として前提にしているのは上の 3 関数です。

正確な runtime contract が必要な場合は、次を読むこと。

- `~/workspace/lab-app/pipeline/datagen/registry.py`
- `~/workspace/lab-app/pipeline/datagen/core.py`

---

## 5. `calculator.json`

`calculator.json` は calculator の公開宣言です。

最低限、次を定義します。

- `id`
- `title`
- `measurement_type`
- `description`
- `handler`
- `readme`

必要に応じて、次も定義できます。

- `required_columns`
- `required_metadata`
- `required_parameters`
- `dependencies`
- `ui_options`

`calculator.json` は、calculator を外側からどう見せるかを書く場所です。
一覧化、選択、GUI 表示のための宣言であり、`README.md` に書く実装詳細をすべて重複記載する場所ではありません。

---

## 6. source model

各 calculator は `pipeline/datagen/core.py` が作る `FilterContext` を前提に動きます。

実際には、calculator は次の情報を受け取ります。

- `context.source_path`
- `context.repo_root`
- `context.filter_id`
- `context.measurement_type`
- `context.material_id`
- `context.sample_id`
- `context.session_id`
- `context.material_meta`
- `context.sample_meta`
- `context.session_meta`

calculator は、これらの metadata object を parameter source として扱います。

material / sample / session の source of truth 自体は calculator の外にあります。
calculator の役割は、必要な値を解決し、それを決定的に使い、その結果を output metadata に記録することです。

---

## 7. 再現性のルール

出力される `data` は、次から再現できる状態であるべきです。

1. source rawdata file
2. context から辿れる source metadata
3. calculator code
4. calculator local assets
5. 生成された `metadata.json`

このため、次を守ってください。

- parameter value を UI 専用 state にだけ隠さない
- 宣言されていない周辺 file に依存しない
- repository 構造の外にある mutable な ad hoc path に依存しない
- 解決済み parameter を output metadata に残す

output metadata から、どの calculator が走り、どの source column を使い、どの parameter が実際に適用されたかが分かるようにしてください。

---

## 8. calculator 内での責務分離

calculator では、次の 4 点がすぐ見つかる構造にしてください。

1. 何を読むか
2. 何を要求するか
3. どう変換するか
4. 何を書き出すか

これが readability 上の主要求です。

column 検出、metadata 解決、row 変換、file 出力、metadata 出力を、必要もなく 1 つの巨大で不透明な関数に押し込めないでください。

一方で、小さな calculator を過剰抽象化して、意味の薄い薄い wrapper だらけにする必要もありません。

狙うべきなのは最大限の汎用性ではなく、上から下に読めて、短時間で監査できる file です。

---

## 9. `calculator.py` の推奨構成

`analysis/README.md` と同様に、calculator もできるだけ実行順に沿った並びにしてください。

推奨レイアウト:

```text
1. imports
2. 定数、固定の column name candidate
3. 小さな data class
4. 小さな pure helper
5. metadata 解決 helper
6. validation / missing dependency helper
7. mode / measurement kind 判定
8. source inspection / analysis
9. row conversion / dataset preparation
10. output 組み立て
11. metadata 書き出し
12. create_data entry point
```

これは厳密な template ではなく推奨順です。

重要なのは、reader が file 内を不必要に飛び回らずに、実行順で理解できることです。

---

## 10. 各公開関数の役割

### `inspect_source(...)`

この関数は次に答えるべきです。

- この rawdata に対して calculator は利用可能か
- 利用可能でないなら何が不足しているか
- どの source column が必要か
- どの parameter が解決されるか
- GUI に何を summary として出すか

calculator 選択や診断のための構造化 payload を返してください。

この関数は保守的で構いません。
不足要件を黙って無視してはいけません。

### `analyze_source(...)`

source が有効なときに、どのように解釈して変換するかを構造化して返す関数です。

典型的な内容:

- measurement kind
- 選ばれた x / y または source column
- required source columns
- 解決済み parameter
- GUI 用の label や summary

これは、その calculator が source をどう解釈するかの構造化表現です。

### `create_data(...)`

実行本体の entry point です。

やるべきこと:

- source row を読み込む、または受け取る
- `analyze_source` と同じ解釈ロジックを使う
- row を変換する
- output file を書く
- 再現性のための metadata を書く
- compact な result object を返す

`create_data` だけが別の hidden interpretation path を持ち、`inspect_source` や `analyze_source` と食い違う状態は避けてください。

---

## 11. GUI 互換のための最低条件

calculator は「数式として正しい」だけでは不十分です。
GUI / pipeline 互換のためには、少なくとも次を満たしてください。

- `calculators/<calculator_id>/calculator.json` が存在する
- `calculator.json` の `handler` が実在する
- `calculator.py` が `inspect_source`, `analyze_source`, `create_data` を提供する
- `inspect_source(...)` が ready / missing dependency / required source columns を返せる
- `create_data(...)` が `data/<data_id>/...` を書き、再現に必要な metadata を残す

README と code が食い違う場合は、現時点では `lab-app` 側 code を優先してください。

---

## 11. column 解決

column の扱いは明示的であるべきです。

推奨ルール:

- source column candidate は file 上部で定義する
- column 選択は安定した優先順にする
- required column と optional passthrough column を分ける
- 最終的に選ばれた column は output metadata に残す

source format が厳密なら exact column name を要求して構いません。
source format に揺れがあるなら、受け入れる候補を明示してください。

column 名の heuristic を row loop の深い場所に埋め込まないでください。

---

## 12. metadata 解決

metadata 依存も明示的にしてください。

推奨ルール:

- `context.material_meta`, `context.sample_meta`, `context.session_meta` から読む
- fallback logic は 1 箇所の helper に寄せる
- 必要なら user-facing な missing dependency message 用 helper を別に持つ
- output metadata には key 名だけでなく解決済みの値を残す

`strain_calculation` のように session 設定へ依存する calculator では、その依存が code と `README.md` の両方から明確に分かるべきです。

fallback による値解決自体は許容されますが、fallback rule は決定的で、文書化されている必要があります。

---

## 13. 変換ロジック

変換経路は決定的で、監査可能であるべきです。

推奨ルール:

- row 単位の変換式は file 出力から切り離す
- row skip と calculator failure を分ける
- 必須の大域依存が欠けているときは fail する
- row skip は row 局所の numeric 問題だけに限定する
- output unit と output column name は安定させる

典型的な分け方:

- global validation failure:
  - metadata 不足
  - required column 不足
  - lookup table 設定不正
  - measurement kind 判定不能

- row-local skip:
  - 数値セルが空
  - 数値として解釈できない値

すべての row が skip された場合は calculator failure としてください。

---

## 14. 出力ルール

各 calculator は `data/` 配下に次の形で 1 つの出力 directory を作ります。

```text
data/<name>/
├── <name>.csv
└── metadata.json
```

CSV は次を含むべきです。

- 固定された required output column を安定した順で並べる
- optional passthrough source column はその後ろに付ける

metadata には、その CSV がどう生成されたかを理解するのに十分な情報を入れてください。

最低限残すべきもの:

- calculator id
- source rawdata path
- 選ばれた source column
- output column の選択
- 変換に使った解決済み parameter
- row 数や plot default などの summary 情報

---

## 15. result metadata の推奨形

現在の calculator は概ね次の形で metadata を書いています。

- top-level source identifiers
- `source`
- `outputs`
- `bindings`
- `summary`
- `default_x`
- `default_y`

強い理由がない限り、新しい calculator もこの形に揃えてください。

特に:

- `bindings` には解決済みの計算入力を入れる
- `summary` には人間と GUI の両方にとって扱いやすい簡潔な要約を入れる

後段コードが基本情報を再導出しないといけないような曖昧な blob は避けてください。

---

## 16. 各 calculator の個別 README

各 calculator directory には個別の `README.md` も置きます。

そこには calculator 固有の契約を書きます。

- 何の測定を変換する calculator か
- どの source column が必要か
- どの metadata が必要か
- どの数式・規則を使うか
- 何を書き出すか

この文書はそれとは別です。

この file は、この repository で calculator をどう作るかを定義するものです。
個別 calculator の `README.md` は、その calculator 自身が何をするかを定義するものです。

---

## 17. 設計原則

calculator を追加・修正するときは、次を優先してください。

- 1 calculator 1 purpose
- 1 rawdata in, 1 data out
- 決定的な解釈
- 明示的な依存関係
- 安定した output schema
- metadata に支えられた再現性
- 上から下に読める素直な構造

避けるべきもの:

- helper に分散して見えづらくなった hidden behavior
- analysis の責務を吸い込む calculator
- ad hoc な UI state に依存する output format
- inspect と execution で解釈がずれていく重複ロジック

---

## 18. agent 向けチェックリスト

calculator の変更を終える前に、次を確認してください。

- その calculator が依然として単一 file 変換であること
- `calculator.json` が実装と一致していること
- `inspect_source`, `analyze_source`, `create_data` が同じ解釈を共有していること
- required column が明示されていること
- required metadata が明示されていること
- fallback rule が決定的であること
- output CSV の column 順が明示されていること
- output `metadata.json` に解決済み parameter が記録されること
- 個別 `README.md` に、その calculator 固有の数式と I/O 契約が書かれていること

もし必要な機能が複数 source や task 固有集約を要するなら、calculator の責務を広げずに `analysis/` 側へ設計を移してください。
