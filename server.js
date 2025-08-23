const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const translate = require("translate-google");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// 文章を分割する関数（句点や改行で分割）
function splitIntoSentences(text) {
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// 翻訳エンドポイント
app.get("/translate", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    // ページ取得
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // 本文テキスト抽出
    let text = $("body").text();
    let sentences = splitIntoSentences(text);

    // EventStream ヘッダ設定
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // バッチサイズ（3文ずつ翻訳）
    const batchSize = 3;

    // バッチごとに翻訳して順番に送信
    for (let i = 0; i < sentences.length; i += batchSize) {
      const batch = sentences.slice(i, i + batchSize);

      let jaBatch;
      try {
        jaBatch = await translate(batch, { from: "en", to: "ja" });
      } catch {
        // 1回リトライ
        try {
          jaBatch = await translate(batch, { from: "en", to: "ja" });
        } catch {
          jaBatch = "(翻訳失敗)";
        }
      }

      // jaBatch が配列で返る場合と文字列で返る場合の両対応
      if (Array.isArray(jaBatch)) {
        jaBatch.forEach(j => {
          res.write(`data: ${JSON.stringify({ ja: j })}\n\n`);
        });
      } else {
        res.write(`data: ${JSON.stringify({ ja: jaBatch })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch or translate" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
