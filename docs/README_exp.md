# exp

`exp/` は experiment record の置き場です。

- 各 record は `exp/<exp_id>/` の 1 directory で管理します（`exp_id` は `000001` のような 6桁ゼロ埋め数値）
- experiment metadata は `metadata.json` に保存します
- `exp_id` は folder 名を SoT とし、`metadata.json` に重複保存しません
- human readable な表示名は `display_name` に持たせます

## GUI / pipeline 互換メモ

`exp/` metadata は主に Experiments ページの表示元です。

典型例:

- `start_date`
- `end_date`
- `display_name`

正確な仕様が必要な場合は次を読むこと。

- `~/workspace/lab-app/pipeline/datagen/core.py`
- `~/workspace/lab-app/apps/gui/catalog.py`

この directory 配下の実レコードは git 追跡対象外です。  
この `README.md` だけを運用方針として追跡します。
