"""Модуль обогащения данных (ETL) с обработкой коллизий 1-ко-многим.

Основная функция :func:`enrich_data` переносит значения целевой колонки из
справочника (``df_dict``) в основную базу (``df_main``) по одному или нескольким
ключам, аккуратно разрешая ситуации, когда одному набору ключей в справочнике
соответствует несколько строк.
"""

from __future__ import annotations

from typing import Hashable, List, Sequence, Tuple

import pandas as pd

# Разделитель между несколькими уникальными значениями в конфликтной ячейке.
_JOIN_SEP = ", "


def _normalize_key(series: pd.Series) -> pd.Series:
    """Привести колонку-ключ к сопоставимому виду.

    Значения приводятся к строке и обрезаются по краям, чтобы ключи разного типа
    (``5`` и ``"5"``) и с лишними пробелами совпадали. ``NaN``/``None`` и пустые
    строки становятся пустой строкой, поэтому такие ключи не «схлопываются» с
    осмысленными значениями и не вызывают ошибок.
    """

    def _one(value: object) -> str:
        if value is None or (isinstance(value, float) and pd.isna(value)) or pd.isna(value):
            return ""
        return str(value).strip()

    return series.map(_one)


def _clean_target(value: object) -> str | None:
    """Очистить значение целевой колонки; вернуть ``None`` для пустых/NaN."""
    try:
        if value is None or pd.isna(value):
            return None
    except (TypeError, ValueError):
        # На случай экзотических типов, где pd.isna неоднозначна.
        pass
    text = str(value).strip()
    return text or None


def _unique_preserve_order(values: Sequence[str | None]) -> List[str]:
    """Уникальные непустые значения в порядке первого появления."""
    seen: set[str] = set()
    result: List[str] = []
    for value in values:
        if value is None or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _as_tuple(key: Hashable) -> Tuple[Hashable, ...]:
    return key if isinstance(key, tuple) else (key,)


def enrich_data(
    df_main: pd.DataFrame,
    df_dict: pd.DataFrame,
    join_keys: Sequence[str],
    target_col: str,
) -> Tuple[pd.DataFrame, List[str]]:
    """Обогатить ``df_main`` значением ``target_col`` из ``df_dict``.

    Логика разрешения коллизий:

    1. **1-к-1** — переносится единственное значение.
    2. **Множественное совпадение без конфликта** — несколько строк, но значение
       одинаковое: переносится это значение.
    3. **Конфликт** — несколько строк с разными значениями: в ячейку пишутся все
       уникальные значения через запятую, а в ``warnings`` добавляется текст
       предупреждения. Строки ``df_main`` при этом не дублируются.

    Parameters
    ----------
    df_main, df_dict:
        Основная база и справочник.
    join_keys:
        Список колонок-критериев (одна или несколько).
    target_col:
        Колонка справочника, значение которой переносится.

    Returns
    -------
    (result_df, warnings):
        Копия ``df_main`` с добавленной колонкой обогащения и список текстовых
        предупреждений о конфликтах.
    """
    if not isinstance(df_main, pd.DataFrame) or not isinstance(df_dict, pd.DataFrame):
        raise TypeError("df_main и df_dict должны быть pandas.DataFrame")

    join_keys = list(join_keys or [])
    if not join_keys:
        raise ValueError("Не выбраны колонки-критерии (join_keys)")
    if not target_col:
        raise ValueError("Не выбрана целевая колонка (target_col)")

    missing_main = [k for k in join_keys if k not in df_main.columns]
    if missing_main:
        raise KeyError(f"В df_main отсутствуют колонки-критерии: {missing_main}")
    missing_dict = [k for k in join_keys if k not in df_dict.columns]
    if missing_dict:
        raise KeyError(f"В df_dict отсутствуют колонки-критерии: {missing_dict}")
    if target_col not in df_dict.columns:
        raise KeyError(f"В df_dict отсутствует целевая колонка: {target_col}")

    warnings: List[str] = []
    result = df_main.copy()

    # Куда писать результат: не затираем существующую колонку основной базы.
    out_col = target_col if target_col not in result.columns else f"{target_col} (справочник)"

    # Построить индекс справочника: нормализованный ключ -> разрешённое значение.
    dict_norm = pd.DataFrame(
        {f"__key_{i}": _normalize_key(df_dict[k]) for i, k in enumerate(join_keys)}
    )
    dict_norm["__target"] = df_dict[target_col].map(_clean_target).values
    key_cols = [f"__key_{i}" for i in range(len(join_keys))]

    mapping: dict[Tuple[Hashable, ...], str] = {}
    for raw_key, group in dict_norm.groupby(key_cols, dropna=False, sort=False):
        key_tuple = _as_tuple(raw_key)
        uniques = _unique_preserve_order(list(group["__target"]))
        if not uniques:
            continue
        if len(uniques) == 1:
            mapping[key_tuple] = uniques[0]
            continue

        # Конфликт: несколько разных значений под один ключ.
        mapping[key_tuple] = _JOIN_SEP.join(uniques)
        criteria = _JOIN_SEP.join(str(v) for v in key_tuple)
        warnings.append(
            f"Для критериев [{criteria}] найдено несколько различных значений: "
            f"{_JOIN_SEP.join(uniques)}"
        )

    # Сопоставить основную базу (без дублирования строк).
    if len(result) == 0:
        result[out_col] = pd.Series(dtype="object")
        return result, warnings

    main_keys = [_normalize_key(result[k]) for k in join_keys]
    key_tuples = zip(*(series.tolist() for series in main_keys))
    result[out_col] = [mapping.get(_as_tuple(t)) for t in key_tuples]

    return result, warnings
