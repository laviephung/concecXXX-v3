// src/index.ts
// Entry point - khởi động toàn bộ bot

import { checkDependencies } from "./downloader/video-downloader";
import { startTelegramBot } from "./bot/telegram-bot";
import { startScheduler, triggerPublishNow } from "./scheduler";
import { startVideoWatcher } from "./watcher/video-watcher";
import { createLogger } from "./utils/logger";
import TelegramBot from "node-telegram-bot-api";
import { config } from "./config";

const logger = createLogger("Main");

async function setCommandMenu() {
  // Dùng thẳng API để set menu commands
  const bot = new TelegramBot(config.telegramBotToken);
  await bot.setMyCommands([
    { command: "status",        description: "📊 Thống kê kho video + dung lượng" },
    { command: "queue",         description: "📋 Xem hàng đợi chờ đăng" },
    { command: "recent",        description: "📤 Xem các tweet vừa đăng" },
    { command: "crawlnow",      description: "⬇️ Tải batch video ngay bây giờ" },
    { command: "channels",      description: "📡 Danh sách kênh đang theo dõi" },
    { command: "addchannel",    description: "➕ Thêm kênh (dán URL theo sau)" },
    { command: "removechannel", description: "➖ Xóa kênh (dán URL theo sau)" },
    { command: "add",           description: "🎬 Thêm 1 video lẻ (dán URL theo sau)" },
    { command: "cleanup",       description: "🗑️ Xóa file video đã đăng" },
    { command: "pause",         description: "⏸️ Tạm dừng tự động đăng" },
    { command: "resume",        description: "▶️ Bật lại tự động đăng" },
    { command: "postnow",       description: "🚀 Đăng 1 video ngay lập tức" },
    { command: "schedule",      description: "⏰ Xem lịch đăng bài hiện tại" },
    { command: "addig",         description: "📸 Tải 1 video Instagram (dán URL theo sau)" },
    { command: "crawlig",       description: "📸 Tải full profile Instagram (@username)" },
    { command: "retry",         description: "🔄 Thử lại các video bị lỗi" },
    { command: "start",         description: "🤖 Hiện menu trợ giúp" },
  ]);
  logger.success("Đã set menu lệnh cho bot Telegram");
}

async function main() {
  console.log(`
╔══════════════════════════════════════╗
║         🎬 Content Bot v1.0          ║
║   Auto Download & Post to X/Twitter  ║
╚══════════════════════════════════════╝
`);

  // Kiểm tra yt-dlp và ffmpeg
  const depsOk = await checkDependencies();
  if (!depsOk) {
    logger.error("Thiếu dependencies, bot vẫn chạy nhưng không tải được video");
  }

  // Set menu lệnh hiển thị trong Telegram
  await setCommandMenu();

  // Khởi động Telegram bot
  startTelegramBot();

  // Khởi động scheduler
  startScheduler();

  // Khởi động watcher thư mục video (nhận file từ sync-to-vps)
  startVideoWatcher();

  logger.success("Bot đã sẵn sàng! Gửi /start cho bot Telegram để bắt đầu.");
}

main().catch((err) => {
  console.error("❌ Lỗi khởi động:", err.message);
  process.exit(1);
});