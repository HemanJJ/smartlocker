#!/bin/bash
# 一鍵部署 smartlocker：讀取 .vercel-token，免每次登入
# ⚠️ Vercel project 的 Root Directory = web（git push 用）。
#    所以 CLI 要「從 repo 根目錄」跑，Root Directory 才會解析到 web/。
#    根目錄有 .vercelignore（只上傳 web/）＋ .vercel 專案連結。
set -e
cd "$(dirname "$0")/.."   # repo 根目錄（smartlocker/）
TOKEN=$(tr -d '[:space:]' < web/.vercel-token 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "❌ 找不到 web/.vercel-token（請先放 token）"
  exit 1
fi
vercel --prod --token="$TOKEN" "$@"
