# 🤖 ContentX Super Bot - Dual Mode (Video & News)

ContentX Super Bot là hệ thống đăng bài (Auto-Post) X/Twitter mạnh mẽ hỗ trợ 2 chế độ hoàn toàn độc lập và được điều khiển 100% qua Telegram:
- **Chế độ Video**: Tự động tải từ Youtube, Douyin, Instagram Reels, tự tạo caption và đăng lên X.
- **Chế độ News (Bài báo)**: AI quét qua dòng sự kiện hằng ngày, chắt lọc bản tin "Nóng" nhất từ TWZ, tự tóm tắt drama và đăng lên X.

---

## 🚀 Hướng Dẫn Cài Đặt (Windows)

### Bước 1 — Cài đặt môi trường
1. Cài đặt [Node.js](https://nodejs.org) (Bản LTS 20.x trở lên).
2. Cài đặt [Python 3.x](https://python.org) (Nhớ tích **Add Python to PATH** khi cài).
3. Mở Terminal (CMD) tải bộ thư viện hỗ trợ video bằng lệnh:
```bash
pip install yt-dlp
npm install -g pnpm tsx pm2
```
4. Cài đặt [FFmpeg](https://ffmpeg.org/download.html) và đảm bảo đã Add vào PATH (System Variables -> Path).

### Bước 2 — Thiết lập Bot
1. Đi tới thư mục chứa mã nguồn:
```bash
cd contentX_updated
pnpm install
```
2. Tạo file `.env` bằng cách copy từ `.env.example`:
```bash
copy .env.example .env
```
3. Mở file `.env` cấu hình các khóa bảo mật quan trọng:
```ini
TELEGRAM_BOT_TOKEN=    ← lấy từ @BotFather trên Telegram
ADMIN_USER_IDS=        ← ID Telegram của bạn (lấy từ @userinfobot)

# AI Groq (sử dụng lọc tin/tạo caption)
GROQ_API_KEY=          ← Thêm vào file groq_keys.txt (hoặc .env)

# Phân quyền X/Twitter
TWITTER_API_KEY=       ← lấy từ developer.x.com
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=
```

### Bước 3 — Khởi tạo Database
```bash
npx prisma generate
npx prisma db push
```

### Bước 4 — Vận Hành System
Chạy Bot dưới dạng tiến trình nền với PM2:
```bash
pm2 start src\index.ts --name contentX-super --interpreter tsx
pm2 save
pm2 logs contentX-super
```

---

## 📱 Hướng Dẫn Điều Khiển Từ Telegram
Sau khi bot chạy, mở chat với bot của bạn trên Telegram và sử dụng các tính năng siêu việt sau:

### 🌟 1. Danh sách Lệnh Xoay Chế Độ (Dual Mode)
Bộ đăng bài (Scheduler) sẽ kiểm tra chế độ hiện tại bạn cài đặt để xuất bản nội dung tương ứng.
* `/mode news` — Bật chế độ xuất bản **Tin tức (News)**
* `/mode video` — Bật chế độ xuất bản **Clip ngắn (Video)**

### 📰 2. Tính năng Cào Báo 
* `/crawlnews` — Ra lệnh cho AI đi lùng sục trang báo TWZ. Nó sẽ cào 5 bài mới, đánh giá độ viral và ném 1 bài bốc lửa nhất vào kho. Bạn có thể dùng `/queue` để xem bài nó vừa ngậm.

### 🎬 3. Tính năng Quản Lý Phim
* `/addchannel <url>` — Theo dõi tự tải link của một kênh Youtube.
* `/crawlig @username` — Quét sạch Profile của một KOL Instagram.
* `/add <url>` / `/addig <url>` — Tải thả cửa một đường link lẻ lên BOT.
* `/crawlnow` — Quét cưỡng bức các list Channel để giật Video mới tinh.

### 🕹️ 4. Bảng Chờ & Theo Dõi (Universal)
* `/queue` — List hàng chờ đợi lên mâm. Tự động hiển thị List Phim hay List Báo phụ thuộc vào `/mode` bạn đang chọn!
* `/status` — Khám sức khỏe DB xem Bot còn rảnh bao nhiêu ghi nhớ.
* `/recent` — Trả về 5 link Post X vinh quang mà Bot mới đăng gần nhất.

---
**Build and configured cleanly by Antigravity AI.** Mọi thay đổi hay nâng cấp sau này đều có thể đẩy thẳng vào nhánh *v3* trên Github.
