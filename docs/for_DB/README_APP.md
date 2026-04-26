# Lab Project: Data & Application

このリポジトリは、科学データを管理するデータベース（`okadaharuto-DB/`）であり、外部アプリケーションである `lab-app` と密結合して動作します。

## 1. データベースとコードの役割分担

本プロジェクトは、**「データ（資産）」**と**「コード（操作）」**を厳密に分離しています。

- **Database (`okadaharuto-DB/`)**:
    - 本リポジトリ。生データ、物理データ、およびそれらの関係性を記述するメタデータを保持します。
    - IDベースのディレクトリ構造を持ち、定数や変換ロジック、解析プロジェクトを包含します。
- **Application (`lab-app`)**:
    - 場所: `/Users/okadaharuto/workspace/lab-app`
    - 役割: データベースを走査して GUI を提供し、パイプラインを実行してデータを生成します。
    - ID間の依存関係を自動で解決（Resolving）し、物理量計算やプロットを動的に行います。

## 2. アプリケーションの起動

`lab-app` を用いて、このデータベースを操作する例：

```bash
cd /Users/okadaharuto/workspace/lab-app
# GUIサーバーの起動（db-root にこのリポジトリのパスを指定）
python3 -m apps.gui --db-root "/Users/okadaharuto/Library/CloudStorage/GoogleDrive-ryutan521@gmail.com/マイドライブ/Lab/okadaharuto-DB"
```

## 3. 開発・運用ルール

- **SoT (Source of Truth) の遵守**: データの修正は原則として上流のメタデータ（`samples/` や `DB/materials/`）で行ってください。詳細は [STRUCTURE.md](./STRUCTURE.md) を参照してください。
- **解析プロジェクト**: `analysis/` 下の各プロジェクトは [解析運用ルール](./okadaharuto-DB/analysis/README_ANALYSIS.md) に従って構成してください。
- **規約の維持**: `lab-app` がデータを正しく処理できるよう、[STRUCTURE.md](./STRUCTURE.md) に記載されたディレクトリ規約とメタデータ形式を守ってください。

## 4. ドキュメント一覧

- [STRUCTURE.md](./STRUCTURE.md): 内部ディレクトリ構造、ID参照フロー、およびメタデータ規約（詳細版）
- [okadaharuto-DB/analysis/README_ANALYSIS.md](./okadaharuto-DB/analysis/README_ANALYSIS.md): 解析スクリプトの記述ルール
