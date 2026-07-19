# Neon Yılan (io)

Slither.io mantığında, tek dosya HTML5 Canvas ile yazılmış bir yılan oyunu.
Gerçekçi isimli botlarla dolu canlı bir harita, 12 çok renkli skin, canlı uzunluk
ve sıralama göstergesi. Masaüstü (fare) ve mobil (dokunmatik) destekler.

## Oyna
Canlı sürüm: https://yilan-io.vercel.app

## Özellikler
- Girişte takma ad + skin seçimi (ok butonları / noktalar), canlı önizleme
- Fare veya parmakla yönlendirme (boost yok)
- Orb toplayınca büyüme; slither tarzı ölme (başka yılanın gövdesine / sınıra çarpınca)
- Ölen yılanlar orb bırakır
- Sürekli güncellenen "Uzunluk" ve "Sıra n / toplam" göstergesi + Top 10 sıralama
- Gerçek kişi gibi görünen bot isimleri
- 12 skin: gradyan, çizgili, benekli, neon, gökkuşağı, galaksi...

## Çalıştırma (yerel)
Statik dosyalar; herhangi bir sunucuyla açılır:
```
python3 -m http.server 8000
# tarayıcıda http://localhost:8000
```

## Dosyalar
- `index.html` — tek dosya: arayüz + stiller + oyun motoru
