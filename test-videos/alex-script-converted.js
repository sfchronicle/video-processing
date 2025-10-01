const readline = require("readline");
const { execSync } = require("child_process");
const fs = require("fs");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = question => new Promise(resolve => rl.question(question, resolve));

(async () => {
  const video = await ask("Enter path to video plus filename (no extension): ");
  const aspectRatio = await ask("Is the video not a 16:9 aspect ratio? (1 = 16:9, 2 = 3:2, 3 = 47:36): ");
  const square = await ask("Should mobile be a square? (y/n): ");
  let squareVideo = '';
  if (square.toLowerCase() === 'y') {
    squareVideo = await ask("Enter path to square version if hand cropped (leave blank otherwise): ");
  }
  const removeAudio = await ask("Remove audio? (y/n): ");
  rl.close();

  const audioFlag = removeAudio.toLowerCase() === 'n' ? '' : '-an';

  let desktopRatio, tabletRatio, mobileRatio, squareRatio, mobileSquareRatio;
  if (aspectRatio === '2') {
    desktopRatio = 'scale=1280:854';
    tabletRatio = 'scale=960:640';
    mobileRatio = 'scale=480:320';
    squareRatio = 'scale=1440:960, crop=960:960:240:0';
    mobileSquareRatio = 'scale=720:480, crop=480:480:120:0';
  } else if (aspectRatio === '3') {
    desktopRatio = 'scale=1280:980';
    tabletRatio = 'scale=960:734';
    mobileRatio = 'scale=480:366';
    squareRatio = 'scale=1252:960, crop=960:960:146:0';
    mobileSquareRatio = 'scale=626:480, crop=480:480:73:0';
  } else {
    desktopRatio = 'scale=1280:720';
    tabletRatio = 'scale=960:540';
    mobileRatio = 'scale=480:270';
    squareRatio = 'scale=1706:960, crop=960:960:335:0';
    mobileSquareRatio = 'scale=854:480, crop=480:480:168:0';
  }

  if (square.toLowerCase() === 'y' && squareVideo) {
    squareRatio = 'scale=960:960';
    mobileSquareRatio = 'scale=480:480';
  }

  const run = (cmd) => {
    console.log(`\nRunning:\n${cmd}\n`);
    execSync(cmd, { stdio: 'inherit' });
  };

  const build = (input, suffix, scale, isSquare = false) => {
    const out = `${video}_${suffix}`;
    const mp4 = `${out}.mp4`;
    const webm = `${out}.webm`;
    const webp = `${out}.webp`;
    const hls = `${out}.m3u8`;
    const statsLog = `ffmpeg2pass-${suffix}.log`;

    let crfMP4, crfWebM, crfHLS, bitrate;

    switch (suffix) {
      case '1280':
        crfMP4 = 22;
        crfWebM = isSquare ? 23 : 22;
        crfHLS = 22;
        bitrate = isSquare ? '1M' : '1.5M';
        break;
      case '960':
        crfMP4 = 24;
        crfWebM = 24;
        crfHLS = 28;
        bitrate = '500K';
        break;
      case '480':
        crfMP4 = isSquare ? 24 : 28;
        crfWebM = 28;
        crfHLS = 28;
        bitrate = '250K';
        break;
    }

    //flag for sfcvideo to do custom

    // MP4
    run(`ffmpeg -y -i ${input} -vcodec libx264 -vf "${scale},fps=30" -crf ${crfMP4} ${audioFlag} -preset veryslow ${mp4}`);

    // WebM (2-pass VP9)
    run(`ffmpeg -y -i ${mp4} -c:v libvpx-vp9 -b:v ${bitrate} -crf ${crfWebM} ${audioFlag} -pass 1 -an -f webm -loglevel error -passlogfile ${statsLog} /dev/null`);
    run(`ffmpeg -y -i ${mp4} -c:v libvpx-vp9 -b:v ${bitrate} -crf ${crfWebM} ${audioFlag} -pass 2 -c:a libopus -f webm -loglevel error -passlogfile ${statsLog} ${webm}`);

    // Poster image
    run(`ffmpeg -y -i ${mp4} -vf "select=eq(n\\,0)" -frames:v 1 -c:v libwebp ${webp}`);

    // HLS Output 
    run(`ffmpeg -y -i ${mp4} -c:v libx264 -crf ${crfHLS} -preset veryslow -c:a aac -f hls -hls_time 3 -hls_playlist_type vod -hls_segment_filename ${out}_%03d.ts ${hls}`);

    // Cleanup 2-pass log files
    if (fs.existsSync(`${statsLog}-0.log`)) fs.unlinkSync(`${statsLog}-0.log`);
    if (fs.existsSync(`${statsLog}-0.log.mbtree`)) fs.unlinkSync(`${statsLog}-0.log.mbtree`);
  };

  const baseInput = `${video}.mp4`;
  const squareInput = squareVideo ? `${squareVideo}.mp4` : baseInput;
  const isSquare = square.toLowerCase() === 'y';

  if (isSquare) {
    build(baseInput, '1280', desktopRatio, true);
    build(squareInput, '960', squareRatio, true);
    build(squareInput, '480', mobileSquareRatio, true);
  } else {
    build(baseInput, '1280', desktopRatio);
    build(baseInput, '960', tabletRatio);
    build(baseInput, '480', mobileRatio);
  }

})();
