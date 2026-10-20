O="Origin: https://dunya-haritasi.vercel.app"
for u in "https://opensky-network.org/api/states/all" "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson" "https://api.wheretheiss.at/v1/satellites/25544" "https://api.adsb.lol/v2/mil"; do
  echo "=== $u"
  curl -s -m 40 -D - -o /tmp/body -H "$O" "$u" | grep -iE "^HTTP|access-control|x-rate-limit|content-type|content-length" 
  echo "body bytes: $(wc -c < /tmp/body)"; head -c 300 /tmp/body; echo
done
