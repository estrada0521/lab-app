# rawdata

`rawdata/` は生データ record の置き場です。

- 各 record は `rawdata/<rawdata_id>/` の 1 directory で管理します（`rawdata_id` は `000001` のような 6桁ゼロ埋め数値）
- directory 配下には payload file と `metadata.json` を置きます
- `rawdata_id` は folder 名を SoT とし、`metadata.json` には保存しません
- human readable な名前は `metadata.json` の `display_name` に持たせます
- payload file 名は装置出力名のまま保持して構いません

## GUI / pipeline 互換メモ

GUI と pipeline が metadata 解決を始める起点は `rawdata/<rawdata_id>/metadata.json` です。

少なくとも次を入れてください。

- `sample_id`（`samples/000001/` のような 6桁 ID を参照）
- `session_id`（`exp/000001/` のような 6桁 ID を参照）
- `kind`
- `display_name`

calculator が必要とする測定固有 parameter は、必要なら rawdata metadata に直接持たせます。
parameter 解決は rawdata / sample / material を前提とし、exp metadata を calculator parameter source にはしません。

calculator parameter は次の block にまとめます。

```json
{
  "calc": {
    "id": "strain_raw_v1",
    "params": {},
    "overrides": {}
  }
}
```

- `calc.id`: この rawdata に対して既定で想定する calculator
- `calc.params`: rawdata-local な calculator input
- `calc.overrides`: sample / material の canonical value を測定単位で明示上書きしたいときだけ使う場所

`material_id` は任意項目です（`sample.metadata.json` から辿れる場合は省略可）。

GUI 上の既定軸を与えたい場合は次も使えます。

- `default_x`
- `default_y`

正確な仕様が必要な場合は次を読むこと。

- `~/workspace/lab-app/pipeline/datagen/core.py`
- `~/workspace/lab-app/apps/gui/server.py`

この directory 配下の実データは git 追跡対象外です。  
この `README.md` だけを運用方針として追跡します。
