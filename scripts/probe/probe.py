import io, zipfile, urllib.request, csv, sys
csv.field_size_limit(10**9)
UA={"User-Agent":"Mozilla/5.0 (compatible; dunya-haritasi/1.0)"}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=120) as r: return r.read()
for lu in ["http://data.gdeltproject.org/gdeltv2/lastupdate.txt","http://data.gdeltproject.org/gdeltv2/lastupdate-translation.txt"]:
    t=get(lu).decode(); print(lu); print(t)
    g=[l.split()[2] for l in t.splitlines() if "gkg" in l][0]
    z=zipfile.ZipFile(io.BytesIO(get(g))); name=z.namelist()[0]
    raw=z.read(name).decode("utf-8","replace").splitlines()
    print(name, len(raw), "records")
    for line in raw[:3]:
        f=line.split("\t"); print(len(f), f[1], f[3], f[4][:80]); print("  LOC:", f[10][:200]); print("  TONE:", f[15][:60]); print("  TR:", f[25][:80]); print("  EX:", f[26][:200])
try:
    d=get("http://data.gdeltproject.org/blog/2018-news-outlets-by-country-may2018-update/MASTER-GDELTDOMAINSBYCOUNTRY-MAY2018.TXT").decode("utf-8","replace").splitlines()
    print("DOMAINS", len(d), d[:5])
except Exception as e: print("DOMAINS ERR", e)
