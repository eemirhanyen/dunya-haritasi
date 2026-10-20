for i in 1 2; do
curl -s -m 60 -w "\nHTTP %{http_code} in %{time_total}s\n" "https://dunya-haritasi.vercel.app/api/planes?try=$i" | tail -c 400; echo
done
curl -s -m 60 -o /dev/null -w "direct opensky HTTP %{http_code} %{time_total}s\n" https://opensky-network.org/api/states/all
