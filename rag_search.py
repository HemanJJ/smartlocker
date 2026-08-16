#!/usr/bin/env python3
"""RAG 搜尋：從真實 FAQ 找相關資訊"""
import json, sys, os, urllib.request, re

FAQ_FILE = "/Users/defi/Desktop/projects/code/羽球館CRM/venue_faq.txt"

def load_faq_chunks():
    if not os.path.exists(FAQ_FILE):
        return []
    text = open(FAQ_FILE, encoding="utf-8").read()
    # 用分隔線切成區塊
    chunks = re.split(r"━{3,}", text)
    chunks = [c.strip() for c in chunks if len(c.strip()) > 100]
    return chunks

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

    q_vec = get_embedding(query)
    scored = []
    for chunk in chunks:
        d_vec = get_embedding(chunk[:2000])
        score = cosine_sim(q_vec, d_vec)
        scored.append((score, chunk))

    scored.sort(reverse=True)
    return [{"content": c[:500], "score": round(s, 3)} for s, c in scored[:top_k]]

if __name__ == "__main__":
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    print(json.dumps(search(query), ensure_ascii=False))
