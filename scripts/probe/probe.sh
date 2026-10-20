curl -s -m 60 -o /tmp/p.json -w "HTTP %{http_code} size %{size_download} time %{time_total} enc %{content_type}\n" --compressed "https://dunya-haritasi.vercel.app/api/planes?c=$RANDOM"
head -c 200 /tmp/p.json; echo
