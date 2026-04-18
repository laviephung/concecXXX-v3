// src/downloader/twz-scraper.ts
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import Groq from "groq-sdk";
import db from "../db";
import { createLogger } from "../utils/logger";

const logger = createLogger("TWZScraper");

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
  } else {
    logger.warn("Không tìm thấy API Key trong groq_keys.txt!");
  }
} catch (error) {
  logger.warn("Lỗi đọc file groq_keys.txt, cào bài viết sẽ không rewrite được.");
}

const CATEGORY_URLS = [
  "https://www.twz.com/category/air",
  "https://www.twz.com/category/land",
  "https://www.twz.com/category/sea"
];
const IMAGE_DIR = path.join(process.cwd(), "data", "images");
const headers = { "User-Agent": "Mozilla/5.0" };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

fs.ensureDirSync(IMAGE_DIR);

function hashUrl(url: string) {
  return crypto.createHash("md5").update(url).digest("hex");
}

async function getArticleLinks(): Promise<string[]> {
  let links = new Set<string>();
  for (let url of CATEGORY_URLS) {
    try {
      const res = await axios.get(url, { headers });
      const $ = cheerio.load(res.data);
      $("a").each((i, el) => {
        const href = $(el).attr("href");
        if (
          href &&
          href.startsWith("https://www.twz.com/") &&
          href.split("/").length > 4 &&
          !href.includes("/category/") &&
          !href.includes("/authors/")
        ) {
          links.add(href);
        }
      });
    } catch(err: any) {
       logger.error(`Error fetching category ${url}: ${err.message}`);
    }
  }
  return Array.from(links);
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

async function scrapeArticle(url: string, index: number) {
  try {
    const res = await axios.get(url, { headers });
    const $ = cheerio.load(res.data);
    const title = $("h1").first().text().trim();
    
    if (!title || title.length < 10) return null;

    let content: string[] = [];
    $("article p").each((i, el) => {
      const text = $(el).text().trim();
      if (
        text.length > 50 &&
        !text.includes("Weekly insights") &&
        !text.includes("Terms") &&
        !text.includes("affiliate")
      ) {
        content.push(text);
      }
    });

    if (content.length < 5) return null;

    let mainImage = $('meta[property="og:image"]').attr("content");
    let mainPath = null;
    if (mainImage) {
      mainPath = await downloadImage(mainImage, `main_${hashUrl(url)}.jpg`);
    }

    return { title, url, content: content.join("\n\n"), mainPath };
  } catch {
    return null;
  }
}

async function rewriteContent(originalContent: string): Promise<string> {
  if (!groq) return originalContent;
  
  const prompt = `
You are a top-tier viral content creator on X (Twitter).
Rewrite the news below into a HIGHLY CONTROVERSIAL, SCROLL-STOPPING post.

STRICT RULES:
- MUST be in English
- Keep it SHORT (max 6 lines)
- First line = HOOK (shocking or bold claim)
- Use strong, opinionated tone (not neutral)
- Add exaggeration or dramatic implications if needed
- Make readers feel like something BIG or WRONG is happening

ENGAGEMENT BAIT:
- Add at least 1 controversial question
- Make people feel they need to respond
- Create division (people will disagree)

STYLE:
- Punchy, aggressive
- No boring explanation
- No "according to reports" tone

OUTPUT FORMAT:
Line 1: Hook
Line 2-5: Content
Last line: Question that triggers debate

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
    logger.error(`Lỗi rewrite: ${error.message}`);
    return originalContent;
  }
}

async function pickHotArticleIndices(articles: any[]): Promise<number[]> {
  if (!groq) return articles.length > 0 ? [0] : [];
  if (articles.length <= 1) return articles.map((_, i) => i);

  const prompt = `
You are a viral content strategist. Review the following news articles and pick exactly ONE that has the absolute highest potential to go viral on X (Twitter). Look for controversy, high drama, political tension, or shocking military technology news.

${articles.map((a, idx) => `[${idx}] TITLE: ${a.title}`).join('\n')}

IMPORTANT RULE:
Reply ONLY with the digit (e.g., 0, 1, 2) corresponding to the top hottest article. Do not include any other text, reasoning, or explanation.
`;

  try {
    const response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
    });
    
    const content = (response.choices[0].message.content || "").trim();
    const match = content.match(/\d+/);
    if (match) {
      const idx = parseInt(match[0], 10);
      if (idx >= 0 && idx < articles.length) {
        return [idx];
      }
    }
  } catch (error: any) {
    logger.error(`Lỗi AI pick bài hot: ${error.message}`);
  }
  return [0];
}

export async function crawlNews(limit: number = 5): Promise<number> {
  logger.info("Bắt đầu cào và quét bài báo (TWZ)...");
  
  const links = await getArticleLinks();
  logger.info(`Tìm thấy ${links.length} link.`);

  let newArticlesFetched: any[] = [];
  
  for (let url of links) {
    if (newArticlesFetched.length >= limit) break;
    
    // Check if exists in Prisma DB
    const existing = await db.articleLibrary.findUnique({ where: { originalUrl: url } });
    if (existing) {
      continue; // Bỏ qua bài đã cào
    }

    const article = await scrapeArticle(url, newArticlesFetched.length);
    if (article) {
      newArticlesFetched.push(article);
    }
    await sleep(1500);
  }

  if (newArticlesFetched.length === 0) {
    logger.info("Không có bài viết mới nào.");
    return 0;
  }

  logger.info(`Đã cào ${newArticlesFetched.length} bài. Đang nhờ AI tìm bài HOT nhất...`);
  const hotIndices = await pickHotArticleIndices(newArticlesFetched);
  let savedCount = 0;

  for (let i = 0; i < newArticlesFetched.length; i++) {
    const article = newArticlesFetched[i];
    
    // Nếu là bài hot thì đem đi rewrite
    if (hotIndices.includes(i)) {
      logger.info(`🔥 AI chọn bài: ${article.title}`);
      const rewrittenContent = await rewriteContent(article.content);
      
      await db.articleLibrary.create({
        data: {
          source: "twz",
          originalUrl: article.url,
          title: article.title,
          content: rewrittenContent,
          localPath: article.mainPath,
          status: "ready"
        }
      });
      savedCount++;
    } else {
       // Chúng ta không save bài không hot vào DB để hệ thống sạch sẽ, 
       // Hoặc có thể save status = 'skipped' nếu muốn history. Ta sẽ lưu status 'skipped'.
       await db.articleLibrary.create({
        data: {
          source: "twz",
          originalUrl: article.url,
          title: article.title,
          content: article.content, // chưa rewrite
          localPath: article.mainPath,
          status: "skipped"
        }
      });
    }
  }

  logger.success(`Quá trình lọc hoàn tất. Có ${savedCount} bài HOT sẵn sàng đăng.`);
  return savedCount;
}
