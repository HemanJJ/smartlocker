#!/bin/bash
# kiosk 語音 MVP 生成：所有文案 -> TTS(Meijia 台灣繁中) -> wav
V="Meijia"
gen() { # id text
  local id="$1"; shift
  say -v "$V" -r 185 -o "/tmp/${id}.aiff" "$*" 2>/dev/null
  afconvert -f WAVE -d LEI16@22050 "/tmp/${id}.aiff" "$id.wav" 2>/dev/null
  [ -f "$id.wav" ] && echo "  ✓ $id.wav ($(stat -f%z "$id.wav") bytes)" || echo "  ✗ $id FAILED"
}
echo "== ① 歡迎/行銷 =="
gen welcome-1 "歡迎光臨羽拍有約！我們提供專業的羽球拍穿線服務。"
gen marketing-1 "全館穿線服務熱烈進行中，多種頂級線材任您選擇。"
gen welcome-2 "您的球拍值得最好的線材，讓羽拍有約為您服務。"
gen marketing-2 "現場立即下單，快速穿線，讓您馬上重返球場。"
echo "== ② 引導用語 =="
gen guide-step1 "請在螢幕上選擇您的線種。"
gen guide-step2 "請選擇您想要的磅數。"
gen guide-step3 "請確認您的訂單資訊。"
gen guide-pickup "請輸入您的取件號碼。"
echo "== ③ 報幕字 =="
gen anon-order "訂單已建立！請將球拍放入開啟的格口。"
gen anon-ready "您的球拍已穿線完成，請前來取件。"
echo "== ④ 警告用語 =="
gen warn-close "請關好格口門，謝謝！"
gen warn-notclosed "格口門沒有關好，請確認關上。"
gen warn-anomaly "系統偵測到異常，請洽詢櫃檯人員。"
