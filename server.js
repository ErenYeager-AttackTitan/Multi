// server.js
const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Clean old files
fs.readdir(PUBLIC_DIR, (err, files) => {
  if (err) return;
  files.forEach((file) => {
    const filePath = path.join(PUBLIC_DIR, file);
    fs.stat(filePath, (err, stats) => {
      if (err) return;
      if (Date.now() - stats.mtimeMs > 15 * 60 * 1000) {
        fs.unlink(filePath, () => console.log(`Deleted old file: ${file}`));
      }
    });
  });
});

async function getHighestQualityM3U8(masterUrl) {
  const res = await axios.get(masterUrl);
  const lines = res.data.split("#EXT-X-STREAM-INF");
  const variants = lines.slice(1).map(block => {
    const match = block.match(/BANDWIDTH=(\d+).*?\n(.*)/);
    return match ? { bandwidth: parseInt(match[1]), url: match[2].trim() } : null;
  }).filter(Boolean);
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  const baseUrl = new URL(masterUrl);
  return new URL(variants[0].url, baseUrl).href;
}

app.post("/convert", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "No M3U8 URL provided" });

  try {
    let finalUrl = url;
    const response = await axios.get(url);
    if (response.data.includes("#EXT-X-STREAM-INF")) {
      finalUrl = await getHighestQualityM3U8(url);
    }

    const filename = `video-${Date.now()}.mp4`;
    const outputPath = path.join(PUBLIC_DIR, filename);

    ffmpeg(finalUrl)
      .outputOptions("-c copy")
      .on("end", () => {
        console.log(`Finished: ${filename}`);
        res.json({ url: `/download/${filename}` });
        setTimeout(() => {
          fs.unlink(outputPath, () => console.log(`Auto-deleted: ${filename}`));
        }, 10 * 60 * 1000);
      })
      .on("error", (err) => {
        console.error(err);
        res.status(500).json({ error: "Conversion failed" });
      })
      .save(outputPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch or parse M3U8" });
  }
});

app.get("/download/:filename", (req, res) => {
  const filePath = path.join(PUBLIC_DIR, req.params.filename);
  res.download(filePath, (err) => {
    if (!err) {
      fs.unlink(filePath, () => console.log(`Deleted after download: ${req.params.filename}`));
    }
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
