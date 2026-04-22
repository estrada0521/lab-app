# DB

`DB/` は実験データの database root です。

> **DB の操作・管理は `~/workspace/lab-app` repo から行うことを前提にしています。**
> DB 側のファイルを直接編集するのではなく、lab-app の GUI・pipeline を通じて管理します。

- 実データや運用上の record を置く場合でも、git では追跡しません
- git で追跡するのは schema や運用方針を説明する文書だけです

## ID 規則

DB 内の各エンティティ（rawdata / samples / data / exp / analysis）は、すべて次の規則に従います。

- フォルダ名が SoT の ID（`000001`, `000002`, … のような 6桁ゼロ埋め数値）
- human readable な名前は `metadata.json` の `display_name` フィールドに保存
- `id` は `metadata.json` に重複保存しない（フォルダエンティティ原則）
- `calculators/` は例外。セマンティックな名前（`magnetization_v1` など）を使うパッケージ扱い

この directory 配下の実体は git 追跡対象外です。  
この `README.md` だけを追跡します。
