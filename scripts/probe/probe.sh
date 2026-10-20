O="Origin: https://dunya-haritasi.vercel.app"
for u in "https://api.adsbdb.com/v0/callsign/AAL3210" "https://api.adsbdb.com/v0/callsign/THY1" "https://hexdb.io/api/v1/route/icao/AAL3210" "https://hexdb.io/callsign-route?callsign=THY1"; do
 echo "=== $u"; curl -s -m 30 -D - -o /tmp/b -H "$O" "$u" | grep -iE "^HTTP|access-control|content-type|ratelimit|x-rate"; head -c 900 /tmp/b; echo; done
