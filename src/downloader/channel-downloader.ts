// src/downloader/channel-downloader.ts
// Tải full kênh YouTube / Douyin theo batch
// Sau khi video được đăng lên X → tự động xóa file, tiết kiệm dung lượng

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import db from "../db";

const execAsync = promisify(exec);
const logger = createLogger("ChannelDL");

// File lưu danh sách video ID đã tải/đăng (tránh tải lại)
const HISTORY_FILE = "data/downloaded-history.txt";
const BATCH_SIZE = 10; // Tải bao nhiêu video mỗi lần

// ─── Đọc/ghi lịch sử ─────────────────────────────────────────────────────────

function loadHistory(): Set<string> {
  if (!fs.existsSync(HISTORY_FILE)) return new Set();
  const content = fs.readFileSync(HISTORY_FILE, "utf-8");
  return new Set(content.split("\n").filter(Boolean));
}

function saveToHistory(videoId: string) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, videoId + "\n");
}

// ─── Lấy danh sách video ID từ kênh (không tải file) ────────────────────────

async function getChannelVideoIds(channelUrl: string, limit?: number): Promise<Array<{id: string, title: string, url: string}>> {
  try {
    logger.info(`Đang quét kênh: ${channelUrl}`);

    const limitFlag = limit ? `--playlist-end ${limit}` : "";

    const { stdout } = await execAsync(
      `yt-dlp --flat-playlist --dump-json ${limitFlag} --no-warnings "${channelUrl}"`,
      { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer cho kênh lớn
    );

    const lines = stdout.trim().split("\n").filter(Boolean);
    const videos = lines.map(line => {
      try {
        const info = JSON.parse(line);
        return {
          id: info.id as string,
          title: (info.title || "Untitled") as string,
          url: (info.url || info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`) as string,
        };
      } catch {
        return null;
      }
    }).filter(Boolean) as Array<{id: string, title: string, url: string}>;

    logger.info(`Tìm thấy ${videos.length} video trên kênh`);
    return videos;
  } catch (err: any) {
    logger.error(`Lỗi quét kênh: ${err.message}`);
    return [];
  }
}

// ─── Tải 1 video ─────────────────────────────────────────────────────────────

async function downloadVideo(videoUrl: string, videoId: string, title: string): Promise<string | null> {
  if (!fs.existsSync(config.videoDir)) {
    fs.mkdirSync(config.videoDir, { recursive: true });
  }

  const filePath = path.resolve(path.join(config.videoDir, `${videoId}.mp4`));

  try {
    await execAsync(
      `yt-dlp ` +
      `-f "best[height<=720][ext=mp4]/best[height<=720]/best" ` +
      `--merge-output-format mp4 ` +
      `--no-playlist ` +
      `--socket-timeout 60 ` +
      `--retries 3 ` +
      `--no-warnings ` +
      `-o "${filePath}" ` +
      `"${videoUrl}"`
    );

    if (!fs.existsSync(filePath)) return null;

    // Kiểm tra thời lượng và dung lượng
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / 1024 / 1024;

    if (sizeMB > config.maxVideoSizeMB) {
      logger.warn(`File quá lớn (${sizeMB.toFixed(0)}MB), đang compress...`);
      await execAsync(
        `ffmpeg -i "${filePath}" -vcodec libx264 -crf 28 -preset fast ` +
        `-acodec aac -b:a 128k "${filePath}.tmp.mp4" -y`
      );
      fs.unlinkSync(filePath);
      fs.renameSync(`${filePath}.tmp.mp4`, filePath);
    }

    return filePath;
  } catch (err: any) {
    logger.error(`Lỗi tải ${videoId}: ${err.message}`);
    // Xóa file dở nếu có
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return null;
  }
}

// ─── Tải 1 batch từ kênh ─────────────────────────────────────────────────────

export async function downloadChannelBatch(
  channelUrl: string,
  batchSize: number = BATCH_SIZE
): Promise<number> {
  const history = loadHistory();

  // Quét kênh lấy danh sách video (lấy nhiều hơn để trừ đi số đã tải)
  const allVideos = await getChannelVideoIds(channelUrl);
  if (allVideos.length === 0) return 0;

  // Lọc bỏ những video đã tải rồi
  const newVideos = allVideos.filter(v => !history.has(v.id));
  logger.info(`${newVideos.length} video chưa tải (${history.size} đã có trong lịch sử)`);

  if (newVideos.length === 0) {
    logger.info("Kênh này đã tải hết rồi!");
    return 0;
  }

  // Lấy batch đầu tiên
  const batch = newVideos.slice(0, batchSize);
  logger.info(`Bắt đầu tải batch ${batch.length} video...`);

  let downloaded = 0;

  for (const video of batch) {
    logger.info(`[${downloaded + 1}/${batch.length}] ${video.title.substring(0, 60)}`);

    // Kiểm tra duration trước khi tải (nhanh hơn)
    try {
      const { stdout } = await execAsync(
        `yt-dlp --dump-json --no-download --no-warnings "${video.url}"`
      );
      const info = JSON.parse(stdout.trim());
      if (info.duration > config.maxVideoDurationSec) {
        logger.warn(`Bỏ qua (${info.duration}s > ${config.maxVideoDurationSec}s): ${video.title}`);
        saveToHistory(video.id); // Đánh dấu để không check lại
        continue;
      }
    } catch {
      // Nếu không lấy được info, cứ thử tải
    }

    const filePath = await downloadVideo(video.url, video.id, video.title);

    if (filePath) {
      const stats = fs.statSync(filePath);

      // Lưu vào DB
      await db.videoLibrary.upsert({
        where: { originalUrl: video.url },
        update: {
          status: "pending_caption",
          localPath: filePath,
          title: video.title,
          fileSize: stats.size,
        },
        create: {
          source: channelUrl.includes("douyin") ? "douyin" : "youtube",
          originalUrl: video.url,
          localPath: filePath,
          title: video.title,
          fileSize: stats.size,
          status: "pending_caption",
        },
      });

      // Lưu vào lịch sử
      saveToHistory(video.id);
      downloaded++;
      logger.success(`✅ ${video.title.substring(0, 50)}`);
    } else {
      saveToHistory(video.id); // Đánh dấu failed để không thử lại
    }

    // Chờ giữa các video tránh bị chặn
    await new Promise(r => setTimeout(r, 2000));
  }

  logger.success(`Batch xong: ${downloaded}/${batch.length} video thành công`);
  return downloaded;
}

// ─── Tải từ nhiều kênh (đọc từ file channels.txt) ────────────────────────────

export async function downloadAllChannels(batchSize: number = BATCH_SIZE): Promise<void> {
  const channelsFile = "channels.txt";

  if (!fs.existsSync(channelsFile)) {
    logger.error(`Không tìm thấy ${channelsFile}! Tạo file với danh sách URL kênh.`);
    return;
  }

  const content = fs.readFileSync(channelsFile, "utf-8");
  const channels = content
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  logger.info(`Tìm thấy ${channels.length} kênh cần tải`);

  for (const channelUrl of channels) {
    logger.info(`\n=== Đang xử lý kênh: ${channelUrl} ===`);
    await downloadChannelBatch(channelUrl, batchSize);
    // Chờ 5s giữa các kênh
    await new Promise(r => setTimeout(r, 5000));
  }
}

// ─── Xóa file video sau khi đã đăng ──────────────────────────────────────────

export async function cleanupPublishedVideos(): Promise<number> {
  const published = await db.videoLibrary.findMany({
    where: {
      status: "published",
      localPath: { not: "" },
    },
  });

  let deleted = 0;
  for (const video of published) {
    if (video.localPath && fs.existsSync(video.localPath)) {
      try {
        fs.unlinkSync(video.localPath);
        // Xóa path trong DB để không cố xóa lại
        await db.videoLibrary.update({
          where: { id: video.id },
          data: { localPath: "" },
        });
        deleted++;
      } catch (err: any) {
        logger.error(`Không xóa được: ${video.localPath}`);
      }
    }
  }

  if (deleted > 0) logger.success(`Đã xóa ${deleted} file video đã đăng`);
  return deleted;
}

// ─── Thống kê dung lượng đang dùng ───────────────────────────────────────────

export function getDiskUsage(): string {
  if (!fs.existsSync(config.videoDir)) return "0 MB";

  const files = fs.readdirSync(config.videoDir);
  const totalBytes = files.reduce((sum, file) => {
    try {
      return sum + fs.statSync(path.join(config.videoDir, file)).size;
    } catch {
      return sum;
    }
  }, 0);

  const mb = totalBytes / 1024 / 1024;
  if (mb > 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}
