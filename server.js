const express = require("express");
const multer = require("multer");
const cors = require("cors");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));
app.use("/hls-playback", express.static("hls-playback"));

const storage = multer.diskStorage({
  destination: "uploads",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.post("/convert", upload.single("video"), async (req, res) => {
  const timestamp = Date.now().toString();
  const folder = `hls-playback/${timestamp}`;
  const filepath = req.file.path;

  fs.mkdirSync(folder, { recursive: true });

  const resolutions = [
    { name: "480p", width: 854, height: 480, bitrate: "800k" },
    { name: "720p", width: 1280, height: 720, bitrate: "1500k" },
    { name: "1080p", width: 1920, height: 1080, bitrate: "3000k" }
  ];

  const variants = [];

  const convertOne = (resObj) => {
    return new Promise((resolve, reject) => {
      const outputName = `${resObj.name}.m3u8`;
      const outputPath = `${folder}/${outputName}`;

      ffmpeg(filepath)
        .outputOptions([
          "-preset veryfast",
          "-g 48",
          "-sc_threshold 0",
          `-b:v ${resObj.bitrate}`,
          "-maxrate " + resObj.bitrate,
          "-bufsize 1000k",
          "-hls_time 10",
          "-hls_list_size 0",
          "-hls_segment_filename", `${folder}/${resObj.name}_%03d.ts`
        ])
        .size(`${resObj.width}x${resObj.height}`)
        .output(outputPath)
        .on("end", () => {
          console.log(`${resObj.name} done`);
          variants.push({
            resolution: resObj,
            path: outputName,
            bandwidth: parseInt(resObj.bitrate),
          });
          resolve();
        })
        .on("error", reject)
        .run();
    });
  };

  for (let resObj of resolutions) {
    await convertOne(resObj);
  }

  const masterPlaylist = variants.map(v => {
    return `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},RESOLUTION=${v.resolution.width}x${v.resolution.height}\n${v.path}`;
  }).join("\n");

  fs.writeFileSync(`${folder}/master.m3u8`, "#EXTM3U\n" + masterPlaylist);

  const m3u8Url = `/hls-playback/${timestamp}/master.m3u8`;
  console.log("Your m3u8 URL:", m3u8Url);
  res.json({ url: m3u8Url });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
              
