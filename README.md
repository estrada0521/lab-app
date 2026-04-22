# Lab App

このリポジトリは、Lab database を閲覧・整理・変換するための code repo です。
実データは含めず、起動時に `--db-root` で対象 database root を指定して使います。

## Repo Layout

```text
lab-app/
├── apps/       # GUI
├── pipeline/   # rawdata -> data generation
├── docs/       # DB 各領域の運用 README
└── README.md
```

対象 DB は別管理です。

```text
<db_root>/
├── calculators/
├── DB/
├── samples/
├── exp/
├── rawdata/
├── data/
└── analysis/
```

## ID Policy

`rawdata`, `data`, `samples`, `exp`, `analysis` は、folder 名を stable `id` として扱います。
人間向けの名前は metadata の `display_name` に置き、GUI では `display_name` を主表示、`id` を副表示にします。

この repo の実装は、entity 名そのものではなく `id` を正本として扱う前提です。

## What This Repo Does

- `apps/gui`: database を横断して閲覧する GUI
- `pipeline/datagen`: rawdata から data を生成する基盤
- `docs/README_*.md`: DB 側で参照する運用文書

GUI では `rawdata`, `data`, `samples`, `exp`, `analysis`, `calculators` を相互リンク付きで扱います。
`data` 生成時には rawdata, sample, session, material metadata を解決し、生成条件を output metadata に残します。

## Run

```bash
python3 -m apps.gui --db-root /path/to/database
```

現在の運用では code repo と DB root は分離されています。calculator 実装や metadata 解決ロジックを変更する場合はこの repo を編集し、実データや record metadata は DB 側で管理します。

## Docs

詳細な運用方針は `docs/` を参照してください。

- `docs/README_db.md`
- `docs/README_rawdata.md`
- `docs/README_data.md`
- `docs/README_samples.md`
- `docs/README_exp.md`
- `docs/README_analysis.md`
- `docs/README_calculators.md`
