# exp

`exp/` は experiment / session record の置き場です。

- 各 record は `exp/<session_id>/` の 1 directory で管理します（`session_id` は `000001` のような 6桁ゼロ埋め数値）
- session の metadata は `metadata.json` に保存します
- `session_id` は folder 名を SoT とし、`metadata.json` に重複保存しません
- human readable な表示名は `display_name` に持たせます
- 共通 parameter が複数 rawdata に共有される場合は、`exp` metadata を fallback として使います

## GUI / pipeline 互換メモ

`exp/` metadata は Experiments ページの表示元であると同時に、calculator の session parameter source です。

典型例:

- `strain_calculation`
- `start_date`
- `end_date`
- `display_name`

正確な仕様が必要な場合は次を読むこと。

- `~/workspace/lab-app/pipeline/datagen/core.py`
- `~/workspace/lab-app/apps/gui/catalog.py`

この directory 配下の実レコードは git 追跡対象外です。  
この `README.md` だけを運用方針として追跡します。
