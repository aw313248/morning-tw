#!/usr/bin/env python3
"""
MORNING TW — 早餐店 Logo 自動抓取工具
======================================
策略：
  1. 用 Google 搜尋店家的 Facebook / Instagram 官方粉專
  2. 抓取 FB 粉專大頭貼（公開頁面不需要 API Key）
  3. 用 rembg 去背
  4. 輸出為正方形 PNG，存到 img/logos/{id}.png

安裝：
  pip install requests rembg pillow beautifulsoup4 lxml

執行：
  python3 scripts/fetch_logos.py
  python3 scripts/fetch_logos.py --id tc016        # 只跑指定店家
  python3 scripts/fetch_logos.py --no-rembg        # 跳過去背（快速測試）
"""

import os, sys, re, json, time, argparse
from pathlib import Path
from io import BytesIO
from urllib.parse import quote_plus, urlparse

import requests
from bs4 import BeautifulSoup

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    print("❌ pip install pillow"); sys.exit(1)

try:
    from rembg import remove as rembg_remove
    HAS_REMBG = True
except ImportError:
    HAS_REMBG = False
    print("⚠️  rembg 未安裝，將跳過去背 (pip install rembg)")

OUTPUT_DIR = Path("img/logos")
DATA_FILE  = Path("data/breakfasts.json")
IMG_SIZE   = 256    # 輸出邊長 px
DELAY      = 2.5    # 搜尋間隔秒數

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

# ─── Google 搜尋，找 FB / IG 頁面連結 ───────────────────────────

def google_search(query: str, num: int = 5) -> list[str]:
    """回傳 Google 搜尋結果的 URL 列表（優先 FB/IG）"""
    url = f"https://www.google.com/search?q={quote_plus(query)}&num={num}"
    try:
        r = SESSION.get(url, timeout=10)
        soup = BeautifulSoup(r.text, "lxml")
        links = []
        for a in soup.select("a[href]"):
            href = a["href"]
            if href.startswith("/url?q="):
                href = href[7:].split("&")[0]
            if href.startswith("http") and any(d in href for d in ["facebook.com", "instagram.com"]):
                links.append(href)
        return links[:num]
    except Exception as e:
        print(f"    Google 搜尋失敗: {e}")
        return []

# ─── 從 URL 提取 FB 粉專名稱 ──────────────────────────────────

