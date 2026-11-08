#!/usr/bin/env python3
"""
Monitor de Ocorrências com Dados Abertos da Cidade do Rio de Janeiro (COR-Rio & CET-Rio).
Consome a API oficial do Centro de Operações e Resiliência da Prefeitura (https://cor.rio/wp-json/wp/v2/posts)
e feeds abertos de trânsito, extraindo:
- Esquemas especiais de trânsito da CET-Rio (estádios, Sambódromo, grandes eventos).
- Interdições programadas de túneis e elevados (Rebouças, Zuzu Angel, Niemeyer).
- Acidentes e bolsões d'água reportados pelo Alerta Rio.
Normaliza e sincroniza tudo com a tabela public.city_hazards do Supabase.
Custo operacional: R$ 0,00 (Zero-Token).
"""
import os
import re
import json
import hashlib
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import List, Dict, Optional, Tuple

import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
RJ_TZ = ZoneInfo("America/Sao_Paulo")

COR_API_URL = "https://cor.rio/wp-json/wp/v2/posts?per_page=15"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# Dicionário de Coordenadas de Referência para Polos e Gargalos no Rio
RIO_GEO_HOTSPOTS = {
    "sambodromo": {"name": "Entorno do Sambódromo / Apoteose (Centro)", "lat": -22.91220, "lng": -43.19700},
    "sao_januario": {"name": "Entorno do Estádio de São Januário (Vasco)", "lat": -22.89060, "lng": -43.22840},
    "nilton_santos": {"name": "Entorno do Estádio Nilton Santos (Engenhão)", "lat": -22.89182, "lng": -43.29431},
    "maracana": {"name": "Entorno do Maracanã", "lat": -22.91025, "lng": -43.23418},
    "reboucas": {"name": "Túnel Rebouças (Galerias)", "lat": -22.94920, "lng": -43.20810},
    "zuzu_angel": {"name": "Túnel Zuzu Angel / Acústico", "lat": -22.98630, "lng": -43.24350},
    "niemeyer": {"name": "Avenida Niemeyer (São Conrado)", "lat": -22.99250, "lng": -43.23800},
    "linha_vermelha": {"name": "Linha Vermelha (altura Caju / Fundão)", "lat": -22.88310, "lng": -43.21850},
    "linha_amarela": {"name": "Linha Amarela (Saída 4 / Inhaúma)", "lat": -22.87950, "lng": -43.27980},
    "av_brasil": {"name": "Avenida Brasil (Bonsucesso)", "lat": -22.86430, "lng": -43.25620},
}


def match_geo_anchor(text: str) -> Optional[Dict]:
    t = text.lower()
    if any(k in t for k in ["sambódromo", "sambodromo", "apoteose", "salvador de sá", "marquês de sapucaí"]):
        return RIO_GEO_HOTSPOTS["sambodromo"]
    if any(k in t for k in ["são januário", "sao januario", "roberto dinamite", "vasco"]):
        return RIO_GEO_HOTSPOTS["sao_januario"]
    if any(k in t for k in ["nilton santos", "engenhão", "engenhao"]):
        return RIO_GEO_HOTSPOTS["nilton_santos"]
    if any(k in t for k in ["maracanã", "maracana"]):
        return RIO_GEO_HOTSPOTS["maracana"]
    if "rebouças" in t or "reboucas" in t:
        return RIO_GEO_HOTSPOTS["reboucas"]
    if any(k in t for k in ["zuzu angel", "acústico", "acustico"]):
        return RIO_GEO_HOTSPOTS["zuzu_angel"]
    if "niemeyer" in t:
        return RIO_GEO_HOTSPOTS["niemeyer"]
    if "linha vermelha" in t:
        return RIO_GEO_HOTSPOTS["linha_vermelha"]
    if "linha amarela" in t:
        return RIO_GEO_HOTSPOTS["linha_amarela"]
    if "avenida brasil" in t or "av. brasil" in t:
        return RIO_GEO_HOTSPOTS["av_brasil"]
    return None


