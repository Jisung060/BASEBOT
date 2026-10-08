import os
import re
import threading
from datetime import datetime
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from google import genai
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from database.db_connection import SessionFactory
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/news", tags=["News"])

# ============================================================
# 경로 설정
# ============================================================
# 기본 폴더 구조:
# project/
# ├─ back/
# │  └─ routers/
# │     └─ news.py
# └─ front/
#    └─ mlb_news.html
#
# 다른 위치에 HTML을 둘 경우 MLB_NEWS_HTML 환경변수로 경로를 지정하세요.
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_HTML_FILE = os.path.abspath(os.path.join(BACKEND_DIR, "..", "front", "pages", "mlb_news.html"))
HTML_FILE = os.path.abspath(os.getenv("MLB_NEWS_HTML", DEFAULT_HTML_FILE))

BASE_URL = "https://www.mlbkor.com"
NEWS_LIST_URL = BASE_URL + "/news/articleList.html"

CRAWL_INTERVAL = max(10, int(os.getenv("MLB_NEWS_INTERVAL", "30")))
MAX_LIST_ITEMS = max(1, min(int(os.getenv("MLB_NEWS_MAX_ITEMS", "20")), 100))

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/155.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": BASE_URL + "/",
}

sync_lock = threading.Lock()
_started = False


# ============================================================
# HTML 제공
# ============================================================
@router.get("/page", include_in_schema=False)
def mlb_news_page():
    """frontend 폴더의 HTML을 FastAPI가 제공한다."""
    if not os.path.isfile(HTML_FILE):
        raise HTTPException(
            status_code=404,
            detail=(
                "mlb_news.html 파일을 찾을 수 없습니다. "
                f"현재 설정된 경로: {HTML_FILE}"
            ),
        )
    return FileResponse(HTML_FILE, media_type="text/html")


# ============================================================
# DB
# ============================================================
def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()


def create_db_session():
    return SessionLocal()

# ============================================================
# 문자열/HTML 파싱
# ============================================================
def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def clean_body(value):
    lines = []
    previous = None

    for raw in (value or "").replace("\xa0", " ").splitlines():
        line = clean(raw)
        if not line or line == previous:
            continue
        lines.append(line)
        previous = line

    return "\n".join(lines).strip()


def absolute_url(href):
    return urljoin(BASE_URL, href or "")


def get_idxno(url):
    try:
        return parse_qs(urlparse(url).query).get("idxno", [""])[0]
    except Exception:
        return ""


def parse_date(value):
    text = clean(value)
    if not text:
        return ""

    # 1. 한국식 숫자 형태 (2026.10.07 14:30 또는 2026-10-07)
    match1 = re.search(r"(20\d{2})[-.년/]\s*(\d{1,2})[-.월/]\s*(\d{1,2})(?:[^\d]*(\d{1,2})[:시]\s*(\d{1,2}))?", text)
    if match1:
        y, m, d, h, mn = match1.groups()
        if h and mn:
            return f"{y}-{int(m):02d}-{int(d):02d} {int(h):02d}:{int(mn):02d}"
        return f"{y}-{int(m):02d}-{int(d):02d} 00:00"

    # 2. 영어식 날짜 형태 (Oct 5, 2026) - MLB 코리아 핵심!
    match_eng = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s*(20\d{2})", text, re.IGNORECASE)
    if match_eng:
        month_str, d, y = match_eng.groups()
        months = {"jan":1, "feb":2, "mar":3, "apr":4, "may":5, "jun":6, "jul":7, "aug":8, "sep":9, "oct":10, "nov":11, "dec":12}
        m = months.get(month_str.lower()[:3], 1)
        return f"{y}-{m:02d}-{int(d):02d} 00:00"

    # 3. 연도 생략 형태 (10.07 14:30)
    match2 = re.search(r"(\d{1,2})[-.월/]\s*(\d{1,2})[^\d]*(\d{1,2})[:시]\s*(\d{1,2})", text)
    if match2:
        m, d, h, mn = match2.groups()
        y = datetime.now().year
        return f"{y}-{int(m):02d}-{int(d):02d} {int(h):02d}:{int(mn):02d}"

    return ""

def first_text(soup, selectors):
    for selector in selectors:
        node = soup.select_one(selector)
        if node:
            text = clean(node.get_text(" ", strip=True))
            if text:
                return text
    return ""


