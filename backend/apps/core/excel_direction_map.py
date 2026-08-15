"""MAVZULAR 14.08.2026 Excel papkasidan: kafedra → yo'nalish kodlari.

OnlineTest `Direction.name` kontingentdan kod (DI, TPI, PI, S, F, …).
Excel papkalarida to'liq nom ham, qisqa kod ham bor — shu yerda bir xil kodga
yig'iladi. `tanlov` papkasi yo'nalish emas, o'tkazib yuboriladi.
"""

from __future__ import annotations

# Kafedra nomi (Exceldagi "N. " prefikssiz) → yo'nalish kodlari.
# Tartib: shu kafedrada Excel soni kamayish tartibida.
KAFEDRA_DIRECTIONS: dict[str, list[str]] = {
    "Kommunal gigiyena": ["TPI", "BM", "DI", "FT", "F", "OHI", "PI", "S"],
    "Ovqatlanish, Bolalar va o 'smirlar gigienasi": ["TPI"],
    "Preventive tibbiyot, Jamoat salomatligi, Jismoniy tarbiya va sport": [
        "PI", "TPI", "S", "DI", "OHI", "FT",
    ],
    "Epidemiologiya va yuqumli kasalliklar, hamshiralik ishi": [
        "OHI", "DI", "PI", "TPI", "S", "XT",
    ],
    "Mikrobiologiya, Virusalogiya va immunologiya": ["TPI", "DI", "FT", "PI", "OHI", "S"],
    "Xalq tabobati va farmakologiya kafedrasi": ["F", "DI", "FT", "OHI", "PI", "TPI", "XT"],
    "Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari": [
        "BM", "FT", "DI", "OHI", "PI", "TPI", "F", "S",
    ],
    "Ichki kasallilar propedevtikasi": ["DI", "PI"],
    "Terapiya yo'nalishidagi fanlar": ["PI", "DI", "S"],
    "Travmatologiya va ortapediya": ["DI", "TPI", "XT"],
    "NORMAL ANATOMIYA": ["DI", "FT", "PI", "S", "TPI", "OHI"],
    "Gospital terapiya": ["TPI", "DI", "PI"],
    "Umumiy xirurgiya": ["DI", "PI"],
    "Fakultativ va gospital jarrohlik": ["DI"],
    "Akusherlik va ginekologiya": ["DI", "PI", "TPI"],
    "Urologiya": ["DI"],
    "Nevrologiya va Psixiatriya": ["DI", "PI", "TPI", "XT", "S"],
    "Pediatriya 1": ["DI"],
    "Pediatriya 2": ["PI", "DI"],
    "Stomatologiya va otorinoloringologiya": ["S", "DI", "PI"],
    "Dermatovenerologiya va allergologiya": ["DI", "PI"],
    "Endokrinologiya gematologiya va ftizatriya": ["PI", "DI", "FT"],
    "O'zbek va xorijiy tillar kafedrasi": ["BM", "DI", "FT", "F", "OHI", "PI", "S", "TPI"],
    "Lotin tilli, pedagogika va psixalogiya": ["FT", "OHI", "DI", "F", "PI", "S", "TPI"],
    "Tibbiy va biologik kimyo": ["F", "FT", "DI", "PI", "TPI", "OHI", "S", "BM"],
    "Ijtimoiy fanlar": ["BM", "TPI", "DI", "F", "FT", "OHI", "S", "PI"],
    "GISTOLOGIYA BIOLOGIYA": ["DI", "PI", "S"],
    "Fiziologiya": ["DI", "FT", "PI", "TPI", "F", "OHI"],
    "Patologik fiziologiya va patologik anatomiya": ["PI", "DI", "TPI", "S", "FT", "F", "OHI"],
}

# Yo'nalish kodi → asosiy kafedra (shu yo'nalishda eng ko'p Excel).
# `directions.kafedra_id` FK shu qiymatga yoziladi (eski UI / 1:1 joylar).
PRIMARY_KAFEDRA_BY_DIRECTION: dict[str, str] = {
    "BM": "Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari",
    "DI": "Patologik fiziologiya va patologik anatomiya",
    "F": "Xalq tabobati va farmakologiya kafedrasi",
    "FT": "Tibbiy va biologik kimyo",
    "OHI": "Epidemiologiya va yuqumli kasalliklar, hamshiralik ishi",
    "PI": "Pediatriya 2",
    "S": "Stomatologiya va otorinoloringologiya",
    "TPI": "Ovqatlanish, Bolalar va o 'smirlar gigienasi",
    "XT": "Nevrologiya va Psixiatriya",
}


def norm_kafedra_name(name: str) -> str:
    return " ".join((name or "").strip().lower().split())
