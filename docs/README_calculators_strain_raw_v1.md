# Raw Strain Bridge Conversion

`strain_raw_v1` converts one strain source file from lock-in bridge rawdata to
raw strain. The output is still a single-file conversion result. Symmetrization,
field-history processing, hysteresis analysis, and multi-file comparison are outside
this calculator.

## Rawdata Columns

For each source row $i$, the calculator uses the following rawdata columns.

| Symbol | Rawdata column | Meaning | Required |
| --- | --- | --- | --- |
| $L_i$ | `Lockin_data_1` | lock-in output used by the bridge equation | always |
| $T_i$ | `PPMS_temp_K` | PPMS temperature in K | always |
| $H_i^{\mathrm{Oe}}$ | `Mag_field_Oe` | magnetic field in Oe | always |

All three columns must exist in the CSV header. `Mag_field_Oe` is required even for
temperature sweeps because it is used for sweep detection and for the auxiliary
`field_t` output column.

## Metadata Symbols

The calculator reads `strain_calculation` from the associated experiment/session metadata.

| Symbol | Metadata key | Meaning |
| --- | --- | --- |
| $K$ | `strain_calculation.gauge_factor` | gauge factor |
| $A$ | `strain_calculation.amplifier_gain` | amplifier gain |
| $V_{\mathrm{in}}$ | `strain_calculation.input_voltage_v` | bridge input voltage in V |
| $C$ | `strain_calculation.bridge_correction_factor` | bridge correction factor |
| $s$ | `strain_calculation.lockin_sign` | lock-in sign correction |
| axis label | `strain_calculation.axis_family` | strain direction label stored in metadata |
| copper table | `strain_calculation.copper_thermal_expansion` | CSV table for copper thermal expansion |

`axis_family` is not used in the numerical formula, but it is recorded in the output
metadata. If `axis_family` is missing, the implementation falls back to the sample
`orientation`; `orientation = 110` is interpreted as `001`.

If `copper_thermal_expansion` is missing, the default table is:

```text
calculators/strain_raw_v1/assets/cu_thermal_expansion.csv
```

## Copper Thermal Expansion

The copper table is a CSV with these columns:

| Table column | Meaning |
| --- | --- |
| `tempreture` | temperature in K |
| `dL/L(E-6)` | copper expansion in units of $10^{-6}$ |

For each table row $j$:

$$
\alpha_j = \mathrm{dL/L(E-6)}_j \times 10^{-6}
$$

The table pairs $(T_j, \alpha_j)$ are sorted by $T_j$.

For a measured temperature $T_i$:

- if $T_i$ is below the table range, use the first table value;
- if $T_i$ is above the table range, use the last table value;
- otherwise linearly interpolate between the surrounding points.

For $T_1 \le T_i \le T_2$:

$$
\alpha_{\mathrm{Cu}}(T_i)
= \alpha_1
+ \frac{T_i - T_1}{T_2 - T_1}
  \left(\alpha_2 - \alpha_1\right)
$$

## `lh` / `lt` Detection

The calculator decides whether the source is a field sweep (`lh`) or temperature sweep (`lt`)
from the numeric span of the field and temperature columns.

$$
\Delta H = \max_i H_i^{\mathrm{Oe}} - \min_i H_i^{\mathrm{Oe}}
$$

$$
\Delta T = \max_i T_i - \min_i T_i
$$

Only values that can be parsed as floats are used for the spans.

The detection order is exact:

| Condition | Kind |
| --- | --- |
| $\Delta H \ge 5000$ and $\Delta T \le 5$ | `lh` |
| $\Delta T \ge 5$ and $\Delta H \le 5000$ | `lt` |
| $\Delta H > \max(\Delta T, 10^{-9}) \times 1000$ | `lh` |
| $\Delta T > 0$ | `lt` |
| otherwise | fail |

For `lh`, the x source column is `Mag_field_Oe`.
For `lt`, the x source column is `PPMS_temp_K`.

## Bridge Formula

For each valid source row $i$, first apply the lock-in sign:

$$
L_i^{\mathrm{corr}} = s L_i
$$

Define the dimensionless bridge term:

$$
r_i
= \frac{2L_i^{\mathrm{corr}}}{A V_{\mathrm{in}}}
$$

The denominator is:

$$
d_i = 1 + r_i
$$

If $\lvert d_i \rvert < 10^{-12}$, the calculation fails because the bridge ratio
would divide by zero.

The bridge ratio is:

$$
R_i^{\mathrm{bridge}}
= \frac{1-r_i}{1+r_i}
$$