def extract_fb_id(url: str) -> str | None:
    """
    從 FB URL 提取頁面 ID 或用戶名
    例：https://www.facebook.com/some.page.name → some.page.name
    """
    patterns = [
        r"facebook\.com/pages/[^/]+/(\d+)",   # 舊式 /pages/NAME/ID
        r"facebook\.com/profile\.php\?id=(\d+)",  # profile.php?id=
        r"facebook\.com/([^/?#&]+)",            # 一般用戶名
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            val = m.group(1)
            # 過濾掉非頁面的路徑
            if val not in ("sharer", "share", "login", "help", "groups", "events", "watch", "marketplace", "gaming"):
                return val
    return None

# ─── 抓 FB 大頭貼 ──────────────────────────────────────────────

def fetch_fb_avatar(fb_id: str) -> bytes | None:
    """
    透過 Facebook Graph API 公開端點抓大頭貼
    不需要 Access Token，適用於公開粉絲專頁
    """
    # 方法 1：Graph API (最可靠)
    urls_to_try = [
        f"https://graph.facebook.com/{fb_id}/picture?type=large&redirect=true",
        f"https://graph.facebook.com/{fb_id}/picture?type=square&redirect=true",
        f"https://www.facebook.com/{fb_id}/photo",
    ]
    for url in urls_to_try:
        try:
            r = SESSION.get(url, timeout=15, allow_redirects=True)
            ct = r.headers.get("content-type", "")
            if r.status_code == 200 and "image" in ct and len(r.content) > 2000:
                return r.content
        except Exception:
            continue
    return None

# ─── 抓 IG 大頭貼 ──────────────────────────────────────────────

def extract_ig_username(url: str) -> str | None:
    m = re.search(r"instagram\.com/([^/?#&]+)", url)
    if m:
        username = m.group(1)
        if username not in ("p", "reel", "explore", "accounts", "stories"):
            return username
    return None

def fetch_ig_avatar(username: str) -> bytes | None:
    """從 IG 頁面 OG 圖標抓大頭貼"""
    try:
        r = SESSION.get(f"https://www.instagram.com/{username}/", timeout=15)
        soup = BeautifulSoup(r.text, "lxml")
        # OG image
        og = soup.find("meta", property="og:image")
        if og and og.get("content"):
            img_r = SESSION.get(og["content"], timeout=15)
            if img_r.status_code == 200 and len(img_r.content) > 2000:
                return img_r.content
    except Exception:
        pass
    return None

# ─── 圖片處理 ──────────────────────────────────────────────────

def remove_background(data: bytes) -> bytes:
    if not HAS_REMBG:
        return data
    try:
        return rembg_remove(data)
    except Exception as e:
        print(f"    去背失敗: {e}")
        return data

def process_image(data: bytes, do_rembg: bool = True) -> Image.Image:
    img = Image.open(BytesIO(data)).convert("RGBA")

    if do_rembg and HAS_REMBG:
        data2 = remove_background(data)
        img = Image.open(BytesIO(data2)).convert("RGBA")

    # 縮放到正方形
    img.thumbnail((IMG_SIZE, IMG_SIZE), Image.LANCZOS)
    canvas = Image.new("RGBA", (IMG_SIZE, IMG_SIZE), (0, 0, 0, 0))
    x = (IMG_SIZE - img.width)  // 2
    y = (IMG_SIZE - img.height) // 2
    canvas.paste(img, (x, y), img)
    return canvas

# ─── 主流程 ────────────────────────────────────────────────────

def process_shop(shop: dict, output_dir: Path, do_rembg: bool = True) -> bool:
    shop_id   = shop["id"]
    name      = shop["name"]
    district  = shop.get("district", "台中")

    out = output_dir / f"{shop_id}.png"
    if out.exists():
        print(f"  ✅ {name} — 已存在，跳過")
        return True

    print(f"  🔍 搜尋 {name} 的 FB/IG 粉專...")

    # 搜尋 FB 和 IG
    queries = [
        f"{name} {district} 台中 site:facebook.com",
        f"{name} 台中 facebook 粉絲專頁",
        f"{name} {district} 台中 site:instagram.com",
        f"{name} 台中 instagram",
    ]

    avatar_data = None

    for q in queries:
        links = google_search(q)
        if not links:
            time.sleep(1)
            continue

        for link in links:
            # 嘗試 Facebook
            if "facebook.com" in link:
                fb_id = extract_fb_id(link)
                if fb_id:
                    print(f"    FB 找到: facebook.com/{fb_id}")
                    avatar_data = fetch_fb_avatar(fb_id)
                    if avatar_data:
                        print(f"    📥 FB 大頭貼下載成功 ({len(avatar_data)//1024}KB)")
                        break

            # 嘗試 Instagram
            elif "instagram.com" in link:
                ig_user = extract_ig_username(link)
                if ig_user:
                    print(f"    IG 找到: instagram.com/{ig_user}")
                    avatar_data = fetch_ig_avatar(ig_user)
                    if avatar_data:
                        print(f"    📥 IG 大頭貼下載成功 ({len(avatar_data)//1024}KB)")
                        break

        if avatar_data:
            break

        time.sleep(1.5)

    if not avatar_data:
        print(f"  ❌ {name} — 找不到 FB/IG 大頭貼")
        return False

    # 去背 + 輸出
    print(f"  ✂️  處理圖片中...")
    try:
        img = process_image(avatar_data, do_rembg=do_rembg)
        img.save(out, "PNG", optimize=True)
        print(f"  ✅ {name} → {out}")
        return True
    except Exception as e:
        print(f"  ❌ {name} 圖片處理失敗: {e}")
        return False

# ─── CLI ───────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="MORNING TW Logo 抓取工具")
    parser.add_argument("--id",       help="只處理指定 shop ID（例如 tc016）")
    parser.add_argument("--no-rembg", action="store_true", help="跳過去背")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with open(DATA_FILE, encoding="utf-8") as f:
        shops = json.load(f)

    if args.id:
        shops = [s for s in shops if s["id"] == args.id]
        if not shops:
            print(f"找不到 ID: {args.id}")
            return

    do_rembg = not args.no_rembg
    print(f"共 {len(shops)} 間店家 | 去背: {'開' if do_rembg else '關'}\n")

    ok = 0
    for i, shop in enumerate(shops, 1):
        print(f"[{i}/{len(shops)}] {shop['name']} ({shop['district']})")
        if process_shop(shop, OUTPUT_DIR, do_rembg):
            ok += 1
        print()
        if i < len(shops):
            time.sleep(DELAY)

    print(f"完成：{ok}/{len(shops)} 間成功")
    print(f"Logo 存放於：{OUTPUT_DIR.absolute()}")

if __name__ == "__main__":
    main()
