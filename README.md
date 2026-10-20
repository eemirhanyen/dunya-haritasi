# Dünya Haritası

Ülkeleri dünya ortalamasına göre renklendiren küre.

## Skor

Her gösterge tüm ülkeler arasında yüzdelik dilime çevrilir (50 = dünya ortası). Beş boyut eşit ağırlıklıdır:

| Boyut | Kaynak |
|---|---|
| Yönetişim | Dünya Bankası WGI: hükümet etkinliği, düzenleyici kalite, siyasi istikrar, yolsuzluk kontrolü |
| Ekonomi | Dünya Bankası: kişi başı GSYH (SAGP), enflasyon (%2'ye uzaklık), işsizlik |
| İnsani gelişme | UNDP İnsani Gelişme Endeksi (Our World in Data) |
| Yargı bağımsızlığı | V-Dem yargısal denetim endeksi (Our World in Data) |
| Medya bağımsızlığı | RSF Dünya Basın Özgürlüğü Endeksi |

Renk: 0–33 kırmızı, 33–67 sarı, 67–100 yeşil.

Planlanan son skor: %50 endeks + %50 AI değerlendirmesi (7 günlük ortalama). AI kısmı henüz eklenmedi; şu an skor yalnızca endekstir.

## Dosyalar

- `index.html`, `app.js`, `style.css`: site
- `data/countries.json`: üretilen veri (elle düzenlenmez)
- `data/ne_110m_countries.geojson`: ülke sınırları (Natural Earth, kamu malı)
- `scripts/fetch_index.py`: veriyi çeken ve skorlayan betik
- `.github/workflows/update-data.yml`: betiği her gün 06:17 (TR) çalıştırır

## Elle güncelleme

GitHub > Actions > "Veriyi güncelle" > Run workflow
