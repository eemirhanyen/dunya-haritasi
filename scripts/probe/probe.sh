O="Origin: https://dunya-haritasi.vercel.app"
u="https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30"
curl -s -m 60 -D - -o /tmp/b -H "$O" "$u" | grep -iE "^HTTP|access-control|content-type"
python3 - <<'PY'
import json,collections
d=json.load(open('/tmp/b'))
ev=d.get('events',[]); print('events',len(ev))
c=collections.Counter(e['categories'][0]['id'] for e in ev); print(c)
for e in ev[:3]: print(e['title'], e['categories'][0]['id'], len(e['geometry']), e['geometry'][0]['type'], e['geometry'][-1]['date'], e.get('sources',[{}])[0].get('id'))
st=[e for e in ev if e['categories'][0]['id']=='severeStorms'][:2]
for e in st: print('STORM', e['title'], len(e['geometry']), [g.get('magnitudeValue') for g in e['geometry'][-3:]], e['geometry'][-1].get('magnitudeUnit'))
PY