# ============================================================
# MLB Korea 목록 수집
# ============================================================
def fetch_news_list():
    response = requests.get(NEWS_LIST_URL, headers=HEADERS, timeout=20)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # 1. HTML 전체에서 기사 고유 번호(idxno)가 포함된 링크를 싹쓸이
    links = soup.select("a[href*='idxno=']")

    result = []
    seen = set()

    for link in links:
        title = clean(link.get_text(" ", strip=True))

        # 텍스트가 비어있으면 이미지 alt 속성에서 제목 추출
        if not title:
            img = link.select_one("img")
            if img and img.get("alt"):
                title = clean(img.get("alt"))

        url = absolute_url(link.get("href", ""))

        if not title or "articleView" not in url:
            continue

        source_id = get_idxno(url)
        if not source_id or source_id in seen:
            continue

        seen.add(source_id)

        # 리스트 블록을 찾아 날짜와 이미지 추출
        block = link.find_parent(["li", "div", "article", "tr"])
        date_text = ""
        image_url = ""
        if block:
            date_text = block.get_text(" ", strip=True) if block else ""
            img_node = block.select_one("img")
            if img_node:
                image_url = absolute_url(
                    img_node.get("data-src") or img_node.get("src") or ""
                )

        result.append({
            "source_id": source_id,
            "title": title,
            "url": url,
            "published_at": parse_date(date_text),
            "image_url": image_url,
        })

    # 2. 고유 기사 번호(idxno)가 클수록 최신 기사이므로, 확실하게 번호순 내림차순 정렬!
    result.sort(key=lambda x: int(x["source_id"]) if x["source_id"].isdigit() else 0, reverse=True)

    # 3. 최대 개수(50개)까지만 잘라서 반환
    return result[:MAX_LIST_ITEMS]


# ============================================================
# 실제 기사 본문 수집
# ============================================================
def fetch_article_detail(url):
    response = requests.get(url, headers=HEADERS, timeout=20)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    title = first_text(
        soup,
        [
            "h1.article-header-title",
            ".article-header-title",
            "h1",
            ".article-title",
        ],
    )

    author = first_text(
        soup,
        [
            ".info-text",
            ".article-info .byline",
            ".article-info .author",
            ".byline",
            ".writer",
        ],
    )

    content_node = None
    content_selectors = [
        "#article-view-content-div",
        ".article-view-content",
        ".article-view",
        ".article-body",
        ".article-content",
        ".view-content",
        ".article-content-body",
        ".news-content",
        "#article-view",
    ]

    for selector in content_selectors:
        node = soup.select_one(selector)
        if node:
            content_node = node
            break

    if content_node:
        for bad in content_node.select(
            "script, style, noscript, iframe, "
            ".article-tools, .share, .sns, .advertise, .ad, "
            ".banner, .copyright"
        ):
            bad.decompose()
        content = clean_body(content_node.get_text("\n", strip=True))
    else:
        fallback = soup.select_one("main article, main, article")
        content = (
            clean_body(fallback.get_text("\n", strip=True))
            if fallback
            else ""
        )

    if not title:
        meta = soup.select_one("meta[property='og:title'], meta[name='title']")
        if meta:
            title = clean(meta.get("content", ""))

    if not author:
        meta = soup.select_one(
            "meta[name='author'], meta[property='article:author']"
        )
        if meta:
            author = clean(meta.get("content", ""))

    header = soup.select_one(".article-header, header, .article-head, .info-text, .byline")
    date_text = header.get_text(" ", strip=True) if header else soup.get_text(" ", strip=True)

    image = soup.select_one("meta[property='og:image']")
    image_url = absolute_url(image.get("content", "")) if image else ""

    return {
        "title": title,
        "author": author,
        "published_at": parse_date(date_text),
        "content": content,
        "image_url": image_url,
    }


