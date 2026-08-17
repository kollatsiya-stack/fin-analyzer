"""Streamlit-интерфейс для модуля обогащения данных с обработкой коллизий."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from enrich import enrich_data

st.set_page_config(page_title="Обогащение данных (ETL)", layout="wide")
st.title("🔗 Обогащение данных с обработкой коллизий 1-ко-многим")
st.caption(
    "Переносим значение из справочника в основную базу по выбранным критериям. "
    "Конфликтующие значения объединяются через запятую и попадают в предупреждения."
)


def _read_table(uploaded) -> pd.DataFrame:
    if uploaded.name.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(uploaded)
    return pd.read_csv(uploaded)


def _demo_frames() -> tuple[pd.DataFrame, pd.DataFrame]:
    df_main = pd.DataFrame(
        {
            "Месяц": ["Май", "Май", "Июнь", "Июнь"],
            "Контрагент": ["ООО Ромашка", "ЗАО Восход", "ООО Ромашка", "ИП Иванов"],
            "Сумма": [100, 200, 300, 150],
        }
    )
    df_dict = pd.DataFrame(
        {
            "Месяц": ["Май", "Май", "Май", "Июнь", "Июнь"],
            "Контрагент": [
                "ООО Ромашка",
                "ООО Ромашка",
                "ЗАО Восход",
                "ООО Ромашка",
                "ООО Ромашка",
            ],
            # У [Май, ООО Ромашка] конфликт: Мария и Фаина.
            # У [Июнь, ООО Ромашка] дубли без конфликта: Иван и Иван.
            "Менеджер": ["Мария", "Фаина", "Иван", "Иван", "Иван"],
        }
    )
    return df_main, df_dict


st.sidebar.header("Данные")
use_demo = st.sidebar.checkbox("Использовать демо-данные", value=True)

df_main: pd.DataFrame | None = None
df_dict: pd.DataFrame | None = None

if use_demo:
    df_main, df_dict = _demo_frames()
else:
    main_file = st.sidebar.file_uploader(
        "Основная база (df_main)", type=["csv", "xlsx", "xls"]
    )
    dict_file = st.sidebar.file_uploader(
        "Справочник (df_dict)", type=["csv", "xlsx", "xls"]
    )
    try:
        if main_file is not None:
            df_main = _read_table(main_file)
        if dict_file is not None:
            df_dict = _read_table(dict_file)
    except Exception as err:  # noqa: BLE001 - показать любую ошибку чтения пользователю
        st.error(f"Не удалось прочитать файл: {err}")

if df_main is None or df_dict is None:
    st.info("Загрузите обе таблицы в боковой панели или включите демо-данные.")
    st.stop()

left, right = st.columns(2)
with left:
    st.subheader("Основная база (df_main)")
    st.dataframe(df_main, use_container_width=True)
with right:
    st.subheader("Справочник (df_dict)")
    st.dataframe(df_dict, use_container_width=True)

st.divider()
st.subheader("Настройка правила")

join_keys = st.multiselect(
    "Колонки-критерии (join_keys)",
    options=list(df_main.columns),
    default=[c for c in df_main.columns if c in df_dict.columns][:2],
    help="По этим колонкам сопоставляются строки основной базы и справочника.",
)

target_options = [c for c in df_dict.columns if c not in join_keys]
target_col = st.selectbox(
    "Целевая колонка (target_col) — что тянем из справочника",
    options=target_options,
    index=0 if target_options else None,
)

if st.button("Применить правило", type="primary"):
    if not join_keys:
        st.error("Выберите хотя бы одну колонку-критерий.")
    elif not target_col:
        st.error("Выберите целевую колонку.")
    else:
        try:
            result, warnings = enrich_data(df_main, df_dict, join_keys, target_col)
        except Exception as err:  # noqa: BLE001 - защищаемся от любых сбоев логики
            st.error(f"Ошибка при обогащении: {err}")
        else:
            if warnings:
                with st.expander(
                    f"⚠️ Обнаружены неоднозначные соответствия ({len(warnings)})",
                    expanded=True,
                ):
                    for text in warnings:
                        st.warning(text)
            else:
                st.success("Конфликтов не обнаружено.")

            st.subheader("Итоговый обогащённый датафрейм")
            st.dataframe(result, use_container_width=True)
