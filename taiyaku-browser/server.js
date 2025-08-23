const express = require("express");
const cheerio = require("cheerio");
const translate = require("translate-google");
const axios = require("axios");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

// ページごとの文キャッシュ
const pageCache = {};

// 文を分割する関数（略語対応）
function splitSentences(text) {
  const abbrevs = ["Mr","Mrs","Ms","Dr","St","Prof","etc","i.e","e.g","vs"];
  const regex = new RegExp(
    "\\b(?:" + abbrevs.join("|") + ")\\.$|" +
    "([.!?])\\s+(?=[A-Z])",
    "g"
  );

  let sentences = [];
  let start = 0;
  text.replace(regex, (match, punct, offset) => {
    sentences.push(text.slice(start, offset + (punct ? 1 : 0)).trim());
    start = offset + match.length;
    return match;
  });
  if (start < text.length) sentences.push(text.slice(start).trim());
  return sentences.filter(s => s.length > 0);
}

// EventSource でストリーム翻訳
app.get("/api/translate-stream", async (req, res) => {
  const url = req.query.url;
  const start = parseInt(req.query.start || "0", 10);
  if (!url) return res.status(400).send("url required");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // ページキャッシュから取得 or 新規取得
    let sentences;
    if (pageCache[url]) {
      sentences = pageCache[url];
    } else {
      const { data } = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const $ = cheerio.load(data);
      let originalText = "";

      // OL LI の本文を取得
      $("ol li").each((i, el) => {
        let t = $(el).text();               // HTMLタグを削除
        t = t.replace(/\s+/g, " ");         // 改行・複数空白を1スペースに
        originalText += t + " ";
      });

      // <ol><li> がなければ <p> も取得
      if (!originalText.trim()) {
        $("p").each((i, el) => {
          let t = $(el).text();
          t = t.replace(/\s+/g, " ");
          originalText += t + " ";
        });
      }

      sentences = splitSentences(originalText);
      pageCache[url] = sentences;
    }

    const batchSize = 3;    // 3文ごと
    const maxBatchSentences = 100; // 一度に100文まで

    const end = Math.min(sentences.length, start + maxBatchSentences);

    for (let i = start; i < end; i += batchSize) {
      const batch = sentences.slice(i, i + batchSize).join(" ");
      let jaBatch;
      try {
        jaBatch = await translate(batch, { from: "en", to: "ja" });
      } catch {
        jaBatch = "(翻訳失敗)";
      }

      res.write(`data: ${JSON.stringify({
        index: i,
        original: sentences.slice(i, i + batchSize).join(" "),
        text: jaBatch
      })}\n\n`);

      await new Promise(r => setTimeout(r, 100));
    }

    res.write("event: done\ndata: \n\n");
    res.end();

  } catch (err) {
    console.error("Fetch/Translate error:", err.message);
    res.write(`event: error\ndata: ${JSON.stringify(err.message)}\n\n`);
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
