"""Синхронизация живых метрик площадок (по кнопке, без расписания).

Собирает подписчиков / охваты / просмотры для:
- Telegram (свой канал «Состояние Шумкина») — Bot API getChatMemberCount;
- Instagram (ahilleon, tonyhypnosis) — Apify apify~instagram-profile-scraper;
- YouTube — Apify streamers~youtube-scraper;
- отдельный пост (AdPost) — Apify viralanalyzer~telegram-channel-scraper.

Каждая функция возвращает список словарей вида
    {"platform": str, "account": str, "metric_type": str, "value": int}
и НИКОГДА не бросает исключение наверх: ошибки логируются, возвращается
пустой список. Apify на FREE-плане — нет кредитов/лимит → логируем и пропускаем.

ВАЖНО: переменные окружения читаются в момент вызова функций (не на уровне
модуля), потому что load_dotenv() в main.py исполняется ПОСЛЕ import ads_sync.
"""

import asyncio
import logging
import os

import httpx

logger = logging.getLogger("ads_sync")

APIFY_BASE = "https://api.apify.com/v2"


def _apify_token() -> str:
    return os.environ.get("APIFY_TOKEN", "")


def _auth() -> dict:
    return {"Authorization": f"Bearer {_apify_token()}"}


async def _apify_run(client, actor_id: str, payload: dict, timeout: int = 180):
    """Запустить актор, дождаться финиша, вернуть элементы датасета (или [])."""
    if not _apify_token():
        return []
    try:
        r = await client.post(
            f"{APIFY_BASE}/acts/{actor_id}/runs", json=payload, headers=_auth()
        )
        if r.status_code >= 400:
            logger.warning("Apify %s: HTTP %s %s", actor_id, r.status_code, r.text[:200])
            return []
        data = r.json().get("data", {})
    except Exception as e:
        logger.warning("Apify %s: start failed %s", actor_id, e)
        return []

    run_id = data.get("id")
    if not run_id:
        return []

    status = data.get("status", "RUNNING")
    waited = 0
    while status not in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT") and waited < timeout:
        await asyncio.sleep(5)
        waited += 5
        try:
            st = await client.get(f"{APIFY_BASE}/acts/{actor_id}/runs/{run_id}", headers=_auth())
            if st.status_code >= 400:
                return []
            status = st.json().get("data", {}).get("status", "RUNNING")
        except Exception as e:
            logger.warning("Apify %s: poll failed %s", actor_id, e)
            return []

    if status != "SUCCEEDED":
        logger.warning("Apify %s run %s -> %s", actor_id, run_id, status)
        return []

    # Датасет может материализоваться чуть позже, чем статус стал SUCCEEDED
    # (Apify отдаёт 404 в коротком окне) — пробуем несколько раз.
    for attempt in range(4):
        try:
            items = await client.get(
                f"{APIFY_BASE}/actor-runs/{run_id}/dataset/items", headers=_auth()
            )
            if items.status_code < 400:
                return items.json()
        except Exception as e:
            logger.warning("Apify %s: dataset failed %s", actor_id, e)
        if attempt < 3:
            await asyncio.sleep(3)
    return []


def _int(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


async def collect_telegram(client: httpx.AsyncClient = None):
    """Свой канал «Состояние Шумкина» — подписчики через Bot API."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    channel = os.environ.get("STATE_OF_SHUMKIN_CHANNEL", "")
    if not token or not channel:
        return []
    own = client is None
    if client is None:
        client = httpx.AsyncClient()
    try:
        r = await client.get(
            f"https://api.telegram.org/bot{token}/getChatMemberCount",
            params={"chat_id": channel},
        )
        data = r.json()
        if not data.get("ok"):
            logger.warning("Telegram getChatMemberCount: %s", data)
            return []
        return [{
            "platform": "telegram",
            "account": "Состояние Шумкина",
            "metric_type": "followers",
            "value": _int(data["result"]),
        }]
    except Exception as e:
        logger.warning("Telegram sync failed: %s", e)
        return []
    finally:
        if own:
            await client.aclose()


async def collect_instagram(client: httpx.AsyncClient = None):
    """ahilleon + tonyhypnosis через Apify instagram-profile-scraper."""
    if not _apify_token():
        return []
    own = client is None
    if client is None:
        client = httpx.AsyncClient()
    try:
        items = await _apify_run(
            client,
            "apify~instagram-profile-scraper",
            {"usernames": ["ahilleon", "tonyhypnosis"]},
        )
        out = []
        for it in items or []:
            username = it.get("username") or it.get("inputUsername")
            followers = _int(it.get("followersCount") or it.get("followers"))
            if username and followers:
                out.append({
                    "platform": "instagram",
                    "account": username,
                    "metric_type": "followers",
                    "value": followers,
                })
        return out
    except Exception as e:
        logger.warning("Instagram sync failed: %s", e)
        return []
    finally:
        if own:
            await client.aclose()


async def collect_youtube(client: httpx.AsyncClient = None):
    """YouTube-канал через Apify streamers~youtube-channel-scraper."""
    yt_url = os.environ.get("YOUTUBE_CHANNEL_URL", "")
    if not _apify_token() or not yt_url:
        return []
    own = client is None
    if client is None:
        client = httpx.AsyncClient()
    try:
        items = await _apify_run(
            client,
            "streamers~youtube-channel-scraper",
            {"startUrls": [{"url": yt_url}], "maxResults": 1},
        )
        out = []
        for it in items or []:
            subs = _int(it.get("numberOfSubscribers"))
            views = _int(it.get("channelTotalViews"))
            if subs:
                out.append({"platform": "youtube", "account": "YouTube", "metric_type": "followers", "value": subs})
            if views:
                out.append({"platform": "youtube", "account": "YouTube", "metric_type": "views", "value": views})
        return out
    except Exception as e:
        logger.warning("YouTube sync failed: %s", e)
        return []
    finally:
        if own:
            await client.aclose()


def _parse_post_link(link: str):
    """'t.me/channel/post_id' → (channel, post_id)."""
    s = (link or "").strip().replace("https://", "").replace("http://", "")
    if s.startswith("t.me/"):
        s = s[len("t.me/"):]
    parts = [p for p in s.split("/") if p]
    if len(parts) >= 2:
        return parts[0], parts[1]
    return (parts[0] if parts else ""), ""


async def collect_post_views(link: str, client: httpx.AsyncClient = None):
    """Просмотры и прирост конкретного поста через Apify telegram-channel-scraper."""
    if not _apify_token():
        return 0, 0
    channel, post_id = _parse_post_link(link)
    if not channel:
        return 0, 0
    own = client is None
    if client is None:
        client = httpx.AsyncClient()
    try:
        items = await _apify_run(
            client,
            "viralanalyzer~telegram-channel-scraper",
            {"channels": [f"https://t.me/{channel}"], "maxPostsPerChannel": 100},
            timeout=240,
        )
        for it in items or []:
            if it.get("type") != "post":
                continue
            # Скрейпер отдаёт postUrl вида https://t.me/channel/543 и postId.
            url = (it.get("postUrl") or "").rstrip("/")
            pid = str(it.get("postId") or "")
            if post_id and (url.endswith("/" + post_id) or pid == post_id):
                views = _int(it.get("views") or it.get("viewCount"))
                # Прирост подписчиков скрейпером не отдаётся — вернём 0,
                # endpoint сохранит ранее введённое вручную значение.
                return views, 0
        return 0, 0
    except Exception as e:
        logger.warning("Post refresh failed (%s): %s", link, e)
        return 0, 0
    finally:
        if own:
            await client.aclose()
