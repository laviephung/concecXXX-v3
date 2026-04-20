// src/downloader/aljazeera-scraper.ts
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import Groq from "groq-sdk";
import db from "../db";
import { createLogger } from "../utils/logger";

const logger = createLogger("AlJazeeraScraper");

// =========================
// START: Khởi tạo GROQ
// =========================
let groq: Groq | null = null;
try {
  const keysPath = path.join(process.cwd(), "groq_keys.txt");
  const keys = fs.readFileSync(keysPath, 'utf-8')
    .split('\n')
    .map(k => k.trim())
    .filter(k => k && !k.startsWith('#'));
  
  if (keys.length > 0) {
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    groq = new Groq({ apiKey: randomKey });
  }
} catch (error) {
  logger.warn("Lỗi đọc file groq_keys.txt, cào bài viết sẽ không rewrite được.");
}

// Sử dụng RSS feed chính của Al Jazeera English
const RSS_URL = "https://www.aljazeera.com/xml/rss/all.xml";
const IMAGE_DIR = path.join(process.cwd(), "data", "images");
const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" };

fs.ensureDirSync(IMAGE_DIR);

function hashUrl(url: string) {
  return crypto.createHash("md5").update(url).digest("hex");
}

async function downloadImage(url: string, name: string): Promise<string | null> {
  try {
    const res = await axios({ url, method: "GET", responseType: "stream", headers });
    const filePath = path.join(IMAGE_DIR, name);
    const writer = fs.createWriteStream(filePath);
    res.data.pipe(writer);
    return new Promise((resolve) => {
      writer.on("finish", () => resolve(filePath));
      writer.on("error", () => resolve(null));
    });
  } catch {
    return null;
  }
}

async function rewriteGeoContent(originalContent: string): Promise<string> {
  if (!groq) return originalContent;
  
  const prompt = `
You are a world-class geopolitical analyst on X (Twitter).
Rewrite the news below into a SHARP, ANALYTICAL, and PROVOCATIVE post.

STRICT RULES:
- MUST be in English
- Keep it SHORT (max 6 lines)
- First line = A powerful, attention-grabbing hook (NO generic labels like "GEOPOLITICS:" or "ESCALATION:")
- Use a serious, authoritative, yet engaging tone
- Focus on the shift in power, regional stability, or strategic implications
- No boring explanation

OUTPUT FORMAT:
Line 1: Hook (The core geopolitical impact)
Line 2-5: Analysis/Content
Last line: A deep question that makes readers think about the future of the region

NEWS:
${originalContent}
`;

  try {
    const response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
    });
    return response.choices[0].message.content || originalContent;
  } catch (error: any) {
    logger.error(`Lỗi rewrite geopolitics: ${error.message}`);
    return originalContent;
  }
}

export async function crawlGeoNews(limit: number = 5): Promise<number> {
  logger.info("Bắt đầu cào tin tức địa chính trị (Al Jazeera RSS)...");
  
  try {
    const res = await axios.get(RSS_URL, { headers });
    const $ = cheerio.load(res.data, { xmlMode: true });
    const items = $("item").toArray();
    
    logger.info(`Tìm thấy ${items.length} tin trong RSS.`);

    let savedCount = 0;
    for (let item of items) {
      if (savedCount >= limit) break;

      const title = $(item).find("title").text().trim();
      const link = $(item).find("link").text().trim();
      const description = $(item).find("description").text().trim();

      if (!link) continue;

      // Check if exists in Prisma DB
      const existing = await db.articleLibrary.findUnique({ where: { originalUrl: link } });
      if (existing) continue;

      logger.info(`Đang xử lý tin địa chính trị mới: ${title}`);

      // Lấy ảnh từ media:content, content, hoặc enclosure
      let imageUrl = $(item).find("media\\:content").attr("url") || 
                     $(item).find("content").attr("url") ||
                     $(item).find("enclosure").attr("url") ||
                     $(item).find("media\\:thumbnail").attr("url");
      
      let localPath = null;
      if (imageUrl) {
        localPath = await downloadImage(imageUrl, `geo_${hashUrl(link)}.jpg`);
      }

      // Rewrite nội dung theo phong cách địa chính trị
      const rewritten = await rewriteGeoContent(description || title);

      await db.articleLibrary.create({
        data: {
          source: "geopolitics",
          originalUrl: link,
          title: title,
          content: rewritten,
          localPath: localPath,
          status: "ready"
        }
      });

      savedCount++;
      await new Promise(r => setTimeout(r, 1000));
    }

    logger.success(`Hoàn tất cào địa chính trị. Đã lưu ${savedCount} tin mới.`);
    return savedCount;
  } catch (err: any) {
    logger.error(`Lỗi cào Al Jazeera RSS: ${err.message}`);
    return 0;
  }
}
