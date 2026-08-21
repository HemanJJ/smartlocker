#!/usr/bin/env python3
"""RAG 搜尋 v2 — 加強語意匹配 + 同義詞擴展"""
import json, sys, os, urllib.request, re

FAQ_FILE = "/Users/defi/Desktop/projects/code/羽球館CRM/venue_faq.txt"

# 同義詞映射表：使用者常說的 → FAQ 裡出現的詞
SYNONYM_MAP = {
    "小學生": ["兒童", "兒童班", "小孩", "小朋友", "孩子", "國小"],
    "教練": ["教練", "教練團", "課程", "教練群"],
    "王教練": ["王教練", "王清標", "館長"],
    "多少錢": ["費用", "收費", "價格", "價錢", "租金"],
    "怎麼去": ["地址", "交通", "停車", "位置", "在哪"],
    "停車": ["停車", "停車場", "開車", "停車位"],
    "場地": ["場地", "場館", "球場", "羽球館"],
    "營業時間": ["時間", "營業", "幾點", "開放"],
    "預約": ["預約", "預訂", "訂場", "租場"],
    "電話": ["電話", "手機", "聯絡", "連絡"],
    "兒童": ["兒童", "小學生", "小孩", "小朋友"],
}

def expand_query(query):
    """把使用者問題擴展成多種寫法，增加命中率"""
    expanded = [query]
    for word, synonyms in SYNONYM_MAP.items():
        if word in query:
            for syn in synonyms:
                expanded.append(query.replace(word, syn))
    # 也反過來：如果 query 含同義詞，擴回主詞
    for word, synonyms in SYNONYM_MAP.items():
        for syn in synonyms:
            if syn in query:
                expanded.append(query.replace(syn, word))
    return list(set(expanded))

def load_faq_chunks():
    if not os.path.exists(FAQ_FILE):
        return []
    text = open(FAQ_FILE, encoding="utf-8").read()
    # 用分隔線切成區塊
    chunks = re.split(r"━{3,}", text)
    chunks = [c.strip() for c in chunks if len(c.strip()) > 50]
    
    # 再針對 ▸ 標題切成更細的段落，提高精度
    fine_chunks = []
    for chunk in chunks:
        sections = re.split(r"(?=▸)", chunk)
        for sec in sections:
            sec = sec.strip()
            if len(sec) > 30:
                fine_chunks.append(sec)
    return fine_chunks if fine_chunks else chunks

def get_embedding(text):
    data = json.dumps({"model": "bge-m3", "prompt": text[:2000]}).encode()
    req = urllib.request.Request(
        "http://localhost:11434/api/embeddings", data=data,
        headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())["embedding"]

def cosine_sim(a, b):
    dot = sum(x*y for x,y in zip(a,b))
    na = sum(x*x for x in a)**0.5
    nb = sum(x*x for x in b)**0.5
    return dot/(na*nb) if na>0 and nb>0 else 0

def search(query, top_k=3):
    chunks = load_faq_chunks()
    if not chunks:
        return []

    # 1. 先算每段的向量
    print(f"[RAG] 載入 {len(chunks)} 段 FAQ", file=sys.stderr)

    # 2. 擴展查詢
    queries = expand_query(query)
    print(f"[RAG] 擴展成 {len(queries)} 種問法", file=sys.stderr)

    # 3. 每種問法都比一次，取最高分
    chunk_scores = {i: 0 for i in range(len(chunks))}
    for q in queries:
        try:
            q_vec = get_embedding(q)
            for i, chunk in enumerate(chunks):
                d_vec = get_embedding(chunk[:1500])
                score = cosine_sim(q_vec, d_vec)
                if score > chunk_scores[i]:
                    chunk_scores[i] = score
        except:
            continue

    # 4. 排序取 top_k
    ranked = sorted(chunk_scores.items(), key=lambda x: x[1], reverse=True)
    results = []
    for i, score in ranked[:top_k]:
        if score > 0.3:  # 相似度太低就不回傳
            results.append({
                "content": chunks[i][:500],
                "score": round(score, 3)
            })
    return results

if __name__ == "__main__":
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    results = search(query)
    print(json.dumps(results, ensure_ascii=False))