# ============================================================
# DB 저장 / 중복 방지
# ============================================================
def upsert_news(item):
    db = SessionFactory()

    try:
        # -----------------------------------------------------
        # 기존 기사 확인
        # -----------------------------------------------------
        existing = db.execute(
            text("""
                SELECT news_id
                FROM mlb_news
                WHERE source_id = :source_id
                   OR source_url = :source_url
                LIMIT 1
            """),
            {
                "source_id": item["source_id"],
                "source_url": item["url"],
            },
        ).mappings().first()

        # -----------------------------------------------------
        # 기존 기사 → UPDATE
        # -----------------------------------------------------
        if existing:

            db.execute(
                text("""
                    UPDATE mlb_news
                    SET
                        title = :title,

                        author =
                            CASE
                                WHEN :author <> ''
                                THEN :author
                                ELSE author
                            END,

                        published_at =
                            CASE
                                WHEN :published_at IS NOT NULL
                                     AND :published_at <> ''
                                THEN :published_at
                                ELSE published_at
                            END,

                        content =
                            CASE
                                WHEN :content <> ''
                                THEN :content
                                ELSE content
                            END,

                        image_url =
                            CASE
                                WHEN :image_url <> ''
                                THEN :image_url
                                ELSE image_url
                            END,

                        updated_at = CURRENT_TIMESTAMP

                    WHERE news_id = :news_id
                """),
                {
                    "title": item["title"],
                    "author": item.get("author", ""),
                    "published_at": item.get("published_at", ""),
                    "content": item.get("content", ""),
                    "image_url": item.get("image_url", ""),
                    "news_id": existing["news_id"],
                },
            )

            db.commit()

            return existing["news_id"], False

        # -----------------------------------------------------
        # 신규 기사 → INSERT
        # -----------------------------------------------------
        result = db.execute(
            text("""
                INSERT INTO mlb_news (
                    source_id,
                    source_url,
                    source_name,
                    title,
                    author,
                    published_at,
                    crawled_at,
                    content,
                    summary,
                    image_url,
                    category,
                    is_new,
                    is_featured,
                    view_count,
                    status
                )
                VALUES (
                    :source_id,
                    :source_url,
                    'MLB Korea',
                    :title,
                    :author,
                    :published_at,
                    CURRENT_TIMESTAMP,
                    :content,
                    '',
                    :image_url,
                    :category,
                    TRUE,
                    FALSE,
                    0,
                    'ACTIVE'
                )
            """),
            {
                "source_id": item["source_id"],
                "source_url": item["url"],
                "title": item["title"],
                "author": item.get("author", ""),
                "published_at": item.get("published_at") or None,
                "content": item.get("content", ""),
                "image_url": item.get("image_url", ""),
                "category": item.get("category"),
            },
        )

        db.commit()

        return result.lastrowid, True

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()
# ============================================================
# 동기화
# ============================================================
def sync_news():
    if not sync_lock.acquire(blocking=False):
        return {"status": "busy", "new": 0, "updated": 0}

    try:
        listed = fetch_news_list()
        new_count = 0
        updated_count = 0

        for item in reversed(listed):
            db = SessionFactory()

            try:
                existing = db.execute(
                    text("""
                         SELECT news_id, content
                         FROM mlb_news
                         WHERE source_id = :source_id
                            OR source_url = :source_url LIMIT 1
                         """),
                    {
                        "source_id": item["source_id"],
                        "source_url": item["url"],
                    },
                ).mappings().first()

            finally:
                db.close()

            # 신규 기사 또는 본문이 비어 있는 기존 기사만 상세 페이지까지 수집.
            if existing is None or not existing["content"]:
                try:
                    detail = fetch_article_detail(item["url"])
                    for key, value in detail.items():
                        if value:
                            item[key] = value
                except Exception as exc:
                    print(f"[MLB] 상세 기사 수집 실패: {item['url']} / {exc}")

            _, is_new = upsert_news(item)
            if is_new:
                new_count += 1
            else:
                updated_count += 1

        return {
            "status": "success",
            "checked": len(listed),
            "new": new_count,
            "updated": updated_count,
        }
    finally:
        sync_lock.release()


# ============================================================
# 30초 백그라운드 수집
# ============================================================
def crawler_loop():
    try:
        print("[MLB] 최초 동기화:", sync_news())
    except Exception as exc:
        print("[MLB] 최초 동기화 실패:", exc)

    while True:
        threading.Event().wait(CRAWL_INTERVAL)
        try:
            print(f"[MLB] {CRAWL_INTERVAL}초 동기화:", sync_news())
        except Exception as exc:
            print("[MLB] 자동 동기화 실패:", exc)


def start_background_crawler():
    global _started
    if _started:
        return

    _started = True
    threading.Thread(
        target=crawler_loop,
        name="mlb-news-crawler",
        daemon=True,
    ).start()


# ============================================================
# API
# ============================================================
@router.get("/mlb")
def get_mlb_news(
    limit: int = 20,
    page: int = 1
):
    limit = max(1, min(limit, 100))
    page = max(1, page)

    offset = (page - 1) * limit

    db = SessionFactory()

    try:

        rows = db.execute(
            text("""
                SELECT
                    news_id,
                    source_id,
                    title,
                    source_url,
                    author,
                    published_at,
                    image_url,
                    summary,
                    is_new,
                    is_featured,
                    view_count,
                    category,
                    related_team_id,
                    related_player_id,

                    CASE
                        WHEN content IS NOT NULL
                             AND content <> ''
                        THEN 1
                        ELSE 0
                    END AS has_content

                FROM mlb_news

                WHERE status = 'ACTIVE'

                ORDER BY
                    published_at DESC,
                    news_id DESC

                LIMIT :limit
                OFFSET :offset
            """),
            {
                "limit": limit,
                "offset": offset,
            },
        ).mappings().all()

        data = []

        for number, row in enumerate(rows, 1):

            data.append({
                "id": row["news_id"],
                "source_id": row["source_id"],
                "number": number,
                "title": row["title"],
                "url": row["source_url"],
                "author": row["author"],
                "date": row["published_at"],
                "image_url": row["image_url"],
                "summary": row["summary"],
                "is_new": bool(row["is_new"]),
                "is_featured": bool(row["is_featured"]),
                "view_count": row["view_count"],
                "category": row["category"],
                "related_team_id": row["related_team_id"],
                "related_player_id": row["related_player_id"],
                "has_content": bool(row["has_content"]),
            })

        return {
            "status": "success",
            "page": page,
            "limit": limit,
            "data": data,
            "updated_at": datetime.now().isoformat(),
            "next_crawl_seconds": CRAWL_INTERVAL,
        }

    finally:
        db.close()
