# Lab Data Management

このリポジトリは、実験データベースを整理・確認・変換するための GUI / pipeline です。
アプリ本体はデータベースの外に置き、起動時に対象となる database root を指定して使うことを前提とします。

## 現在の構成

コード側:

```text
lab-app/
├── apps/           # GUI アプリ
├── pipeline/       # rawdata -> data の変換基盤
└── README.md
```

対象 database root:

```text
<db_root>/
├── calculators/    # data 生成用 calculator 定義
├── DB/             # 物質定数
├── samples/        # サンプル metadata
├── exp/            # 実験セッション metadata / docs
├── rawdata/        # 測定生データ
├── data/           # 生成済みデータ
└── analysis/       # 解析プロジェクト
```

git で追跡するのは主に `apps/`, `pipeline/`, `README.md` 群です。  
database root 配下の実データは git ではなく storage 側で保護する前提です。

## 基本構造

```text
samples ─┐
exp     ─┼─ metadata / parameter sources
DB      ─┘
             ↓
rawdata ── Workspace / plot / inspection
             ↓
calculators ─ data generation
             ↓
data ── reusable physical dataset
  └── analysis から参照
```

この構成では、単一のファイルだけを唯一の SoT として扱うのではなく、役割ごとに SoT を分けています。

- `rawdata`: 測定装置が出した元データ
- `samples`: 試料固有情報
- `exp`: 実験セッション固有情報
- `DB/materials`: 物質定数
- `calculators`: 変換ロジック

`data` はこれらを参照して生成される再利用用データで、生成時点の計算条件を metadata に保持します。

この分離によって、測定そのもの、試料情報、実験条件、物質定数、計算手順を別々に保守できます。
ある層を更新しても、どの情報がどこで管理されているかが明確で、変更の影響範囲を追いやすい構成です。

## ディレクトリごとの役割

### `rawdata/`

測定装置から出た元ファイルの置き場です。Workspace ではここを直接開きます。

典型例:

```text
rawdata/<record_id>/
├── <record_id>.csv or .dat
└── metadata.json
```

`metadata.json` では主に次の値を使います。

- `material_id`
- `sample_id`
- `session_id`
- `measurement_type`
- `default_x`
- `default_y`
- `memo`

これらを使って GUI 上の初期軸、関連 sample / experiment / material の参照、右ペインの info 表示を組み立てます。

rawdata は測定機器由来の値を保持する層であり、後段の変換や可視化の出発点になります。

### `data/`

`rawdata` から calculator を通して生成した物理量データです。

```text
data/<data_id>/
├── <data_id>.csv
└── metadata.json
```

`metadata.json` には生成元や calculator 情報を持たせます。

- `source.rawdata_csv`
- `source.rawdata_json`
- `calculator`
- `bindings`
- `memo`

`data` は Workspace から直接開けるほか、Samples / Experiments / Analysis の関連リンクからも参照されます。

この層があることで、rawdata を毎回直接読み直さなくても、物理量に変換済みのデータを安定した単位で再利用できます。
また、生成時の calculator と binding 情報が残るため、後から見ても「どの変換を通った data か」が分かります。

### `samples/`

サンプル単位の静的情報です。

```text
samples/<sample_id>/
├── metadata.json
└── images/
    └── main.*
```

代表的な項目は `material_id`, `orientation`, `mass_mg`, `owner`, `memo` です。
GUI では info, memo, 関連 rawdata / data / experiments を表示します。

sample は測定とは独立した試料情報の SoT であり、同じ sample に紐づく複数の rawdata や data を横断して扱う基点になります。

### `exp/`

実験セッション単位の情報です。

```text
exp/<session_id>/
├── metadata.json
└── docs/
    └── main.md
```

`metadata.json` には `sample_id`, `material_id`, `measurement_type`, `memo` などを置き、
`docs/main.md` は experiments ページ中央で表示します。

experiment はセッション単位の文脈を保持する層で、rawdata や data を単発ファイルではなく実験のまとまりとして見られるようにします。

### `analysis/`

data を束ねた解析プロジェクトです。

```text
analysis/<project_id>/
├── metadata.json
├── *.py / *.ipynb / その他スクリプト
└── 画像や出力ファイル
```

`metadata.json` では主に次を使います。

- `project_name`
- `description`
- `source_data`
- `memo`

`source_data` に並んだ data を GUI からたどれるようになっています。

analysis 層によって、解析成果物とその入力 data の対応を repo 内で保持できます。
画像やスクリプトだけが孤立せず、何を入力にした解析なのかを追跡しやすくなります。

### `calculators/`

`rawdata -> data` の変換定義です。

```text
calculators/<calculator_id>/
├── calculator.py
├── calculator.json
└── README.md
```

- `calculator.py`: 変換実装
- `calculator.json`: calculator の宣言
- `README.md`: 数式、列名、パラメータの説明

calculator は database root 側に属する変換資産です。
同じ GUI / pipeline を別 database に向けたとき、それぞれ異なる calculators を持てます。
GUI 側も database root 内の定義を読み込んで利用可能 calculator や必要パラメータを判断します。

## GUI

起動:

```bash
python3 -m apps.gui --db-root /path/to/database
```

ページ:

- `Workspace`: rawdata / data の閲覧、plot、data 生成
- `Samples`: sample 一覧、info、memo、関連データ
- `Experiments`: experiment 一覧、info、memo、docs
- `Calculators`: calculator 一覧と README 表示
- `Analysis`: 解析プロジェクト一覧、memo、source data 参照

Workspace:

- rawdata / data の一覧表示
- グラフ表示
- 列の preview filter
- calculator 選択
- rawdata から data の生成
- PNG / PDF export

Samples / Experiments / Analysis では、一覧、info、memo、関連リンクを扱います。

この GUI の利点は、rawdata, data, sample, experiment, analysis を別々のフォルダブラウザで扱うのではなく、
相互リンク付きの一つの閲覧系として扱える点にあります。

## この構成でできること

- 元データ、試料情報、実験情報、物質定数、計算ロジックを分離して管理できる
- `data` に生成元と calculator 情報を残せるため、どの入力と計算条件から作られたか追跡しやすい
- sample / experiment / data を GUI 上で相互にたどれるため、個別ファイルを手で探し回らずに確認できる
- `analysis` から複数の `data` を参照できるため、解析成果物とその入力データの対応を残せる
- calculators を一覧化し README まで GUI から見られるため、変換仕様をコードと分離せず確認できる

特に `data` に計算 metadata が付くことで、再計算時の条件確認、比較、引き継ぎがしやすくなります。

これは実験データ管理として重要で、CSV だけが残っていて変換条件が失われる状態を避けやすくします。
再利用する側は data そのものだけでなく、対応する metadata を見ることで生成過程を確認できます。

## Metadata の解決

`pipeline/datagen/core.py` は、`rawdata/<record>/<file>` または `data/<record>/<file>` から
次の情報を解決する前提になっています。

- material: `DB/materials/<material_id>.json`
- sample: `samples/<sample_id>/metadata.json`
- session: `exp/<session_id>/metadata.json`

この解決結果を使って、data 生成時のパラメータ補完や info 表示を行います。

この仕組みにより、sample 質量や session 条件、material 定数のような値を rawdata 側へ重複記入しなくても、
必要時に横断参照して利用できます。
