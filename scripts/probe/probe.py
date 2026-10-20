import json, time, sys, os, urllib.request, urllib.parse, xml.etree.ElementTree as ET
UA={"User-Agent":"Mozilla/5.0 (compatible; dunya-haritasi/1.0)"}
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=60) as r: return r.status, r.read()
    except Exception as e: return getattr(e,'code',None), str(e).encode()
print("=== GDELT freshness")
for q in ["sourcecountry:TU","sourcecountry:US"]:
    for span in ["24h","72h"]:
        st,b=get("https://api.gdeltproject.org/api/v2/doc/doc?"+urllib.parse.urlencode({"query":q,"mode":"artlist","maxrecords":"5","timespan":span,"format":"json","sort":"datedesc"}))
        try:
            a=json.loads(b).get("articles",[])
            print(q,span,st,len(a),[x["seendate"] for x in a[:5]])
        except Exception: print(q,span,st,b[:120])
        time.sleep(12)
st,b=get("http://data.gdeltproject.org/gdeltv2/lastupdate.txt"); print("lastupdate",st,b[:300])
print("=== GOOGLE NEWS RSS")
for name,u in [("TR top","https://news.google.com/rss?hl=tr&gl=TR&ceid=TR:tr"),("GR top","https://news.google.com/rss?hl=el&gl=GR&ceid=GR:el"),("IL top","https://news.google.com/rss?hl=he&gl=IL&ceid=IL:he"),("Turkey intl","https://news.google.com/rss/search?q=Turkey+when:3d&hl=en-US&gl=US&ceid=US:en")]:
    st,b=get(u)
    try:
        items=ET.fromstring(b).findall("./channel/item")
        print(name,st,len(items))
        for it in items[:3]: print("   ",it.findtext("pubDate"),"|",it.findtext("title")[:100])
    except Exception as e: print(name,st,b[:150])
