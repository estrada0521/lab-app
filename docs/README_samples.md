# samples

`samples/` は sample record の置き場です。

- 各 sample は `samples/<sample_id>/` の 1 directory で管理します
- sample の metadata は `metadata.json` に保存します
- `sample_id` は folder 名を SoT とし、`metadata.json` に重複保存しません
- human readable な表示名は `display_name` に持たせます

## GUI / pipeline 互換メモ

`samples/` は GUI 表示用の補助情報ではなく、calculator が参照する parameter source の 1 つです。

よく使われる項目:

- `material_id`
- `orientation`
- `mass_mg`
- `owner`

正確な仕様が必要な場合は次を読むこと。

- `~/workspace/lab-app/pipeline/datagen/core.py`
- `~/workspace/lab-app/apps/gui/catalog.py`

この directory 配下の実レコードは git 追跡対象外です。  
この `README.md` だけを運用方針として追跡します。
