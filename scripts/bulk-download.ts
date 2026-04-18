// scripts/bulk-download.ts
// Chạy: npx tsx scripts/bulk-download.ts urls.txt

import { bulkDownloadFromFile } from "../src/downloader/video-downloader";

const filePath = process.argv[2] || "urls.txt";

console.log(`\n📥 Bắt đầu tải hàng loạt từ: ${filePath}\n`);

bulkDownloadFromFile(filePath)
  .then(() => {
    console.log("\n✅ Hoàn tất!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Lỗi:", err.message);
    process.exit(1);
  });
