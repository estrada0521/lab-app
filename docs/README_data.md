# data

`data/` は calculator により生成された data record の置き場です。

- 各 data は `data/<data_id>/` の 1 directory で管理します
- 生成物の本体は通常 `csv` と `metadata.json` です
- `data_id` は folder 名を SoT とします
- `metadata.json` には self id ではなく、`rawdata_id` や `calculator` などの参照情報を保存します

## GUI / pipeline 互換メモ

`data` は単独で完結する record ではなく、通常は `rawdata_id` を通じて生成元 rawdata に接続されます。

現行 schema では、少なくとも次を残すことを前提にしてください。

- `rawdata_id`
- `calculator`

実務上は次も残してください。

- `bindings`
- `measurement_kind`
- `outputs`
- `created_at`

正確な仕様が必要な場合は次を読むこと。

- `~/workspace/lab-app/pipeline/datagen/core.py`
- `~/workspace/lab-app/apps/gui/catalog.py`

この directory 配下の生成データは git 追跡対象外です。  
この `README.md` だけを運用方針として追跡します。
