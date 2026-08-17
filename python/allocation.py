"""Финансовое сплитование / аллокация (proportional splitting).

Функция :func:`allocate_costs` распределяет исходные суммы затрат на целевые
объекты пропорционально драйверам (выручка, площадь, часы и т.п.). Реализация
векторизованная (без ``iterrows``), с аккуратной обработкой краевых случаев:

* «Проблема копеек» — разница округления добавляется к строке с максимальным
  коэффициентом внутри ``transaction_id``, чтобы сумма частей сходилась до копейки.
* Деление на ноль / отсутствие базы — статус ``error_zero_base``, сумма сохраняется.
* Отсутствие правила для ``cost_item`` — статус ``unallocated``.
"""

from __future__ import annotations

import pandas as pd

OUTPUT_COLUMNS = [
    "transaction_id",
    "period",
    "cost_item",
    "target_object",
    "allocated_amount",
    "status",
]


def allocate_costs(
    df_source: pd.DataFrame,
    df_rules: pd.DataFrame,
    df_drivers: pd.DataFrame,
) -> pd.DataFrame:
    """Распределить суммы ``df_source`` по целевым объектам пропорционально драйверам.

    Parameters
    ----------
    df_source:
        Колонки ``transaction_id``, ``period``, ``cost_item``, ``amount_to_allocate``.
    df_rules:
        Колонки ``cost_item``, ``driver_id`` — какой базой распределять статью.
    df_drivers:
        Колонки ``period``, ``driver_id``, ``target_object``, ``driver_value``.

    Returns
    -------
    DataFrame со столбцами :data:`OUTPUT_COLUMNS` и статусами
    ``success`` / ``error_zero_base`` / ``unallocated``.
    """
    empty = pd.DataFrame(columns=OUTPUT_COLUMNS)
    if df_source is None or df_source.empty:
        return empty

    src = df_source.copy()
    src["amount_to_allocate"] = pd.to_numeric(src["amount_to_allocate"], errors="coerce")

    # --- Шаг 1. Привязать driver_id по правилам (один driver_id на cost_item). ---
    rules = df_rules.drop_duplicates(subset="cost_item")[["cost_item", "driver_id"]]
    src = src.merge(rules, on="cost_item", how="left")

    # Строки без правила -> unallocated (одна строка, сумма сохранена).
    no_rule_mask = src["driver_id"].isna()
    unallocated = src[no_rule_mask].copy()
    if not unallocated.empty:
        unallocated["target_object"] = None
        unallocated["allocated_amount"] = unallocated["amount_to_allocate"].round(2)
        unallocated["status"] = "unallocated"

    have_rule = src[~no_rule_mask].copy()
    if have_rule.empty:
        return _finalize([unallocated])

    # --- Шаг 3. Итоговая база распределения на (period, driver_id). ---
    # min_count=1 -> сумма из одних NaN становится NaN (нет базы), а сумма нулей -> 0.
    totals = (
        df_drivers.groupby(["period", "driver_id"], dropna=False)["driver_value"]
        .sum(min_count=1)
        .rename("total_driver_base")
        .reset_index()
    )

    # --- Шаг 2. Развернуть по целевым объектам и подтянуть итоговую базу. ---
    merged = have_rule.merge(
        df_drivers[["period", "driver_id", "target_object", "driver_value"]],
        on=["period", "driver_id"],
        how="left",
    ).merge(totals, on=["period", "driver_id"], how="left")

    # База отсутствует, NaN или равна нулю -> ошибка (защита от деления на ноль).
    bad_base_mask = merged["total_driver_base"].isna() | (merged["total_driver_base"] == 0)

    bad = merged[bad_base_mask]
    error_rows = pd.DataFrame(columns=merged.columns)
    if not bad.empty:
        # Схлопнуть развёрнутые строки обратно в одну на транзакцию.
        error_rows = bad.drop_duplicates(subset="transaction_id").copy()
        error_rows["target_object"] = None
        error_rows["allocated_amount"] = error_rows["amount_to_allocate"].round(2)
        error_rows["status"] = "error_zero_base"

    good = merged[~bad_base_mask].copy()
    if not good.empty:
        # --- Шаги 4-5. Коэффициент и аллоцированная сумма (векторизованно). ---
        good["driver_value"] = good["driver_value"].fillna(0.0)
        good["coefficient"] = good["driver_value"] / good["total_driver_base"]
        good["allocated_amount"] = (good["amount_to_allocate"] * good["coefficient"]).round(2)
        good["status"] = "success"

        # --- Проблема копеек: дельту добавляем к строке с макс. коэффициентом. ---
        group_sum = good.groupby("transaction_id")["allocated_amount"].transform("sum")
        delta = (good["amount_to_allocate"].round(2) - group_sum).round(2)
        idx_max = good.groupby("transaction_id")["coefficient"].idxmax()
        good.loc[idx_max, "allocated_amount"] = (
            good.loc[idx_max, "allocated_amount"] + delta.loc[idx_max]
        ).round(2)

    return _finalize([good, error_rows, unallocated])


def _finalize(frames: list[pd.DataFrame]) -> pd.DataFrame:
    """Собрать части в единый результат с нужными колонками и порядком."""
    parts = [f[OUTPUT_COLUMNS] for f in frames if f is not None and not f.empty]
    if not parts:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)
    result = pd.concat(parts, ignore_index=True)
    return result.sort_values("transaction_id", kind="stable").reset_index(drop=True)


def _mock_data() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Небольшой демонстрационный датасет, включая проблему копеек."""
    p = pd.Timestamp("2024-05-01")

    df_source = pd.DataFrame(
        {
            "transaction_id": ["T1", "T2", "T3", "T4"],
            "period": [p, p, p, p],
            "cost_item": ["Аренда", "Маркетинг", "Клининг", "Логистика"],
            "amount_to_allocate": [100.00, 1000.00, 500.00, 300.00],
        }
    )

    df_rules = pd.DataFrame(
        {
            "cost_item": ["Аренда", "Маркетинг", "Клининг"],
            "driver_id": ["D_AREA", "D_REVENUE", "D_ZERO"],
            # У «Логистика» правила нет -> unallocated.
        }
    )

    df_drivers = pd.DataFrame(
        {
            "period": [p, p, p, p, p, p, p],
            "driver_id": [
                "D_AREA", "D_AREA", "D_AREA",   # 3 равные доли -> проблема копеек
                "D_REVENUE", "D_REVENUE",       # 700/300 обычное распределение
                "D_ZERO", "D_ZERO",             # нулевая база -> error_zero_base
            ],
            "target_object": [
                "Магазин A", "Магазин B", "Магазин C",
                "Проект X", "Проект Y",
                "Точка 1", "Точка 2",
            ],
            "driver_value": [1.0, 1.0, 1.0, 700.0, 300.0, 0.0, 0.0],
        }
    )
    return df_source, df_rules, df_drivers


if __name__ == "__main__":
    df_source, df_rules, df_drivers = _mock_data()
    result = allocate_costs(df_source, df_rules, df_drivers)

    pd.set_option("display.width", 120)
    print("=== Результат аллокации ===")
    print(result.to_string(index=False))

    print("\n=== Проверка сходимости сумм по transaction_id ===")
    check = (
        result.groupby("transaction_id")
        .agg(allocated_sum=("allocated_amount", "sum"))
        .join(df_source.set_index("transaction_id")["amount_to_allocate"])
    )
    check["ok_to_cent"] = (check["allocated_sum"].round(2) == check["amount_to_allocate"].round(2))
    print(check.to_string())
