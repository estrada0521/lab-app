# Data Pipeline

`pipeline/` は `rawdata` から `data` を生成するための変換ロジックを持ちます。

主な構成:

- `datagen/core.py`: source metadata 解決と出力パス管理
- `datagen/registry.py`: calculator の列挙、適用可否判定、実行
- `datagen/gui.py`: GUI から使う公開入口
- `datagen/cli.py`: CLI 入口

CLI 例:

```sh
python3 -B pipeline/rawdata_to_data.py rawdata/<record_id>/<record_id>.csv
```

出力:

```text
data/<name>/<name>.csv
data/<name>/metadata.json
```

`metadata.json` には source, calculator, bindings, summary などが記録されます。
