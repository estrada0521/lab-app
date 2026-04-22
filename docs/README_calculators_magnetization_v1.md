# Magnetization Moment Normalization

`magnetization_v1` converts one magnetization source file into a data CSV whose
main y column is magnetization in Bohr magnetons per selected magnetic element.

The input moment is the magnetic moment of the whole measured sample in `emu`.
The output is normalized by the number of selected magnetic atoms in that sample.

## Rawdata Columns

For each source row $i$, the calculator first resolves the rawdata columns below.

| Symbol | Meaning | Rawdata column candidates, in priority order | Required |
| --- | --- | --- | --- |
| $H_i^{\mathrm{Oe}}$ | magnetic field in Oe | `Magnetic Field (Oe)`, then `Field (Oe)` | required for `mh` |
| $T_i$ | temperature in K | `Temperature (K)`, then `Average Temp (K)` | required for `mt` |
| $m_i^{\mathrm{emu}}$ | measured sample moment in emu | `DC Moment Fixed Ctr (emu)`, `DC Moment Fixed Car (emu)`, `Moment (emu)`, `Long Moment (emu)`, `Long Moment [w/o ABS] (emu)` | always required |

The first column name found in the CSV header is used. If no moment column is found,
the calculator cannot run. If neither a field column nor a temperature column is found,
the calculator cannot run.

## Metadata Symbols

The normalization uses material and sample metadata associated with the source file.

| Symbol | Metadata key | Meaning |
| --- | --- | --- |
| $m_{\mathrm{sample}}^{\mathrm{mg}}$ | `sample.mass_mg` | sample mass in mg |
| $M_{\mathrm{mol}}$ | `material.molar_mass_g_per_mol` | molar mass in g/mol |
| $e$ | `material.normalization.magnetization_per` | element used as the normalization target |
| $n_e$ | `material.normalization.count_per_formula_unit` | number of element $e$ atoms per formula unit |

Fallbacks:

- If `material.normalization.magnetization_per` is missing, `material.magnetic_element` is used.
- If `material.normalization.count_per_formula_unit` is missing, `material.atoms_per_formula_unit[e]` is used.

All four resolved values are required.

## Constants

| Symbol | Value | Meaning |
| --- | --- | --- |
| $N_A$ | $6.02214076 \times 10^{23}$ | Avogadro constant |
| $\mu_B$ | $9.2740100783 \times 10^{-24}\ \mathrm{A\,m^2}$ | Bohr magneton |
| $c_{\mathrm{emu}}$ | $10^{-3}$ | conversion from emu to $\mathrm{A\,m^2}$ |
| $c_{\mathrm{Oe}}$ | $10^{-4}$ | conversion from Oe to T |

## `mh` / `mt` Detection

Let `source_name` be the source record id or generated output name.
Let `stem = lower(source_name)`.

The measurement kind is selected in this exact order:

1. If `stem` starts with `mh` and a field column exists, use `mh`.
2. If `stem` starts with `mt` and a temperature column exists, use `mt`.
3. If a field column exists and no temperature column exists, use `mh`.
4. If a temperature column exists, use `mt`.
5. If a field column exists, use `mh`.
6. Otherwise fail.

This means that a file containing both field and temperature columns is treated as `mt`
unless the source name starts with `mh`.

## Normalization Denominator

First convert the sample mass to grams:

$$
m_{\mathrm{sample}}^{\mathrm{g}}
= \frac{m_{\mathrm{sample}}^{\mathrm{mg}}}{1000}
$$

Compute the number of formula units in the measured sample:

$$
N_{\mathrm{fu}}
= \frac{m_{\mathrm{sample}}^{\mathrm{g}}}{M_{\mathrm{mol}}} N_A
$$

Compute the number of normalization centers:

$$
N_{\mathrm{centers}}
= N_{\mathrm{fu}} n_e
$$

If $e=\mathrm{Ni}$, then $N_{\mathrm{centers}}$ is the number of Ni atoms in the sample.

## Moment Conversion

For each valid row, convert the source moment from emu to Bohr magnetons:

$$
m_i^{\mathrm{A\,m^2}}
= c_{\mathrm{emu}} m_i^{\mathrm{emu}}
$$

$$
m_i^{\mu_B}
= \frac{m_i^{\mathrm{A\,m^2}}}{\mu_B}
$$

The normalized output value is:

$$
M_i^{\mu_B/e}
= \frac{m_i^{\mu_B}}{N_{\mathrm{centers}}}
$$

The output y column name is:

```text
magnetization_muB_per_<e>
```

For example, if $e=\mathrm{Ni}$, the output column is
`magnetization_muB_per_Ni`.

## x Axis Conversion

For `mh`:

$$
x_i = H_i^{\mathrm{T}}
= c_{\mathrm{Oe}} H_i^{\mathrm{Oe}}
$$

The output x column is `field_t`.

For `mt`:

$$
x_i = T_i
$$

The output x column is `temperature_k`.

## Row Algorithm

For every source row $i$:

1. Parse the selected x column as a Python `float`.
2. Parse the selected moment column as a Python `float`.
3. If either value is blank or cannot be parsed, skip the row.
4. Convert the x value:
   - `mh`: $H_i^{\mathrm{Oe}} \mapsto H_i^{\mathrm{T}}$
   - `mt`: $T_i \mapsto T_i$
5. Convert $m_i^{\mathrm{emu}}$ to $M_i^{\mu_B/e}$ using the equations above.
6. Write the converted row.

If no rows remain after this filtering, the calculator fails.

## Output CSV

For `mh`, the required output columns are written in this order:

| Output column | Definition | Unit |
| --- | --- | --- |
| `field_t` | $H_i^{\mathrm{Oe}} \times 10^{-4}$ | T |
| `magnetization_muB_per_<e>` | $M_i^{\mu_B/e}$ | $\mu_B/e$ |

For `mt`, the required output columns are written in this order:

| Output column | Definition | Unit |
| --- | --- | --- |
| `temperature_k` | $T_i$ | K |
| `magnetization_muB_per_<e>` | $M_i^{\mu_B/e}$ | $\mu_B/e$ |

Optional retained source columns are appended after these required output columns.
They are copied as strings from the source CSV and are not used in the calculation.

## Output Metadata

The JSON sidecar records the values needed to reproduce the conversion:

- `calculator = magnetization_v1`
- `measurement_kind = mh` or `mt`
- `x_column`
- `moment_column`
- `y_column`
- `mass_mg`
- `molar_mass_g_per_mol`
- `normalization_element`
- `normalization_count_per_formula_unit`
- `formula_units`
- `normalization_centers`
- `required_source_columns`
- `selected_passthrough_columns`

With the source CSV, this README, and those metadata values, the same converted data
can be reproduced.
