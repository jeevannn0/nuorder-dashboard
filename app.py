import re

import pandas as pd
import streamlit as st

st.set_page_config(
    page_title="NuORDER Color Lookup",
    page_icon="🎨",
    layout="centered",
)

st.title("🎨 NuORDER Color Dashboard")
st.markdown(
    "Paste a raw color below to instantly generate the **Customer Facing "
    "Color** and find its **Color Family**."
)

# --- CONNECT GOOGLE SHEET HERE ---
# Published Google Sheet CSV link
SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLtwVng-2paE3JmYRfENRg3_ZEFvCxcZscbZu9fKSrlRkXeWLaZtM6S4G8i3c8wUhA7Xzc0gZJKmDA/pub?gid=415337850&single=true&output=csv"

NOT_FOUND = "Not found in database"


@st.cache_data(ttl=60)  # Refreshes data every 60 seconds
def load_data(url):
    try:
        df = pd.read_csv(url)
        if "COLOR" in df.columns:
            df["COLOR_LOWER"] = df["COLOR"].astype(str).str.strip().str.lower()
        return df
    except Exception:
        return pd.DataFrame()


df = load_data(SHEET_CSV_URL)

# --- FORMATTING LOGIC ---
translation_dict = {
    "rouge": "red", "bleu": "blue", "vert": "green", "jaune": "yellow",
    "noir": "black", "blanc": "white", "gris": "gray", "rose": "pink",
    "marron": "brown", "violet": "purple", "rosso": "red", "blu": "blue",
    "verde": "green", "giallo": "yellow", "nero": "black", "bianco": "white",
    "grigio": "gray", "rosa": "pink", "arancione": "orange",
    "marrone": "brown", "viola": "purple",
}


def get_customer_facing_color(color_name):
    if not isinstance(color_name, str):
        return ""
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", "", color_name)
    words = cleaned.split()
    translated = [translation_dict.get(w.lower(), w) for w in words]
    return " ".join(translated[:3]).title()


# --- USER INTERFACE ---
if df.empty:
    st.error(
        "Could not load the color database. Check the Google Sheet CSV link "
        "and that the sheet is still published."
    )
else:
    search_query = st.text_input("Paste Raw Vendor Color Here:", "")

    if search_query:
        formatted_color = get_customer_facing_color(search_query)
        search_lower = search_query.strip().lower()

        match = df[df["COLOR_LOWER"] == search_lower]
        found = not match.empty
        color_family = match.iloc[0]["Color Family"] if found else NOT_FOUND

        st.divider()
        st.subheader("Results")

        col1, col2 = st.columns(2)

        with col1:
            st.info("**Customer Facing Color**")
            st.success(f"**{formatted_color}**")

        with col2:
            st.info("**Color Family**")
            if found:
                st.success(f"**{color_family}**")
            else:
                st.error(f"**{color_family}**")
                st.caption("To fix this, add the color to your Google Sheet!")

        st.markdown("### Copy for NuORDER:")
        st.code(f"{formatted_color}\t{color_family}", language="text")
