#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Импорт исторических закупок рекламы из Google Sheets в CRM.

Скачивает публичные XLSX-таблицы, парсит openpyxl (data_only=True) и пишет
в БД через SessionLocal + модели AdChannel / AdPurchase / AdPost.

Дедупликация каналов — по name: если канал с таким именем уже есть, заполняем
пустые поля (category/link/admin_nick/contact/comment/price), дубликат не создаём.

Примеры:
    python scripts/import_ads.py --dry-run            # показать счётчики без записи
    python scripts/import_ads.py                      # реальный импорт
    python scripts/import_ads.py --include-agency     # + посевы для агентства (IT/маркетинг)
"""
import argparse
import os
import re
import sys
import urllib.request
from datetime import date, datetime
from io import BytesIO
from pathlib import Path

# ── Подключаемся к БД как main.py ──────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from openpyxl import load_workbook

from packages.database.db import SessionLocal
from packages.database.models import AdChannel, AdPurchase, AdPost

USER_AGENT = "Mozilla/5.0 (compatible; crm-ads-import/1.0)"

# Слова-заголовки таблиц — подстраховка от случайного импорта шапки.
HEADER_WORDS = {
    "канал", "channel", "name", "название", "название канала", "имя",
    "ссылка", "link", "дата", "даты", "стоимость", "price", "прайс",
    "контакты", "контакт", "комментарий", "комментарии", "месяц", "охват",
    "просмотры", "прирост", "менеджер", "канал и пост",
}

# Ошибки формул Google Sheets, которые считаем пустыми.
FORMULA_ERRORS = {"#DIV/0!", "#ЗНАЧ!", "#VALUE!", "#N/A", "#ССЫЛКА!", "#ИМЯ?", "#REF!"}


# ── Вспомогательные преобразования ─────────────────────────────────────────
def cell(row, i):
    if row is None or i >= len(row):
        return None
    return row[i]


def to_str(v):
    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def clean_name(v):
    """Имя канала: убираем пробелы и ведущий @."""
    s = to_str(v).strip()
    if s.startswith("@"):
        s = s[1:].strip()
    return s


def to_float(v):
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    s = (s.replace(" ", "")
          .replace(" ", "")
          .replace(" ", "")
          .replace("₽", "")
          .replace("р.", "")
          .replace("%", "")
          .replace("—", "")
          .replace("–", "")
          .replace("−", "-"))
    if s in FORMULA_ERRORS or s in ("", "-", ".", ","):
        return 0.0
    # Тысячные разделители: "1,500" -> 1500, "12,345" -> 12345.
    # Десятичная запятая ("12,5", "12,50") не трогается.
    if re.fullmatch(r"-?\d{1,3}(,\d{3})+", s):
        s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        m = re.search(r"-?\d+(?:\.\d+)?", s)
        return float(m.group()) if m else 0.0


def to_int(v):
    return int(to_float(v))


def is_header(name):
    return clean_name(name).lower() in HEADER_WORDS


def extract_channel(link):
    """Из ссылки на канал/пост достаём имя канала (без @ и без номера поста)."""
    s = to_str(link)
    if not s:
        return ""
    if s.startswith("@"):
        return s[1:].split("/")[0].strip()
    if "://" in s:
        rest = s.split("://", 1)[1]
        parts = [p for p in rest.split("/") if p]
        tg_hosts = {"t.me", "telegram.me", "telegram.dog"}
        if parts and parts[0].split(":")[0] in tg_hosts:
            return parts[1] if len(parts) > 1 else ""
        for p in parts:
            if p.split(":")[0] not in tg_hosts:
                return p
        return ""
    return s.split("/")[0].strip()


# ── Импортёр ────────────────────────────────────────────────────────────────
class Importer:
    def __init__(self, dry_run=False, include_agency=False):
        self.dry_run = dry_run
        self.include_agency = include_agency
        self.session = SessionLocal()
        self.channels = {}          # name -> AdChannel
        self.added_channels = 0
        self.updated_channels = 0
        self.added_purchases = 0
        self.added_posts = 0
        self.skipped = {}
        self.sample_channels = []   # первые N новых имён (для dry-run)

    def skip(self, key):
        self.skipped[key] = self.skipped.get(key, 0) + 1

    def load_channels(self):
        for ch in self.session.query(AdChannel).all():
            self.channels[ch.name] = ch

    def _fill_channel(self, ch, fields):
        changed = False
        for k in ("category", "link", "admin_nick", "contact", "comment"):
            new = fields.get(k)
            if new and not getattr(ch, k):
                setattr(ch, k, new)
                changed = True
        new_price = fields.get("price")
        if new_price and not (getattr(ch, "price") or 0):
            ch.price = new_price
            changed = True
        return changed

    def get_channel(self, name, fields):
        name = clean_name(name)
        if not name:
            return None
        ch = self.channels.get(name)
        if ch is not None:
            if self._fill_channel(ch, fields):
                self.updated_channels += 1
            return ch
        ch = AdChannel(
            name=name,
            category=fields.get("category", ""),
            link=fields.get("link", ""),
            admin_nick=fields.get("admin_nick", ""),
            contact=fields.get("contact", ""),
            price=fields.get("price", 0) or 0,
            comment=fields.get("comment", ""),
        )
        self.channels[name] = ch
        self.added_channels += 1
        if len(self.sample_channels) < 40:
            self.sample_channels.append(name)
        if not self.dry_run:
            self.session.add(ch)
            self.session.flush()   # назначает ch.id для FK у закупок
        return ch

    def add_purchase(self, fields, channel=None):
        self.added_purchases += 1
        if self.dry_run:
            return
        p = AdPurchase(
            channel_id=channel.id if channel else None,
            channel_name=fields.get("channel_name", ""),
            month=fields.get("month", ""),
            manager=fields.get("manager", ""),
            date=fields.get("date", ""),
            price=fields.get("price", 0) or 0,
            discount=fields.get("discount", 0) or 0,
            final_price=fields.get("final_price", 0) or 0,
            growth=fields.get("growth", 0) or 0,
            coverage=fields.get("coverage", 0) or 0,
            err=fields.get("err", 0) or 0,
            cpm=fields.get("cpm", 0) or 0,
            link=fields.get("link", ""),
            status=fields.get("status", "оплачено") or "оплачено",
            consultations=fields.get("consultations", 0) or 0,
            clients=fields.get("clients", 0) or 0,
            sales_sum=fields.get("sales_sum", 0) or 0,
            roi=fields.get("roi", 0) or 0,
        )
        self.session.add(p)

    def add_post(self, fields):
        self.added_posts += 1
        if self.dry_run:
            return
        p = AdPost(
            channel=fields.get("channel", ""),
            link=fields.get("link", ""),
            views=fields.get("views", 0) or 0,
            subscribers_gained=fields.get("subscribers_gained", 0) or 0,
            clicks=fields.get("clicks", 0) or 0,
        )
        self.session.add(p)


# ── Обработчики таблиц (колонки по 0-индексу) ─────────────────────────────
def process_table1(ctx, ws):
    """Закупки: AdPurchase + AdChannel. Данные со строки 3."""
    for row in ws.iter_rows(min_row=3, values_only=True):
        ch_name = clean_name(cell(row, 3))
        if not ch_name or ch_name.startswith("1/") or is_header(ch_name):
            ctx.skip("t1")
            continue
        ch = ctx.get_channel(ch_name, {
            "category": to_str(cell(row, 4)),
            "admin_nick": to_str(cell(row, 5)),
        })
        ctx.add_purchase({
            "channel_name": ch_name,
            "month": to_str(cell(row, 0)),
            "manager": to_str(cell(row, 2)),
            "date": to_str(cell(row, 15)),
            "price": to_float(cell(row, 9)),
            "discount": to_float(cell(row, 10)),
            "final_price": to_float(cell(row, 12)),
            "coverage": to_int(cell(row, 8)),
            "err": to_float(cell(row, 13)),
            "cpm": to_float(cell(row, 14)),
            "status": to_str(cell(row, 24)),
        }, channel=ch)


def process_table2(ctx, ws):
    """Лист1: AdPurchase + AdChannel. Шапка в строке 1."""
    for row in ws.iter_rows(min_row=2, values_only=True):
        ch_name = clean_name(cell(row, 0))
        if (not ch_name or ch_name.upper().startswith("НЕДЕЛЯ")
                or ch_name.upper() == "МАКЕТ" or is_header(ch_name)):
            ctx.skip("t2")
            continue
        ch = ctx.get_channel(ch_name, {
            "link": to_str(cell(row, 1)),
            "comment": to_str(cell(row, 2)),
            "contact": to_str(cell(row, 3)),
        })
        ctx.add_purchase({
            "channel_name": ch_name,
            "price": to_float(cell(row, 4)),
            "date": to_str(cell(row, 6)),
            "growth": to_int(cell(row, 8)),
            "coverage": to_int(cell(row, 10)),
        }, channel=ch)


def process_table3(ctx, ws):
    """Результаты посевов СМS: AdPost. Шапка до строки 4, данные с 5."""
    for row in ws.iter_rows(min_row=5, values_only=True):
        link = to_str(cell(row, 0))
        if not link or is_header(link):
            ctx.skip("t3")
            continue
        ctx.add_post({
            "link": link,
            "channel": extract_channel(link),
            "views": to_int(cell(row, 1)),
            "subscribers_gained": to_int(cell(row, 3)),
        })


def process_table4(ctx, ws):
    """Посевы ТГ: AdPurchase + AdChannel. Шапка в строке 1."""
    for row in ws.iter_rows(min_row=2, values_only=True):
        ch_name = clean_name(cell(row, 0))
        if not ch_name or ch_name in FORMULA_ERRORS or is_header(ch_name):
            ctx.skip("t4")
            continue
        ch = ctx.get_channel(ch_name, {
            "category": to_str(cell(row, 13)),
            "link": to_str(cell(row, 14)),
        })
        ctx.add_purchase({
            "channel_name": ch_name,
            "date": to_str(cell(row, 1)),
            "price": to_float(cell(row, 3)),
            "growth": to_int(cell(row, 4)),
            "consultations": to_int(cell(row, 6)),
            "clients": to_int(cell(row, 7)),
            "sales_sum": to_float(cell(row, 8)),
            "roi": to_float(cell(row, 9)),
            "coverage": to_int(cell(row, 11)),
        }, channel=ch)


def process_table5(ctx, ws):
    """Реклама: только AdChannel. Шапка в строках 1-2."""
    for row in ws.iter_rows(min_row=3, values_only=True):
        name = clean_name(cell(row, 1))
        if not name or is_header(name):
            ctx.skip("t5")
            continue
        ctx.get_channel(name, {
            "category": to_str(cell(row, 2)),
            "link": to_str(cell(row, 3)),
            "admin_nick": to_str(cell(row, 4)),
            "price": to_float(cell(row, 5)),
            "comment": to_str(cell(row, 6)),
        })


def process_table6_sheet1(ctx, ws):
    """Закупки 2024 (Лист1): AdPurchase + AdChannel. Шапка в строке 1."""
    for row in ws.iter_rows(min_row=2, values_only=True):
        ch_name = clean_name(cell(row, 0))
        if not ch_name or ch_name in ("Итого", "Приход", "Остаток", "Потрачено") \
                or is_header(ch_name):
            ctx.skip("t6l1")
            continue
        # У AdPurchase нет поля comment — комментарий храним на канале.
        ch = ctx.get_channel(ch_name, {"comment": to_str(cell(row, 3))})
        ctx.add_purchase({
            "channel_name": ch_name,
            "price": to_float(cell(row, 2)),
        }, channel=ch)


def process_table6_sheet2(ctx, ws):
    """Закупки 2024 (Лист2): AdChannel. Шапка в строке 1."""
    for row in ws.iter_rows(min_row=2, values_only=True):
        name = clean_name(cell(row, 0))
        if not name or name.lower() in ("итого",) or is_header(name):
            ctx.skip("t6l2")
            continue
        ctx.get_channel(name, {
            "admin_nick": to_str(cell(row, 1)),
            "price": to_float(cell(row, 2)),
            "comment": to_str(cell(row, 3)),
        })


# (sheet_id, имя листа, handler, только при --include-agency)
TABLES = [
    ("1w2GvaZqfvgenEBGoltE9aoXCw6S_eQzE-5CzJKV7X2k", "Закупки", process_table1, False),
    ("13qy5P1YWIsq5PXUHJ4ZButpl3KtVhsuAwLFhcGkId6Y", "Лист1", process_table2, False),
    ("1c596UVfSQ2szD_VFni_K-QxF8p5yCm4KlfbJiQMpda8", "Результаты посевов СМS", process_table3, True),
    ("1-AbTDK4UUivwpjMBf_ZmQyflfTLSEhZaE_K8rFNzCcI", "Посевы ТГ", process_table4, False),
    ("1ulo5GkRGrv8U9LcwYTlhOA89g_DmJMg1quWCPkXdAtI", "Реклама", process_table5, False),
    ("1YO-4hEjcdyEaAYnNrIcXe3A3Q0vEyCezevE-ItYJYKk", "Лист1", process_table6_sheet1, False),
    ("1YO-4hEjcdyEaAYnNrIcXe3A3Q0vEyCezevE-ItYJYKk", "Лист2", process_table6_sheet2, False),
]


def download_xlsx(sheet_id):
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return BytesIO(r.read())


def main():
    ap = argparse.ArgumentParser(description="Импорт закупок рекламы из Google Sheets")
    ap.add_argument("--dry-run", action="store_true", help="показать счётчики без записи")
    ap.add_argument("--include-agency", action="store_true",
                    help="импортировать посевы для агентства (IT/маркетинг)")
    args = ap.parse_args()

    ctx = Importer(dry_run=args.dry_run, include_agency=args.include_agency)
    ctx.load_channels()
    print(f"Каналов в БД до импорта: {len(ctx.channels)}")

    for sheet_id, sheet_name, handler, agency_only in TABLES:
        if agency_only and not ctx.include_agency:
            print(f"Пропущена таблица {sheet_id[:8]}… («{sheet_name}») — agency (--include-agency)")
            continue
        try:
            wb = load_workbook(download_xlsx(sheet_id), data_only=True, read_only=True)
        except Exception as e:
            print(f"Ошибка скачивания {sheet_id[:8]}…: {e}")
            continue
        try:
            ws = wb[sheet_name]
        except KeyError:
            print(f"Лист «{sheet_name}» не найден в {sheet_id[:8]}… (доступны: {wb.sheetnames})")
            wb.close()
            continue
        print(f"\n=== {sheet_id[:8]}… / «{sheet_name}» ===")
        b_ch, b_p, b_po = ctx.added_channels, ctx.added_purchases, ctx.added_posts
        handler(ctx, ws)
        print(f"  +каналов {ctx.added_channels - b_ch}  "
              f"+закупок {ctx.added_purchases - b_p}  "
              f"+постов {ctx.added_posts - b_po}")
        wb.close()

    if ctx.dry_run:
        ctx.session.rollback()
        print("\n[DRY-RUN] В базу ничего не записано.")
    else:
        ctx.session.commit()
        print("\n✅ Импорт зафиксирован.")

    print(f"\nИтог: каналов +{ctx.added_channels} (обновлено {ctx.updated_channels}), "
          f"закупок +{ctx.added_purchases}, постов +{ctx.added_posts}")
    if ctx.skipped:
        print("Пропущено строк:", dict(ctx.skipped))
    if ctx.sample_channels:
        print("Примеры новых каналов:", ", ".join(ctx.sample_channels[:40]))

    total_ch = ctx.session.query(AdChannel).count()
    total_p = ctx.session.query(AdPurchase).count()
    total_po = ctx.session.query(AdPost).count()
    print(f"В БД после: каналов {total_ch}, закупок {total_p}, постов {total_po}")


if __name__ == "__main__":
    main()
