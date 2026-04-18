// src/watcher/video-watcher.ts
// Watch thư mục data/videos/ — hễ có file .mp4 mới từ sync-to-vps thì tự register vào DB

import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const logger = createLogger("VideoWatcher");

// Chờ file ghi xong (SCP đang upload dở) trước khi xử lý
async function waitUntilStable(filePath: string, intervalMs = 1500, maxWaitMs = 60000): Promise<boolean> {
  let lastSize = -1;
  let waited = 0;

  while (waited < maxWaitMs) {
    await new Promise(r => setTimeout(r, intervalMs));
    waited += intervalMs;

    try {
      const size = fs.statSync(filePath).size;
      if (size > 0 && size === lastSize) return true; // Kích thước ổn định → ghi xong
      lastSize = size;
    } catch {
      return false; // File bị xóa giữa chừng
    }
  }

  logger.warn(`File không ổn định sau ${maxWaitMs / 1000}s: ${path.basename(filePath)}`);
  return false;
}

// Đăng ký 1 file mp4 vào DB
async function registerVideo(filePath: string): Promise<void> {
  const fileName = path.basename(filePath, ".mp4");

  // Bỏ qua file temp hoặc không phải mp4
  if (!filePath.endsWith(".mp4") || fileName.startsWith(".") || fileName.includes(".tmp")) return;

  // Kiểm tra DB — nếu đã có rồi thì bỏ qua
  const existing = await db.videoLibrary.findFirst({
    where: { localPath: filePath },
  });
  if (existing) return;

  // Chờ SCP upload xong
  logger.info(`Phát hiện file mới: ${fileName}.mp4 — đang chờ upload xong...`);
  const stable = await waitUntilStable(filePath);
  if (!stable) {
    logger.warn(`Bỏ qua file không ổn định: ${fileName}.mp4`);
    return;
  }

  try {
    const fileSize = fs.statSync(filePath).size;

    // Dùng tên file (video ID) làm originalUrl tạm — sync-to-vps không cần truyền URL nữa
    const fakeUrl = `file://${fileName}`;

    await db.videoLibrary.upsert({
      where: { originalUrl: fakeUrl },
      update: {
        localPath: filePath,
        fileSize,
        status: "pending_caption",
      },
      create: {
        source: "youtube",
        originalUrl: fakeUrl,
        localPath: filePath,
        title: fileName, // title tạm = video ID, caption-generator sẽ dùng title này
        fileSize,
        status: "pending_caption",
      },
    });

    logger.success(`Đã register: ${fileName}.mp4 (${(fileSize / 1024 / 1024).toFixed(1)} MB) → pending_caption`);
  } catch (err: any) {
    logger.error(`Lỗi register ${fileName}: ${err.message}`);
  }
}

// Scan toàn bộ thư mục lúc khởi động — bắt các file đã có nhưng chưa vào DB
async function scanExisting(): Promise<void> {
  if (!fs.existsSync(config.videoDir)) return;

  const files = fs.readdirSync(config.videoDir).filter(f => f.endsWith(".mp4"));
  if (files.length === 0) return;

  logger.info(`Scan lúc khởi động: tìm thấy ${files.length} file mp4, kiểm tra DB...`);

  for (const file of files) {
    await registerVideo(path.join(config.videoDir, file));
  }
}

// Khởi động watcher
export function startVideoWatcher(): void {
  // Đảm bảo thư mục tồn tại
  fs.mkdirSync(config.videoDir, { recursive: true });

  // Scan file có sẵn khi khởi động
  scanExisting().catch(err => logger.error(`Lỗi scan ban đầu: ${err.message}`));

  // Watch thư mục
  const watcher = fs.watch(config.videoDir, (eventType, filename) => {
    if (!filename || !filename.endsWith(".mp4")) return;
    if (eventType !== "rename") return; // "rename" = file mới xuất hiện hoặc bị xóa

    const filePath = path.join(config.videoDir, filename);

    // Kiểm tra file tồn tại (tránh nhầm với sự kiện xóa)
    if (!fs.existsSync(filePath)) return;

    registerVideo(filePath).catch(err =>
      logger.error(`Lỗi xử lý file mới ${filename}: ${err.message}`)
    );
  });

  watcher.on("error", err => logger.error(`Watcher lỗi: ${err.message}`));

  logger.success(`Đang watch thư mục: ${config.videoDir}`);
}
