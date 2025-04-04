// server.js
const express = require("express");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const HLS_DIR = path.join(__dirname, "hls-playback");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(HLS_DIR)) fs.mkdirSync(HLS_DIR);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `video-${Date.now()}.mp4`)
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use("/hls-playback", express.static(HLS_DIR));

app.post("/convert", upload.single("video"), async (req, res) => {
  const inputPath = req.file.path;
  const folderName = Date.now().toString();
  const outputDir = path.join(HLS_DIR, folderName);
  fs.mkdirSync(outputDir);

  const resolutions = [
    { name: "480p", size: "854x480", bitrate: "800k" },
    { name: "720p", size: "1280x720", bitrate: "1400k" },
    { name: "1080p", size: "1920x1080", bitrate: "3000k" },
  ];

  const m3u8s = [];

  const convertStream = (res) => new Promise((resolve, reject) => {
    const outPath = path.join(outputDir, `${res.name}.m3u8`);
    m3u8s.push({ path: `${res.name}.m3u8`, resolution: res.size, bandwidth: res.bitrate });

    ffmpeg(inputPath)
      .videoBitrate(res.bitrate)
      .size(res.size)
      .outputOptions([
        "-profile:v main",
        "-crf 20",
        "-sc_threshold 0",
        "-g 48",
        "-keyint_min 48",
        "-hls_time 10",
        "-hls_playlist_type vod",
        `-hls_segment_filename ${outputDir}/${res.name}_%03d.ts`
      ])
      .output(outPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  try {
    for (const res of resolutions) {
      await convertStream(res);
    }

    const master = m3u8s.map(item => `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(item.bandwidth)},RESOLUTION=${item.resolution}\n${item.path}`).join("\n");
    const masterContent = `#EXTM3U\n${master}`;
    fs.writeFileSync(path.join(outputDir, "master.m3u8"), masterContent);

    res.json({ url: `/hls-playback/${folderName}/master.m3u8` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Conversion failed" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
      
