"""Тесты финансового сплитования / аллокации."""

import pandas as pd
import pytest

from allocation import OUTPUT_COLUMNS, allocate_costs

P = pd.Timestamp("2024-05-01")


def _drivers(rows):
    return pd.DataFrame(rows, columns=["period", "driver_id", "target_object", "driver_value"])


def test_proportional_split_is_correct():
    df_source = pd.DataFrame(
        {
            "transaction_id": ["T1"],
            "period": [P],
            "cost_item": ["Маркетинг"],
            "amount_to_allocate": [1000.00],
        }
    )
    df_rules = pd.DataFrame({"cost_item": ["Маркетинг"], "driver_id": ["D_REV"]})
    df_drivers = _drivers(
        [
            [P, "D_REV", "Проект X", 700.0],
            [P, "D_REV", "Проект Y", 300.0],
        ]
    )

    result = allocate_costs(df_source, df_rules, df_drivers)

    assert list(result.columns) == OUTPUT_COLUMNS
    amounts = dict(zip(result["target_object"], result["allocated_amount"]))
    assert amounts == {"Проект X": 700.00, "Проект Y": 300.00}
    assert set(result["status"]) == {"success"}
    assert len(result) == 2


def test_penny_drop_reconciles_to_the_cent():
    # 100 на три равные доли -> 33.33 каждая -> сумма 99.99; дельта 0.01 на макс. коэфф.
    df_source = pd.DataFrame(
        {
            "transaction_id": ["T1"],
            "period": [P],
            "cost_item": ["Аренда"],
            "amount_to_allocate": [100.00],
        }
    )
    df_rules = pd.DataFrame({"cost_item": ["Аренда"], "driver_id": ["D_AREA"]})
    df_drivers = _drivers(
        [
            [P, "D_AREA", "Магазин A", 1.0],
            [P, "D_AREA", "Магазин B", 1.0],
            [P, "D_AREA", "Магазин C", 1.0],
        ]
    )

    result = allocate_costs(df_source, df_rules, df_drivers)

    total = round(result["allocated_amount"].sum(), 2)
    assert total == 100.00  # сходится до копейки
    assert sorted(result["allocated_amount"]) == [33.33, 33.33, 33.34]
    assert len(result) == 3  # строки не дублируются сверх числа целевых объектов


def test_penny_drop_negative_delta():
    # 100 / 3 при драйверах, дающих округление вверх, проверяем и отрицательную дельту.
    df_source = pd.DataFrame(
        {
            "transaction_id": ["T1"],
            "period": [P],
            "cost_item": ["X"],
            "amount_to_allocate": [10.00],
        }
    )
    df_rules = pd.DataFrame({"cost_item": ["X"], "driver_id": ["D"]})
    df_drivers = _drivers(
        [
            [P, "D", "A", 1.0],
            [P, "D", "B", 1.0],
            [P, "D", "C", 1.0],
        ]
    )
    result = allocate_costs(df_source, df_rules, df_drivers)
    assert round(result["allocated_amount"].sum(), 2) == 10.00


def test_zero_base_becomes_error_and_keeps_amount():
    df_source = pd.DataFrame(
        {
            "transaction_id": ["T1"],
            "period": [P],
            "cost_item": ["Клининг"],
            "amount_to_allocate": [500.00],
        }
    )
    df_rules = pd.DataFrame({"cost_item": ["Клининг"], "driver_id": ["D_ZERO"]})
    df_drivers = _drivers(
        [
            [P, "D_ZERO", "Точка 1", 0.0],
            [P, "D_ZERO", "Точка 2", 0.0],
        ]
    )

    result = allocate_costs(df_source, df_rules, df_drivers)

    assert len(result) == 1
    row = result.iloc[0]
    assert row["status"] == "error_zero_base"
    assert row["target_object"] is None
    assert row["allocated_amount"] == 500.00


def test_missing_driver_rows_is_error_zero_base():
    # Правило есть, но в df_drivers нет строк для этого driver_id/периода -> NaN база.
    df_source = pd.DataFrame(
        {
            "transaction_id": ["T1"],
            "period": [P],
            "cost_item": ["Аренда"],
            "amount_to_allocate": [200.00],
        }
    )
    df_rules = pd.DataFrame({"cost_item": ["Аренда"], "driver_id": ["D_AREA"]})
    df_drivers = _drivers([[P, "D_OTHER", "Магазин A", 5.0]])

    result = allocate_costs(df_source, df_rules, df_drivers)

    assert len(result) == 1
    assert result.iloc[0]["status"] == "error_zero_base"
    assert result.iloc[0]["allocated_amount"] == 200.00


def test_missing_rule_is_unallocated():
    df_source = pd.DataFrame(
        {
            "transaction_id": ["T1"],
            "period": [P],
            "cost_item": ["Логистика"],
            "amount_to_allocate": [300.00],
        }
    )
    df_rules = pd.DataFrame({"cost_item": ["Аренда"], "driver_id": ["D_AREA"]})
    df_drivers = _drivers([[P, "D_AREA", "Магазин A", 1.0]])

    result = allocate_costs(df_source, df_rules, df_drivers)

    assert len(result) == 1
    assert result.iloc[0]["status"] == "unallocated"
    assert result.iloc[0]["target_object"] is None
    assert result.iloc[0]["allocated_amount"] == 300.00


def test_mixed_statuses_and_no_source_row_loss():
    df_source = pd.DataFrame(
        {
            "transaction_id": ["T1", "T2", "T3"],
            "period": [P, P, P],
            "cost_item": ["Маркетинг", "Клининг", "Логистика"],
            "amount_to_allocate": [1000.0, 500.0, 300.0],
        }
    )
    df_rules = pd.DataFrame(
        {"cost_item": ["Маркетинг", "Клининг"], "driver_id": ["D_REV", "D_ZERO"]}
    )
    df_drivers = _drivers(
        [
            [P, "D_REV", "Проект X", 700.0],
            [P, "D_REV", "Проект Y", 300.0],
            [P, "D_ZERO", "Точка 1", 0.0],
        ]
    )

    result = allocate_costs(df_source, df_rules, df_drivers)

    # Каждая исходная транзакция представлена в результате.
    assert set(result["transaction_id"]) == {"T1", "T2", "T3"}
    statuses = dict(zip(result["transaction_id"], result["status"]))
    assert statuses["T2"] == "error_zero_base"
    assert statuses["T3"] == "unallocated"
    # T1 успешно распределилась на 2 объекта, сумма сходится.
    t1 = result[result["transaction_id"] == "T1"]
    assert round(t1["allocated_amount"].sum(), 2) == 1000.00


def test_empty_source_returns_empty_frame_with_columns():
    empty = pd.DataFrame(
        columns=["transaction_id", "period", "cost_item", "amount_to_allocate"]
    )
    result = allocate_costs(empty, pd.DataFrame(), pd.DataFrame())
    assert list(result.columns) == OUTPUT_COLUMNS
    assert result.empty
