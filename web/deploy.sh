#!/bin/bash
# 一鍵部署 smartlocker：讀取 .vercel-token，免每次登入
set -e
cd "$(dirname "$0")"
TOKEN=$(tr -d '[:space:]' < .vercel-token 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "❌ 找不到 .vercel-token（請先放 token）"
  exit 1
fi
vercel --prod --token="$TOKEN" "$@"
