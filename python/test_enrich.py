"""Тесты модуля обогащения данных (обработка коллизий 1-ко-многим)."""

import numpy as np
import pandas as pd
import pytest

from enrich import enrich_data


def test_one_to_one_match():
    df_main = pd.DataFrame({"key": ["a", "b"], "val": [1, 2]})
    df_dict = pd.DataFrame({"key": ["a", "b"], "Менеджер": ["Мария", "Иван"]})

    result, warnings = enrich_data(df_main, df_dict, ["key"], "Менеджер")

    assert warnings == []
    assert list(result["Менеджер"]) == ["Мария", "Иван"]
    # Строки не дублируются.
    assert len(result) == len(df_main)


def test_multiple_matches_without_conflict():
    df_main = pd.DataFrame({"Месяц": ["Июнь"], "Контрагент": ["ООО Ромашка"]})
    df_dict = pd.DataFrame(
        {
            "Месяц": ["Июнь", "Июнь"],
            "Контрагент": ["ООО Ромашка", "ООО Ромашка"],
            "Менеджер": ["Иван", "Иван"],
        }
    )

    result, warnings = enrich_data(df_main, df_dict, ["Месяц", "Контрагент"], "Менеджер")

    assert warnings == []
    assert result.loc[0, "Менеджер"] == "Иван"


def test_conflict_joins_unique_values_and_warns():
    df_main = pd.DataFrame({"Месяц": ["Май"], "Контрагент": ["ООО Ромашка"]})
    df_dict = pd.DataFrame(
        {
            "Месяц": ["Май", "Май"],
            "Контрагент": ["ООО Ромашка", "ООО Ромашка"],
            "Менеджер": ["Мария", "Фаина"],
        }
    )

    result, warnings = enrich_data(df_main, df_dict, ["Месяц", "Контрагент"], "Менеджер")

    # Строки не дублируются, значения объединены через запятую.
    assert len(result) == 1
    assert result.loc[0, "Менеджер"] == "Мария, Фаина"
    assert len(warnings) == 1
    assert warnings[0] == (
        "Для критериев [Май, ООО Ромашка] найдено несколько различных значений: "
        "Мария, Фаина"
    )


def test_conflict_deduplicates_repeated_values():
    df_main = pd.DataFrame({"key": ["x"]})
    df_dict = pd.DataFrame({"key": ["x", "x", "x"], "t": ["A", "B", "A"]})

    result, warnings = enrich_data(df_main, df_dict, ["key"], "t")

    # A встречается дважды, но в результате один раз; порядок первого появления.
    assert result.loc[0, "t"] == "A, B"
    assert warnings[0].endswith("A, B")


def test_no_match_yields_none():
    df_main = pd.DataFrame({"key": ["missing"]})
    df_dict = pd.DataFrame({"key": ["other"], "t": ["Z"]})

    result, warnings = enrich_data(df_main, df_dict, ["key"], "t")

    assert pd.isna(result.loc[0, "t"])
    assert warnings == []


def test_robust_to_type_mismatch_in_keys():
    # Ключ в основной базе — число, в справочнике — строка.
    df_main = pd.DataFrame({"id": [5, 10]})
    df_dict = pd.DataFrame({"id": ["5", " 10 "], "t": ["пять", "десять"]})

    result, warnings = enrich_data(df_main, df_dict, ["id"], "t")

    assert list(result["t"]) == ["пять", "десять"]
    assert warnings == []


def test_robust_to_nan_and_empty_values():
    df_main = pd.DataFrame({"key": ["a", None, np.nan], "v": [1, 2, 3]})
    df_dict = pd.DataFrame(
        {"key": ["a", "b"], "t": ["Мария", np.nan]}
    )

    # Не должно падать; несопоставленные/пустые ключи дают None.
    result, warnings = enrich_data(df_main, df_dict, ["key"], "t")

    assert result.loc[0, "t"] == "Мария"
    assert pd.isna(result.loc[1, "t"])
    assert pd.isna(result.loc[2, "t"])


def test_does_not_overwrite_existing_main_column():
    df_main = pd.DataFrame({"key": ["a"], "Менеджер": ["старое"]})
    df_dict = pd.DataFrame({"key": ["a"], "Менеджер": ["новое"]})

    result, _ = enrich_data(df_main, df_dict, ["key"], "Менеджер")

    assert result.loc[0, "Менеджер"] == "старое"
    assert result.loc[0, "Менеджер (справочник)"] == "новое"


def test_missing_columns_raise():
    df_main = pd.DataFrame({"key": ["a"]})
    df_dict = pd.DataFrame({"other": ["a"], "t": ["x"]})

    with pytest.raises(KeyError):
        enrich_data(df_main, df_dict, ["key"], "t")
    with pytest.raises(ValueError):
        enrich_data(df_main, df_dict, [], "t")


def test_empty_main_frame():
    df_main = pd.DataFrame({"key": pd.Series([], dtype="object")})
    df_dict = pd.DataFrame({"key": ["a"], "t": ["x"]})

    result, warnings = enrich_data(df_main, df_dict, ["key"], "t")

    assert len(result) == 0
    assert "t" in result.columns
    assert warnings == []