def fetch_cor_rio_open_data_incidents() -> List[Dict]:
    """
    Busca ocorrências oficiais em tempo real na API do COR-Rio
    e converte em alertas táticos para city_hazards.
    """
    print("🏛️ Consultando API Oficial do Centro de Operações Rio (COR-Rio / Dados Abertos)...")
    hazards: List[Dict] = []
    now = datetime.now(RJ_TZ)

    try:
        resp = requests.get(COR_API_URL, headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            print(f" [WARN] COR-Rio API retornou status {resp.status_code}")
            return []

        posts = resp.json()
        print(f" -> {len(posts)} publicações oficiais recebidas do COR.")

        for p in posts:
            title = p.get("title", {}).get("rendered", "")
            raw_html = p.get("content", {}).get("rendered", "")
            post_date = p.get("date", "")
            link = p.get("link", "")
            post_id = p.get("id")

            soup = BeautifulSoup(raw_html, "html.parser")
            body_text = soup.get_text(" ", strip=True)
            blob = f"{title} {body_text}".lower()

            # Filtra publicações relevantes para a mobilidade do táxi
            is_relevant = any(k in blob for k in [
                "interdiç", "interdita", "cet-rio", "trânsito", "acidente", "bloqueio",
                "estádio", "sambódromo", "manutenção", "bolsão", "alagamento"
            ])
            if not is_relevant:
                continue

            geo = match_geo_anchor(blob)
            if not geo:
                continue

            # Classifica o tipo de ocorrência
            if "acidente" in blob:
                rep_type = "ROAD_CLOSED"
                ttl = timedelta(hours=3)
            elif "interdiç" in blob or "bloqueio" in blob or "esquema especial" in blob:
                rep_type = "ROAD_CLOSED"
                ttl = timedelta(hours=8)
            elif "trânsito" in blob or "lentidão" in blob or "retenção" in blob:
                rep_type = "HEAVY_TRAFFIC"
                ttl = timedelta(hours=2)
            else:
                rep_type = "ROAD_CLOSED"
                ttl = timedelta(hours=4)

            # Extração de ruas fechadas específicas se houver listagem
            streets_found = re.findall(r'[–-]\s*([A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç\w\s]+(?:Avenida|Rua|Travessa|Viaduto|Túnel)[a-záéíóúâêôãõç\w\s]*)', body_text)
            street_label = geo["name"]
            if streets_found:
                street_label = f"{geo['name']} ({', '.join(streets_found[:2])})"

            hazard_id = f"cor_{post_id}"

            hazards.append({
                "id": hazard_id,
                "type": rep_type,
                "lng": geo["lng"],
                "lat": geo["lat"],
                "street": street_label[:140],
                "origin": "cor_rio",
                "created_at": now.isoformat(),
                "expires_at": (now + ttl).isoformat(),
                "active": True,
            })

    except Exception as e:
        print(f"❌ Erro ao consumir API COR-Rio: {e}")

    return hazards


def sync_cor_hazards_to_supabase(hazards: List[Dict]):
    if not hazards:
        print("⚠️ Nenhuma ocorrência nova do COR para sincronizar.")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        print(f"ℹ️ [SHOWCASE DRY-RUN] {len(hazards)} ocorrências processadas localmente (sem envio externo).")
        return

    print(f"📡 Sincronizando {len(hazards)} ocorrências oficiais do COR-Rio no Supabase...")
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        supabase.table("city_hazards").upsert(hazards, on_conflict="id").execute()
        print(f"🚀 Sucesso: {len(hazards)} ocorrências ativas em public.city_hazards!")
    except Exception as e:
        print(f"❌ Erro ao enviar ao Supabase: {e}")


if __name__ == "__main__":
    hazards = fetch_cor_rio_open_data_incidents()
    print(f"✅ Total de ocorrências qualificadas do COR-Rio: {len(hazards)}")
    for h in hazards:
        print(f" - [{h['type']}] {h['street']} (ID: {h['id']})")
    sync_cor_hazards_to_supabase(hazards)
