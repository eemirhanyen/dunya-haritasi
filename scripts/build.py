#!/usr/bin/env python3
"""
Sitenin okuduğu data/countries.json dosyasını üretir.

  data/index.json       endeks skorları (fetch_index.py)
  data/ai_history.json  günlük AI puanları (ai_score.py), varsa

Son skor = INDEX_WEIGHT × endeks + AI_WEIGHT × (AI puanının son 7 gün ortalaması).
AI puanı olmayan ülkede son skor yalnızca endekstir.
"""

import datetime as dt
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, "data", *p)

INDEX_WEIGHT = 0.5
AI_WEIGHT = 0.5
AI_WINDOW_DAYS = 7


def main():
    index = json.load(open(D("index.json"), encoding="utf-8"))
    hist = {}
    if os.path.exists(D("ai_history.json")):
        hist = json.load(open(D("ai_history.json"), encoding="utf-8")).get("countries", {})

    since = (dt.date.today() - dt.timedelta(days=AI_WINDOW_DAYS - 1)).isoformat()
    with_ai = 0
    for iso, c in index["countries"].items():
        recent = [e for e in hist.get(iso, []) if e["date"] >= since]
        c["ai"] = None
        c["ai_score"] = None
        if recent and c.get("index_score") is not None:
            avg = sum(e["score"] for e in recent) / len(recent)
            last = recent[-1]
            c["ai_score"] = round(avg, 1)
            c["ai"] = {
                "avg": round(avg, 1),
                "days": len(recent),
                "latest": {k: last.get(k) for k in ("date", "score", "confidence", "summary", "drivers", "headlines")},
                "series": [{"date": e["date"], "score": e["score"]} for e in recent],
            }
            c["final_score"] = round(INDEX_WEIGHT * c["index_score"] + AI_WEIGHT * avg, 1)
            with_ai += 1
        else:
            c["final_score"] = c.get("index_score")

    index["method"]["weights"] = {"index": INDEX_WEIGHT, "ai": AI_WEIGHT}
    index["method"]["ai_window_days"] = AI_WINDOW_DAYS
    index["method"]["countries_with_ai"] = with_ai
    index["built_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    json.dump(index, open(D("countries.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"countries.json yazıldı; AI puanı olan ülke: {with_ai}")


if __name__ == "__main__":
    main()
