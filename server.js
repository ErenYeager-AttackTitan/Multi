const express = require("express");
const multer = require("multer");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Enable CORS for all domains
app.use(express.json());
app.use(express.static("public"));
app.use("/hls-playback", express.static("hls-playback")); // Serve HLS files

// Multer config
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// Upload route
app.post("/upload", upload.single("video"), (req, res) => {
  const filename = req.file.filename;
  res.json({ filename });
});

// Convert route
app.post("/convert", async (req, res) => {
  const filename = req.body.filename;
  const inputPath = path.join(__dirname, "uploads", filename);
  const folderName = Date.now().toString();
  const outputFolder = path.join(__dirname, "hls-playback", folderName);

  fs.mkdirSync(outputFolder, { recursive: true });

  const resolutions = [
    { name: "480p", width: 854, height: 480, bitrate: "800k" },
    { name: "720p", width: 1280, height: 720, bitrate: "1400k" },
    { name: "1080p", width: 1920, height: 1080, bitrate: "2500k" },
  ];

  const variants = [];

  const processRes = (resIndex) => {
    return new Promise((resolve, reject) => {
      const { name, width, height, bitrate } = resolutions[resIndex];
      const outPath = path.join(outputFolder, `${name}.m3u8`);

      ffmpeg(inputPath)
        .videoBitrate(bitrate)
        .size(`${width}x${height}`)
        .outputOptions([
          "-profile:v main",
          "-preset veryfast",
          "-g 48",
          "-keyint_min 48",
          "-sc_threshold 0",
          "-hls_time 4",
          "-hls_list_size 0",
          "-f hls",
        ])
        .output(outPath)
        .on("end", () => {
          variants.push({
            bandwidth:
              resIndex === 0 ? 800000 : resIndex === 1 ? 1400000 : 2500000,
            resolution: `${width}x${height}`,
            url: `${name}.m3u8`,
          });
          resolve();
        })
        .on("error", reject)
        .run();
    });
  };

  try {
    for (let i = 0; i < resolutions.length; i++) {
      await processRes(i);
    }

    // Create master.m3u8
    const masterPath = path.join(outputFolder, "master.m3u8");
    let masterContent = "#EXTM3U\n";

    for (const v of variants) {
      masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.resolution}\n${v.url}\n`;
    }

    fs.writeFileSync(masterPath, masterContent);

    // Respond with the master.m3u8 path
    res.json({ m3u8: `hls-playback/${folderName}/master.m3u8` });
  } catch (err) {
    console.error(err);
    res.status(500).send("Conversion failed.");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
