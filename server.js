const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

// Setup multer for full upload speed (writes to disk directly)
const upload = multer({
  storage: multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB max
});

// Route: Upload MP4
app.post("/upload", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video uploaded" });

  res.json({ filename: req.file.filename });
});

// Route: Convert MP4 to HLS
app.post("/convert", async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: "Missing filename" });

  const inputPath = path.join(__dirname, "uploads", filename);
  const folderId = `${Date.now()}`;
  const outputDir = path.join(__dirname, "hls-playback", folderId);

  fs.mkdirSync(outputDir, { recursive: true });

  const variants = [
    { resolution: "854x480", bitrate: 800, name: "480p" },
    { resolution: "1280x720", bitrate: 1400, name: "720p" },
    { resolution: "1920x1080", bitrate: 3000, name: "1080p" },
  ];

  let completed = 0;

  variants.forEach((variant) => {
    const outputPath = path.join(outputDir, `${variant.name}.m3u8`);
    const segmentPath = `${outputDir}/${variant.name}_%03d.ts`;

    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=${variant.resolution}`,
        `-c:v libx264`,
        `-b:v ${variant.bitrate}k`,
        `-c:a aac`,
        `-hls_time 10`,
        `-hls_playlist_type vod`,
        `-hls_segment_filename ${segmentPath}`,
      ])
      .output(outputPath)
      .on("end", () => {
        completed++;
        if (completed === variants.length) {
          const masterContent = variants
            .map(
              (v) =>
                `#EXT-X-STREAM-INF:BANDWIDTH=${v.bitrate * 1000},RESOLUTION=${v.resolution}\n${v.name}.m3u8`
            )
            .join("\n");

          const masterPath = path.join(outputDir, "master.m3u8");
          fs.writeFileSync(masterPath, "#EXTM3U\n" + masterContent);

          res.json({
            message: "Conversion complete",
            m3u8: `/hls-playback/${folderId}/master.m3u8`,
          });
        }
      })
      .on("error", (err) => {
        console.error("FFmpeg error:", err);
        res.status(500).json({ error: "FFmpeg conversion failed" });
      })
      .run();
  });
});

// Serve the HLS content
app.use("/hls-playback", express.static(path.join(__dirname, "hls-playback")));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
     
