# 1. Node.js resmi imajını kullan
FROM node:18-alpine

# 2. Çalışma dizinini oluştur
WORKDIR /app

# 3. Bağımlılıkları kopyala ve yükle
COPY package*.json ./
RUN npm install

# 4. Tüm dosyaları kopyala
COPY . .

# 5. Uygulamanın çalışacağı portu belirt (Render varsayılanı)
EXPOSE 10000

# 6. Uygulamayı başlat
CMD ["node", "server.js"]