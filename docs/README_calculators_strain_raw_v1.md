# Raw Strain Bridge Conversion

## 概要

`strain_raw_v1` は、lock-in bridge の rawdata を読み、raw strain を 1 本の `data` CSV に変換する calculator です。

この calculator は mode を明示的に選んで使います。

- `field_dependance`
- `temperature_dependance`

自動で sweep 種別を判定する calculator ではありません。

計算の中心は、lock-in 出力から bridge 比を作り、gauge factor と copper thermal expansion 補正を通して raw strain を出すことです。

## どんなデータを読むか

入力 CSV には次の列が必要です。

- `Lockin_data_1`
- `PPMS_temp_K`
- `Mag_field_Oe`

各 row では、計算に必要な値が数値として読めた行だけを使います。

- `field_dependance` では x 軸として `Mag_field_Oe` を使います
- `temperature_dependance` では x 軸として `PPMS_temp_K` を使います

ただしどちらの mode でも、温度補正と補助列のために温度列と磁場列の両方を参照します。

## どんなパラメータを要求するか

この calculator は rawdata metadata の `strain_calculation` から次を要求します。

- `gauge_factor`
- `amplifier_gain`
- `input_voltage_v`
- `bridge_correction_factor`
- `lockin_sign`
- `axis_family`
- `copper_thermal_expansion`

`axis_family` は数値計算そのものには入りませんが、結果の文脈情報として保持されます。

`copper_thermal_expansion` が省略された場合は、calculator package 内の既定 table

```text
calculators/strain_raw_v1/assets/cu_thermal_expansion.csv
```

を使います。

## どんな計算をするか

各 row について、まず lock-in 出力 `L` に符号補正を入れます。

```text
L_corr = lockin_sign * L
```

次に bridge ratio を

```text
R_bridge = (1 - 2 * L_corr / (A * Vin)) / (1 + 2 * L_corr / (A * Vin))
```

で計算します。

- `A` = `amplifier_gain`
- `Vin` = `input_voltage_v`

温度 `T` では copper thermal expansion table から `alpha_cu(T)` を補間し、bridge correction を含めた補正後 ratio を

```text
R_corr = (1 + K * alpha_cu(T)) * R_bridge * C
```

とします。

- `K` = `gauge_factor`
- `C` = `bridge_correction_factor`

最終的な raw strain は

```text
strain_raw_mm_per_m = (1e3 / K) * (R_corr - 1)
```

です。

## mode ごとの出力

### `temperature_dependance`

この mode では x 軸は温度です。主出力はそのまま

```text
y = strain_raw_mm_per_m
```

です。

主な出力列は次です。

- `temperature_k`
- `strain_raw_mm_per_m`
- `field_t`
- `copper_thermal_expansion_fraction`

### `field_dependance`

この mode では x 軸は磁場で、まず

```text
field_t = 1e-4 * Mag_field_Oe
```

に変換します。

そのうえで、`field_t` が 0 に最も近い row の raw strain を基準値 `strain0_um_per_m` とし、主出力を

```text
strain_offset_um_per_m = 1000 * strain_raw_mm_per_m - strain0_um_per_m
```

とします。

つまり `field_dependance` の主 y 列は `strain_offset_um_per_m` です。raw strain 自体も `strain_raw_mm_per_m` として併記されます。

主な出力列は次です。

- `field_t`
- `strain_offset_um_per_m`
- `strain_raw_mm_per_m`
- `ppms_temperature_k`
- `copper_thermal_expansion_fraction`
