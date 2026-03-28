#!/usr/bin/env python3
"""
MORNING TW — 早餐店 Logo 自動抓取＋去背工具
============================================

功能：
  1. 從 Google 搜尋早餐店圖片
  2. 自動下載最適合的 logo
  3. 去背（透明背景）
  4. 輸出為正方形 PNG，存到 img/logos/

使用前安裝：
  pip install requests rembg pillow beautifulsoup4

執行：
  python3 scripts/fetch_logos.py

注意：
  - Google 搜尋有速率限制，建議每次不要超過 20 間店
  - 抓到的圖不一定是 logo，需要人工確認
  - 去背效果視圖片而定，複雜背景效果較差
"""

import os
import json
import time
import requests
from pathlib import Path
from io import BytesIO

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False
    print("⚠️  需要安裝 Pillow: pip install pillow")

try:
    from rembg import remove
    HAS_REMBG = True
except ImportError:
    HAS_REMBG = False
    print("⚠️  需要安裝 rembg: pip install rembg")


# ── 設定 ──
OUTPUT_DIR = Path("img/logos")
DATA_FILE  = Path("data/breakfasts.json")
IMG_SIZE   = 200   # 輸出圖片的邊長（px）
DELAY      = 2.0   # 每次搜尋間隔（秒），避免被 block

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


def load_shops():
    """讀取早餐店資料"""
    with open(DATA_FILE, encoding="utf-8") as f:
        return json.load(f)


def search_logo_url(shop_name: str, city: str) -> str | None:
    """
    用 Bing Image Search 搜尋 logo
    回傳第一個找到的圖片 URL，找不到則回傳 None
    """
    query = f"{shop_name} {city} logo 圖示"
    url = "https://www.bing.com/images/search"
    params = {
        "q": query,
        "form": "HDRSC2",
        "first": 1,
        "tsc": "ImageBasicHover",
    }

    try:
        resp = requests.get(url, params=params, headers=HEADERS, timeout=10)
        resp.raise_for_status()

        # 從 HTML 中找圖片 URL（簡單解析）
        html = resp.text
        img_urls = []

        # 找 murl 格式的圖片 URL
        import re
        pattern = r'"murl":"(https?://[^"]+\.(?:png|jpg|jpeg|webp))"'
        matches = re.findall(pattern, html)
        img_urls.extend(matches)

        # 過濾掉太小的圖或不合適的
        for img_url in img_urls[:5]:
            if any(bad in img_url.lower() for bad in ['placeholder', 'icon-missing']):
                continue
            return img_url

    except Exception as e:
        print(f"  ⚠️  搜尋失敗: {e}")

    return None


def download_image(url: str) -> Image.Image | None:
    """下載圖片並回傳 PIL Image"""
    if not HAS_PILLOW:
        return None
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGBA")
        return img
    except Exception as e:
        print(f"  ⚠️  下載失敗: {e}")
        return None


def remove_background(img: Image.Image) -> Image.Image:
    """去背，回傳透明背景的圖片"""
    if not HAS_REMBG:
        return img

    try:
        img_bytes = BytesIO()
        img.save(img_bytes, format="PNG")
        img_bytes.seek(0)

        result_bytes = remove(img_bytes.getvalue())
        result = Image.open(BytesIO(result_bytes)).convert("RGBA")
        return result
    except Exception as e:
        print(f"  ⚠️  去背失敗: {e}")
        return img


def resize_to_square(img: Image.Image, size: int = IMG_SIZE) -> Image.Image:
    """
    將圖片縮放並置中到正方形畫布
    保持比例，背景為透明
    """
    # 縮放到適合的大小
    img.thumbnail((size, size), Image.LANCZOS)

    # 建立透明正方形畫布
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - img.width) // 2, (size - img.height) // 2)
    canvas.paste(img, offset, img if img.mode == "RGBA" else None)

    return canvas


def process_shop(shop: dict, output_dir: Path) -> bool:
    """
    處理單一店家的 logo
    回傳是否成功
    """
    shop_id   = shop["id"]
    shop_name = shop["name"]
    city      = shop.get("city", "台中市")

    output_path = output_dir / f"{shop_id}.png"

    # 如果已存在就跳過
    if output_path.exists():
        print(f"  ✅ {shop_name} — 已存在，跳過")
        return True

    print(f"  🔍 搜尋: {shop_name}...")

    # 1. 搜尋圖片
    img_url = search_logo_url(shop_name, city)
    if not img_url:
        print(f"  ❌ {shop_name} — 找不到圖片")
        return False

    print(f"  📥 下載中...")

    # 2. 下載
    img = download_image(img_url)
    if img is None:
        print(f"  ❌ {shop_name} — 下載失敗")
        return False

    # 3. 去背
    print(f"  ✂️  去背中...")
    img = remove_background(img)

    # 4. 縮放到正方形
    img = resize_to_square(img, IMG_SIZE)

    # 5. 儲存
    img.save(output_path, "PNG", optimize=True)
    print(f"  ✅ {shop_name} — 完成！({output_path})")

    return True


def main():
    print("=" * 50)
    print("MORNING TW — Logo 自動抓取工具")
    print("=" * 50)

    if not HAS_PILLOW or not HAS_REMBG:
        print("\n請先安裝缺少的套件：")
        print("  pip install rembg pillow requests")
        return

    # 建立輸出目錄
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 讀取店家資料
    shops = load_shops()
    print(f"\n共 {len(shops)} 間早餐店\n")

    success = 0
    for i, shop in enumerate(shops, 1):
        print(f"[{i}/{len(shops)}] {shop['name']}")
        ok = process_shop(shop, OUTPUT_DIR)
        if ok:
            success += 1

        # 避免太快被封鎖
        if i < len(shops):
            time.sleep(DELAY)

    print(f"\n完成！{success}/{len(shops)} 間處理成功")
    print(f"Logo 存放於: {OUTPUT_DIR.absolute()}")


if __name__ == "__main__":
    main()
