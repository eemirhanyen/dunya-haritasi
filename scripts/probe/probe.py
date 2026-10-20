import json, time, urllib.request, urllib.parse
UA={"User-Agent":"Mozilla/5.0 (dunya-haritasi probe)"}
def get(u):
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60)
        return r.status, r.read()
    except Exception as e:
        return getattr(e,'code',None), str(e).encode()
print("=== GDELT")
for q in ['sourcecountry:turkey','"Turkey" sourcelang:english','sourcecountry:greece','sourcecountry:israel','sourcecountry:TU']:
    u="https://api.gdeltproject.org/api/v2/doc/doc?"+urllib.parse.urlencode({"query":q,"mode":"artlist","maxrecords":"8","timespan":"72h","format":"json","sort":"hybridrel"})
    st,b=get(u)
    print(q, st, len(b))
    try:
        d=json.loads(b)
        for a in d.get("articles",[])[:4]:
            print("   ", a.get("seendate"), a.get("domain"), a.get("language"), a.get("sourcecountry"), "|", a.get("title","")[:90])
    except Exception as e:
        print("   ", b[:200])
    time.sleep(6)
print("=== YAHOO")
for s in ['XU100.IS','GD.AT','TA35.TA','^GSPC','^GDAXI','000001.SS','^BSESN','^N225','^MERV','^JN0U.JO']:
    st,b=get("https://query1.finance.yahoo.com/v8/finance/chart/"+urllib.parse.quote(s)+"?range=1mo&interval=1d")
    try:
        m=json.loads(b)["chart"]["result"][0]["meta"]
        print(s, st, m.get("longName") or m.get("shortName"), m.get("currency"), m.get("regularMarketPrice"), m.get("regularMarketTime"))
    except Exception:
        print(s, st, b[:150])
print("=== STOOQ")
for s in ['^xu100','^ath','^ta35','^spx']:
    st,b=get("https://stooq.com/q/l/?s="+urllib.parse.quote(s)+"&f=sd2t2ohlcv&h&e=csv")
    print(s, st, b[:160])
