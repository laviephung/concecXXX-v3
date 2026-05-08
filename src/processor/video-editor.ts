// src/processor/video-editor.ts
// Xử lý video: Chuyển sang 9:16, chèn text trên/dưới, lách bản quyền

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "../utils/logger";

const execAsync = promisify(exec);
const logger = createLogger("VideoEditor");

export interface EditOptions {
  topText?: string;
  bottomText?: string;
  mirror?: boolean;
  zoom?: boolean;
}

/**
 * Xử lý video theo phong cách Nhật Bản (9:16, text trên/dưới)
 */
export async function editVideo(inputPath: string, options: EditOptions): Promise<string | null> {
  const outputPath = inputPath.replace(".mp4", "_edited.mp4");
  
  try {
    logger.info(`Đang edit video: ${path.basename(inputPath)}`);

    // Font tiếng Nhật trên Linux thường là Noto Sans CJK
    const fontPath = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc";
    const fontOption = fs.existsSync(fontPath) ? `fontfile='${fontPath}':` : "";

    // 1. Scale video gốc vào khung 1080x1920 (9:16)
    // 2. Thêm nền đen
    // 3. Chèn text trên (màu xanh/trắng)
    // 4. Chèn text dưới (màu trắng)
    // 5. Lách bản quyền: Zoom nhẹ 1.05x và Mirror (nếu cần)

    const topText = options.topText || "";
    const bottomText = options.bottomText || "最後まで見て 😂";
    
    // Escape ký tự đặc biệt cho FFmpeg drawtext
    const cleanTop = topText.replace(/'/g, "").replace(/:/g, "\\:");
    const cleanBottom = bottomText.replace(/'/g, "").replace(/:/g, "\\:");

    let filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black`;
    
    if (options.zoom) {
      filter += `,scale=iw*1.05:-1,crop=1080:1920`;
    }
    
    if (options.mirror) {
      filter += `,hflip`;
    }

    // Thêm Text trên (Đưa lên sát mép trên hơn, giảm size xuống 60)
    filter += `,drawtext=${fontOption}text='${cleanTop}':fontcolor=0x33CCFF:fontsize=60:x=(w-text_w)/2:y=150:shadowcolor=black:shadowx=2:shadowy=2`;
    
    // Thêm Text dưới (Đưa xuống sát mép dưới hơn, giảm size xuống 45)
    filter += `,drawtext=${fontOption}text='${cleanBottom}':fontcolor=white:fontsize=45:x=(w-text_w)/2:y=h-200:shadowcolor=black:shadowx=2:shadowy=2`;

    const command = `ffmpeg -i "${inputPath}" -vf "${filter}" -c:v libx264 -crf 23 -preset fast -c:a copy "${outputPath}" -y`;

    await execAsync(command);

    if (fs.existsSync(outputPath)) {
      logger.success(`Edit xong: ${path.basename(outputPath)}`);
      return outputPath;
    }
    return null;
  } catch (err: any) {
    logger.error(`Lỗi edit video: ${err.message}`);
    return null;
  }
}
