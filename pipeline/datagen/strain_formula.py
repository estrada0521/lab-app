from __future__ import annotations

import csv
from bisect import bisect_left
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class CuThermalExpansionTable:
    temperatures: tuple[float, ...]
    expansions: tuple[float, ...]


@dataclass(frozen=True)
class StrainCalculationParameters:
    calculator: str
    axis_family: str
    gauge_factor: float
    amplifier_gain: float
    input_voltage_v: float
    bridge_correction_factor: float
    lockin_sign: float
    copper_thermal_expansion_path: Path


@lru_cache(maxsize=None)
def load_cu_thermal_expansion(path_text: str) -> CuThermalExpansionTable:
    path = Path(path_text)
    temperatures: list[float] = []
    expansions: list[float] = []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            temperature = float(row["tempreture"])
            expansion = float(row["dL/L(E-6)"]) * 1e-6
            temperatures.append(temperature)
            expansions.append(expansion)
    pairs = sorted(zip(temperatures, expansions), key=lambda item: item[0])
    return CuThermalExpansionTable(
        temperatures=tuple(item[0] for item in pairs),
        expansions=tuple(item[1] for item in pairs),
    )


def interpolate_cu_expansion(table: CuThermalExpansionTable, temperature_k: float) -> float:
    temperatures = table.temperatures
    expansions = table.expansions
    if not temperatures:
        raise ValueError("copper thermal expansion table is empty")
    if temperature_k <= temperatures[0]:
        return expansions[0]
    if temperature_k >= temperatures[-1]:
        return expansions[-1]
    index = bisect_left(temperatures, temperature_k)
    left_temperature = temperatures[index - 1]
    right_temperature = temperatures[index]
    left_expansion = expansions[index - 1]
    right_expansion = expansions[index]
    fraction = (temperature_k - left_temperature) / (right_temperature - left_temperature)
    return left_expansion + (right_expansion - left_expansion) * fraction


def calculate_raw_strain_mm_per_m(
    lockin_data_1: float,
    ppms_temperature_k: float,
    parameters: StrainCalculationParameters,
    table: CuThermalExpansionTable,
) -> tuple[float, float]:
    copper_expansion = interpolate_cu_expansion(table, ppms_temperature_k)
    corrected_lockin = parameters.lockin_sign * lockin_data_1
    denominator = 1.0 + 2.0 * corrected_lockin / parameters.amplifier_gain / parameters.input_voltage_v
    if abs(denominator) < 1e-12:
        raise ValueError("strain calculation hit a zero denominator")
    term_ratio = (1.0 - 2.0 * corrected_lockin / parameters.amplifier_gain / parameters.input_voltage_v) / denominator
    corrected_ratio = (1.0 + parameters.gauge_factor * copper_expansion) * term_ratio * parameters.bridge_correction_factor
    raw_strain_mm_per_m = 1e3 * (1.0 / parameters.gauge_factor) * (corrected_ratio - 1.0)
    return raw_strain_mm_per_m, copper_expansion