@router.get("/mlb/{news_id}")
def get_article(news_id: int):

    db = SessionFactory()

    try:

        row = db.execute(
            text("""
                SELECT
                    news_id,
                    source_id,
                    title,
                    source_url,
                    author,
                    published_at,
                    content,
                    image_url,
                    summary,
                    category,
                    related_team_id,
                    related_player_id,
                    view_count
                FROM mlb_news
                WHERE news_id = :news_id
                  AND status = 'ACTIVE'
            """),
            {
                "news_id": news_id
            },
        ).mappings().first()

        if not row:
            raise HTTPException(
                status_code=404,
                detail="기사를 찾을 수 없습니다."
            )

        # 조회수 증가
        db.execute(
            text("""
                UPDATE mlb_news
                SET view_count = view_count + 1
                WHERE news_id = :news_id
            """),
            {
                "news_id": news_id
            },
        )

        db.commit()

        return {
            "status": "success",
            "data": dict(row)
        }

    finally:
        db.close()

# ============================================================
# Gemini 3줄 요약
# ============================================================
def ai_summary(title, content):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:
        raise HTTPException(
            503,
            "GEMINI_API_KEY가 설정되지 않았습니다. 환경변수를 먼저 설정하세요.",
        )

    model = os.getenv(
        "GEMINI_MODEL",
        "gemini-3.5-flash-lite"
    )

    client = genai.Client(
        api_key=api_key
    )

    prompt = f"""
너는 한국어 MLB 뉴스 편집자다.

아래 기사 본문만 근거로 핵심 내용을 정확하게 요약해라.
추측하거나 기사에 없는 내용을 추가하지 마라.

반드시 정확히 3개의 번호 문장으로 작성해라.

각 문장은 짧고 명확하게 작성하고,
읽기 편하게 한 줄씩 출력해라.

기사 제목:
{title}

기사 본문:
{content[:30000]}

정확히 3줄로 요약해줘.
"""

    response = client.models.generate_content(
        model=model,
        contents=prompt,
    )

    result = (response.text or "").strip()

    if not result:
        raise RuntimeError(
            "Gemini가 요약을 반환하지 않았습니다."
        )

    return result


@router.get("/summary/{news_id}")
def get_summary(news_id: int):

    db = SessionFactory()

    try:

        row = db.execute(
            text("""
                SELECT
                    news_id,
                    title,
                    content,
                    summary
                FROM mlb_news
                WHERE news_id = :news_id
                  AND status = 'ACTIVE'
            """),
            {
                "news_id": news_id
            },
        ).mappings().first()

        if not row:
            raise HTTPException(
                status_code=404,
                detail="기사를 찾을 수 없습니다."
            )

        if row["summary"]:
            return {
                "status": "success",
                "summary": row["summary"],
                "cached": True,
            }

        if not row["content"]:
            raise HTTPException(
                status_code=422,
                detail="기사 본문이 아직 수집되지 않았습니다."
            )

        try:
            summary = ai_summary(
                row["title"],
                row["content"]
            )

        except requests.HTTPError as exc:

            detail = "OpenAI API 요청에 실패했습니다."

            try:
                detail = (
                    exc.response.json()
                    .get("error", {})
                    .get("message")
                    or detail
                )
            except Exception:
                pass

            raise HTTPException(
                status_code=502,
                detail=detail
            )

        db.execute(
            text("""
                UPDATE mlb_news
                SET
                    summary = :summary,
                    updated_at = CURRENT_TIMESTAMP
                WHERE news_id = :news_id
            """),
            {
                "summary": summary,
                "news_id": news_id,
            },
        )

        db.commit()

        return {
            "status": "success",
            "summary": summary,
            "cached": False,
        }

    finally:
        db.close()

# news.py가 import될 때 자동으로 30초 수집기를 시작한다.
# 단일 Uvicorn 프로세스(local 개발) 기준으로 사용한다.
start_background_crawler()
