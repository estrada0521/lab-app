# Magnetization Moment Normalization

## 概要

`magnetization_v1` は、MPMS / SQUID 系の磁化 rawdata を読み、試料全体の磁気モーメント `emu` を、指定した磁性元素 1 個あたりの磁化 `mu_B` に正規化して 1 本の `data` CSV を作る calculator です。

この calculator がやることは単純です。

- 磁場を `Oe -> T` に変換する
- 温度をそのまま保持する
- 試料全体のモーメントを `emu -> mu_B` に変換する
- 試料質量と組成を使って、`mu_B / element` に正規化する

`mh` / `mt` のような解釈はこの calculator の責務ではありません。入力ファイルに磁場列と温度列が両方ある前提で、両方とも出力に残します。

## どんなデータを読むか

CSV header から次の 3 種類の列を探します。

- 磁場列: `Magnetic Field (Oe)` または `Field (Oe)`
- 温度列: `Temperature (K)` または `Average Temp (K)`
- モーメント列: `DC Moment Fixed Ctr (emu)`, `DC Moment Fixed Car (emu)`, `Moment (emu)`, `Long Moment (emu)`, `Long Moment [w/o ABS] (emu)` のいずれか

各 row では、これら 3 つが数値として読めた行だけを使います。どれか 1 つでも読めない行はスキップします。

## どんなパラメータを要求するか

この calculator は、材料情報と sample 情報から次を解決します。

- `mass_mg`
  - sample mass
- `molar_mass_g_per_mol`
  - formula unit のモル質量
- `normalization_element`
  - どの元素 1 個あたりで正規化するか
- `count_per_formula_unit`
  - その元素が formula unit あたり何個あるか

実装上の解決は次です。

- `normalization_element`
  - `material.normalization.magnetization_per`
  - なければ `material.magnetic_element`
- `count_per_formula_unit`
  - `material.normalization.count_per_formula_unit`
  - なければ `material.atoms_per_formula_unit[normalization_element]`
- `mass_mg`
  - sample metadata
- `molar_mass_g_per_mol`
  - material metadata

## どんな計算をするか

まず、試料中に含まれる正規化対象元素の総数 `N_centers` を

$$
N_{\mathrm{centers}}
=
\frac{m_{\mathrm{sample}}/1000}{M_{\mathrm{mol}}}
N_A
n
$$

で計算します。

ここで、

- $m_{\mathrm{sample}}$ : sample mass in mg
- $M_{\mathrm{mol}}$ : molar mass in g/mol
- $N_A$ : Avogadro constant
- $n$ : normalization element の formula unit あたり個数

です。

各 row のモーメント `m_emu` は、

$$
m_{\mu_B}
=
\frac{10^{-3} m_{\mathrm{emu}}}{\mu_B}
$$

で `mu_B` に変換し、最終的な出力は

$$
M_{\mathrm{out}}
=
\frac{m_{\mu_B}}{N_{\mathrm{centers}}}
$$

です。

同時に磁場は

$$
H_{\mathrm{T}} = 10^{-4} H_{\mathrm{Oe}}
$$

として `field_t` に変換します。温度は `temperature_k` としてそのまま残します。

## 出力

出力 CSV の主列は次です。

- `field_t`
- `temperature_k`
- `magnetization_muB_per_<element>`

`<element>` には `normalization_element` が入ります。

必要なら passthrough column も後ろに追加されますが、計算本体は上の 3 列だけで完結しています。
