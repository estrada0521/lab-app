# rawdata

`rawdata/` は生データ record の置き場です。

- 各 record は `rawdata/<rawdata_id>/` の 1 directory で管理します
- directory 配下には payload file と `metadata.json` を置きます
- `rawdata_id` は folder 名を SoT とし、`metadata.json` には保存しません
- human readable な名前は `metadata.json` の `display_name` に持たせます
- payload file 名は装置出力名のまま保持して構いません

## GUI / pipeline 互換メモ

GUI と pipeline が metadata 解決を始める起点は `rawdata/<rawdata_id>/metadata.json` です。

少なくとも次を入れてください。

- `material_id`
- `sample_id`
- `session_id`
- `measurement_type`

GUI 上の既定軸を与えたい場合は次も使えます。

- `default_x`
- `default_y`

正確な仕様が必要な場合は次を読むこと。

- `~/workspace/lab-app/pipeline/datagen/core.py`
- `~/workspace/lab-app/apps/gui/server.py`

この directory 配下の実データは git 追跡対象外です。  
この `README.md` だけを運用方針として追跡します。
