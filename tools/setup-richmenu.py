#!/usr/bin/env python3
"""
LINE Rich Menu 設定工具
用法:
  python3 tools/setup-richmenu.py create          # 建立 Rich Menu
  python3 tools/setup-richmenu.py list            # 列出現有 Rich Menu
  python3 tools/setup-richmenu.py delete <id>     # 刪除
  python3 tools/setup-richmenu.py set-default <id> # 設為預設

需要環境變數: LINE_CHANNEL_ACCESS_TOKEN
"""
import os, sys, json, requests

TOKEN = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "")
API = "https://api.line.me/v2/bot/richmenu"
IMG_API = "https://api-data.line.me/v2/bot/richmenu/{id}/content"

HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

RICH_MENU = {
    "size": {"width": 2500, "height": 1686},
    "selected": True,
    "name": "羽拍有約主選單-v3",
    "chatBarText": "開啟選單",
    "areas": [
        {
            "bounds": {"x": 0, "y": 140, "width": 1250, "height": 515},
            "action": {"type": "message", "label": "查詢訂單", "text": "查詢訂單"}
        },
        {
            "bounds": {"x": 1250, "y": 140, "width": 1250, "height": 515},
            "action": {"type": "uri", "label": "預訂場地", "uri": "https://liff.line.me/1660947211-e5z12ax6"}
        },
        {
            "bounds": {"x": 0, "y": 655, "width": 1250, "height": 515},
            "action": {"type": "message", "label": "價目表", "text": "價目表"}
        },
        {
            "bounds": {"x": 1250, "y": 655, "width": 1250, "height": 515},
            "action": {"type": "uri", "label": "我的訂位", "uri": "https://difly-booking.vercel.app/bookings"}
        },
        {
            "bounds": {"x": 0, "y": 1170, "width": 1250, "height": 516},
            "action": {"type": "message", "label": "用品商城", "text": "用品商城"}
        },
        {
            "bounds": {"x": 1250, "y": 1170, "width": 1250, "height": 516},
            "action": {"type": "message", "label": "聯絡客服", "text": "客服"}
        }
    ]
}

def create():
    if not TOKEN:
        print("❌ 請設定 LINE_CHANNEL_ACCESS_TOKEN")
        sys.exit(1)

    print("→ 建立 Rich Menu...")
    r = requests.post(API, headers=HEADERS, json=RICH_MENU)
    if r.status_code != 200:
        print(f"❌ 建立失敗: {r.status_code} {r.text}")
        sys.exit(1)
    menu_id = r.json().get("richMenuId")
    print(f"✅ 已建立: {menu_id}")

    img_path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                            "web/public/liff/rich-menu-stringing.png")
    if not os.path.exists(img_path):
        print(f"⚠️  找不到圖片: {img_path}")
        print(f"   Rich Menu ID 保留: {menu_id}")
        return menu_id

    print("→ 上傳圖片...")
    with open(img_path, "rb") as f:
        h = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "image/png"}
        r = requests.post(IMG_API.format(id=menu_id), headers=h, data=f)
    if r.status_code != 200:
        print(f"❌ 上傳失敗: {r.status_code} {r.text}")
        return menu_id

    print("✅ 圖片上傳完成")
    print("→ 設為預設選單...")
    r = requests.post(f"https://api.line.me/v2/bot/user/all/richmenu/{menu_id}",
                      headers=HEADERS)
    if r.status_code == 200:
        print("✅ 已設為預設 Rich Menu")
    else:
        print(f"⚠️  設為預設失敗: {r.status_code} {r.text}")

    print(f"\n🎉 完成！請在 LINE 上重新打開 OA 確認。")
    return menu_id

def list_menus():
    if not TOKEN:
        print("❌ 請設定 LINE_CHANNEL_ACCESS_TOKEN"); sys.exit(1)
    r = requests.get(f"{API}/list", headers=HEADERS)
    if r.status_code != 200:
        print(f"❌ 讀取失敗: {r.status_code} {r.text}"); sys.exit(1)
    menus = r.json().get("richmenus", [])
    if not menus:
        print("目前沒有 Rich Menu")
        return
    for m in menus:
        print(f"  ID: {m.get('richMenuId')}")
        print(f"  名稱: {m.get('name')}")
        print(f"  狀態: {'✅ 預設' if m.get('selected') else ''}")
        print()

def delete_menu(menu_id):
    if not TOKEN: print("❌ 請設定 LINE_CHANNEL_ACCESS_TOKEN"); sys.exit(1)
    r = requests.delete(f"{API}/{menu_id}", headers=HEADERS)
    if r.status_code == 200:
        print(f"✅ 已刪除: {menu_id}")
    else:
        print(f"❌ 刪除失敗: {r.status_code} {r.text}")

def set_default(menu_id):
    if not TOKEN: print("❌ 請設定 LINE_CHANNEL_ACCESS_TOKEN"); sys.exit(1)
    r = requests.post(f"https://api.line.me/v2/bot/user/all/richmenu/{menu_id}",
                      headers=HEADERS)
    if r.status_code == 200:
        print(f"✅ 已設為預設: {menu_id}")
    else:
        print(f"❌ 設定失敗: {r.status_code} {r.text}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 tools/setup-richmenu.py [create|list|delete <id>|set-default <id>]")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "create":
        create()
    elif cmd == "list":
        list_menus()
    elif cmd == "delete" and len(sys.argv) >= 3:
        delete_menu(sys.argv[2])
    elif cmd == "set-default" and len(sys.argv) >= 3:
        set_default(sys.argv[2])
    else:
        print("未知指令")
