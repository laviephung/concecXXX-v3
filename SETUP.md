# 🚀 Hướng Dẫn Cài Đặt Từng Bước (Windows)

## Bước 1 — Cài Node.js

1. Vào https://nodejs.org → tải bản **LTS** (nút xanh)
2. Chạy file .msi → Next → Next → Install
3. Mở **Command Prompt**: nhấn `Win + R` → gõ `cmd` → Enter
4. Kiểm tra:
```
node --version
```
Phải hiện `v20.x.x` là OK ✅

---

## Bước 2 — Cài Python + yt-dlp

1. Vào https://python.org → Downloads → tải Python 3.x
2. **Quan trọng**: tick vào "Add Python to PATH" khi cài
3. Mở CMD mới, chạy:
```
pip install yt-dlp
```
4. Kiểm tra:
```
yt-dlp --version
```

---

## Bước 3 — Cài ffmpeg

1. Vào https://ffmpeg.org/download.html
2. Click **Windows** → **Windows builds from gyan.dev**
3. Tải `ffmpeg-release-essentials.zip`
4. Giải nén → đổi tên thư mục thành `ffmpeg` → copy vào `C:\ffmpeg`
5. Thêm vào PATH:
   - Nhấn `Win` → tìm **"Edit environment variables"** → mở
   - Click **"Environment Variables"**
   - Trong **System variables** → chọn **Path** → **Edit**
   - Click **New** → nhập: `C:\ffmpeg\bin` → OK → OK → OK
6. Mở CMD **mới**, kiểm tra:
```
ffmpeg -version
```

---

## Bước 4 — Cài các tool Node.js

Trong CMD, chạy lần lượt:
```
npm install -g pnpm
npm install -g tsx
npm install -g pm2
```

---

## Bước 5 — Tạo project

```
mkdir C:\content-bot
```

Copy toàn bộ file trong folder này vào `C:\content-bot`

Cấu trúc phải như sau:
```
C:\content-bot\
├── package.json
├── tsconfig.json
├── .env.example
├── urls.txt
├── prisma\
│   └── schema.prisma
├── scripts\
│   └── bulk-download.ts
└── src\
    ├── index.ts
    ├── config.ts
    ├── db.ts
    ├── scheduler.ts
    ├── bot\
    │   └── telegram-bot.ts
    ├── downloader\
    │   └── video-downloader.ts
    ├── processor\
    │   └── caption-generator.ts
    ├── publisher\
    │   └── twitter-publisher.ts
    └── utils\
        └── logger.ts
```

---

## Bước 6 — Cài dependencies

```
cd C:\content-bot
pnpm install
```

---

## Bước 7 — Tạo file .env

```
copy .env.example .env
```

Mở file `.env` bằng Notepad, điền thông tin:

```
TELEGRAM_BOT_TOKEN=    ← lấy từ @BotFather trên Telegram
ADMIN_USER_IDS=        ← ID Telegram của bạn (lấy từ @userinfobot)
DEEPSEEK_API_KEY=      ← lấy từ https://platform.deepseek.com
TWITTER_API_KEY=       ← lấy từ https://developer.x.com
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=
```

---

## Bước 8 — Khởi tạo database

```
cd C:\content-bot
npx prisma generate
npx prisma db push
```

---

## Bước 9 — Thêm URL video

Mở file `urls.txt`, thêm URL video vào (mỗi URL 1 dòng):
```
https://www.youtube.com/watch?v=xxxxx
https://v.douyin.com/xxxxx/
```

Chạy tải hàng loạt:
```
npx tsx scripts/bulk-download.ts urls.txt
```

---

## Bước 10 — Chạy bot

```
# Development (xem log trực tiếp)
pnpm dev

# Hoặc chạy nền với PM2
pm2 start src\index.ts --name content-bot --interpreter tsx
pm2 save
pm2 logs content-bot
```

---

## Kiểm Tra Bot Hoạt Động

1. Mở Telegram → tìm bot của bạn → gửi `/start`
2. Gửi `/status` → xem số video trong kho
3. Bot sẽ tự động đăng lên X mỗi 30 phút

---

## Lệnh Telegram Bot

| Lệnh | Chức năng |
|------|-----------|
| `/status` | Xem thống kê kho video |
| `/queue` | Xem hàng đợi chờ đăng |
| `/recent` | Các tweet vừa đăng |
| `/add <url>` | Thêm 1 URL video |
| `/addfile` | Hướng dẫn thêm nhiều URL |
| `/pause` | Tạm dừng auto-đăng |
| `/resume` | Bật lại auto-đăng |
| `/retry` | Thử lại video lỗi |

---

## Deploy lên VPS Ubuntu

```bash
# Cài Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Cài Python + yt-dlp + ffmpeg
sudo apt install python3-pip ffmpeg -y
pip3 install yt-dlp

# Cài tools
npm install -g pnpm tsx pm2

# Copy project lên VPS, vào thư mục
cd /opt/content-bot
pnpm install
npx prisma generate
npx prisma db push

# Chạy
pm2 start src/index.ts --name content-bot --interpreter tsx
pm2 save
pm2 startup
```