Apply copper thermal expansion and bridge correction:

$$
R_i^{\mathrm{corr}}
= \left(1 + K\alpha_{\mathrm{Cu}}(T_i)\right)
  R_i^{\mathrm{bridge}} C
$$

The raw strain is:

$$
\epsilon_i^{\mathrm{raw}}[\mathrm{mm/m}]
= \frac{10^3}{K}
  \left(R_i^{\mathrm{corr}} - 1\right)
$$

This value is written as `strain_raw_mm_per_m`.

## Row Algorithm

For every source row $i$:

1. Parse the selected x source column as a Python `float`.
   - `lh`: selected x source column is `Mag_field_Oe`.
   - `lt`: selected x source column is `PPMS_temp_K`.
2. Parse `PPMS_temp_K` as $T_i$.
3. Parse `Lockin_data_1` as $L_i$.
4. If any of those three values is blank or cannot be parsed, skip the row.
5. Compute $\alpha_{\mathrm{Cu}}(T_i)$ by table lookup/interpolation.
6. Compute $\epsilon_i^{\mathrm{raw}}[\mathrm{mm/m}]$ using the bridge formula.
7. Write the row according to the `lh` or `lt` output rules below.

If no rows remain after this filtering, the calculator fails.

For `lt`, `Mag_field_Oe` is parsed separately only for the auxiliary `field_t` value.
If that row's `Mag_field_Oe` cannot be parsed, `field_t` is written as `0.0`.

## `lh` Output

For `lh`, the x value is field in tesla:

$$
H_i^{\mathrm{T}}
= H_i^{\mathrm{Oe}} \times 10^{-4}
$$

Before the final CSV is written, the calculator finds the converted row whose
`field_t` is closest to zero:

$$
k = \operatorname*{argmin}_i \lvert H_i^{\mathrm{T}} \rvert
$$

The zero-field reference is:

$$
\epsilon_0[\mathrm{um/m}]
= 1000\epsilon_k^{\mathrm{raw}}[\mathrm{mm/m}]
$$

The primary output strain is:

$$
\epsilon_i^{\mathrm{offset}}[\mathrm{um/m}]
= 1000\epsilon_i^{\mathrm{raw}}[\mathrm{mm/m}]
  - \epsilon_0[\mathrm{um/m}]
$$

The `lh` output columns are written in this exact order:

| Output column | Definition |
| --- | --- |
| `field_t` | $H_i^{\mathrm{Oe}} \times 10^{-4}$ |
| `strain_offset_um_per_m` | $\epsilon_i^{\mathrm{offset}}[\mathrm{um/m}]$ |
| `strain_raw_mm_per_m` | $\epsilon_i^{\mathrm{raw}}[\mathrm{mm/m}]$ |
| `ppms_temperature_k` | $T_i$ |
| `copper_thermal_expansion_fraction` | $\alpha_{\mathrm{Cu}}(T_i)$ |

The primary y column is `strain_offset_um_per_m`.

## `lt` Output

For `lt`, the x value is temperature:

$$
x_i = T_i
$$

The raw strain is used directly as the primary y value. No zero-field offset is applied.

The `lt` output columns are written in this exact order:

| Output column | Definition |
| --- | --- |
| `temperature_k` | $T_i$ |
| `strain_raw_mm_per_m` | $\epsilon_i^{\mathrm{raw}}[\mathrm{mm/m}]$ |
| `field_t` | $H_i^{\mathrm{Oe}} \times 10^{-4}$, or `0.0` if that row's field value is not numeric |
| `copper_thermal_expansion_fraction` | $\alpha_{\mathrm{Cu}}(T_i)$ |

The primary y column is `strain_raw_mm_per_m`.

## Optional Retained Columns

The required source columns are fixed:

- `Lockin_data_1`
- `PPMS_temp_K`
- `Mag_field_Oe`

Optional retained source columns are appended after the required output columns.
They are copied as strings from the source CSV and are not used in the calculation.

## Output Metadata

The JSON sidecar records the values needed to reproduce the conversion:

- `calculator = strain_raw_v1`
- `measurement_kind = lh` or `lt`
- `x_column`
- `primary_output_column`
- `axis_family`
- `gauge_factor`
- `amplifier_gain`
- `input_voltage_v`
- `bridge_correction_factor`
- `lockin_sign`
- `copper_thermal_expansion`
- `required_source_columns`
- `selected_passthrough_columns`

With the source CSV, the copper table, this README, and those metadata values,
the same converted data can be reproduced.
