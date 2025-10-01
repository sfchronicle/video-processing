const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const AWS = require('aws-sdk');
const { exec, execSync } = require('child_process');

// This loads the .env file
// Copy and enter new values in the .env.example to set this up
require('dotenv').config();
// Set up access to the S3 bucket where files will land:
const s3_accesskeyid = process.env.s3_accesskeyid;
const s3_secretaccesskey = process.env.s3_secretaccesskey;
const s3_bucket = process.env.s3_bucket;
const s3_path = process.env.s3_path;
const s3_bucket_sfc = process.env.s3_bucket_sfc || s3_bucket; // Different bucket for sfcCustom uploads
const s3_path_sfc = process.env.s3_path_sfc || s3_path; // Different path for sfcCustom uploads
const cache_domain = process.env.cache_domain; // << This is the cache URL we want to actually serve files from -- you can make this the s3 domain if that's your preference
const allow_nonvideo_uploads = process.env.allow_nonvideo_uploads; // << You can allow users to upload nonvideo files or not by setting this boolean

const s3 = new AWS.S3({
  accessKeyId: s3_accesskeyid,
  secretAccessKey: s3_secretaccesskey
});

const node_upload = multer( { dest: './public/uploads/' } );

const uploadFile = (fileName, renameName, isSfcCustom = false) => {
  // Read content from the file
  const fileContent = fs.readFileSync(fileName);

  // Setting up S3 upload parameters
  let foundName = fileName.substr(fileName.lastIndexOf('/') + 1);
  if (renameName){
    foundName = renameName;
  }
  
  // Use different bucket/path for sfcCustom uploads
  const bucket = isSfcCustom ? s3_bucket_sfc : s3_bucket;
  const path = isSfcCustom ? s3_path_sfc : s3_path;
  const fileLocation = path + foundName;
  
  const params = {
    Bucket: bucket,
    Key: fileLocation, // File name you want to save as in S3
    Body: fileContent
  };

  // Uploading files to the bucket
  s3.upload(params, function(err, data) {
    if (err) {
      throw err;
    }
    console.log(`File uploaded successfully. ${data.Location}`);
  });
};

const removeFile = (fileName) => {
  // Whether or not it was successful, remove from file system
  fs.unlink(fileName, function(err) {
    if(err && err.code == 'ENOENT') {
      // file doesn't exist
      console.info("File doesn't exist, won't remove it");
    } else if (err) {
      // other errors, e.g. maybe we don't have enough permission
      console.error("Error occurred while trying to remove file");
    } else {
      console.info("Removed file! All systems looking good");
    }
  });
}

// Helper function to run ffmpeg commands (from alex-script-converted.js)
const runFfmpegCommand = (cmd) => {
  console.log(`\nRunning:\n${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (error) {
    console.error('FFmpeg command failed:', error);
    throw error;
  }
};

// Helper function to build video variants (from alex-script-converted.js)
const buildVideoVariants = (input, suffix, scale, isSquare = false, audioFlag = '') => {
  const out = `${input}_${suffix}`;
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

  // MP4
  runFfmpegCommand(`ffmpeg -y -i ${input} -vcodec libx264 -vf "${scale},fps=30" -crf ${crfMP4} ${audioFlag} -preset veryslow ${mp4}`);

  // WebM (2-pass VP9)
  runFfmpegCommand(`ffmpeg -y -i ${mp4} -c:v libvpx-vp9 -b:v ${bitrate} -crf ${crfWebM} ${audioFlag} -pass 1 -an -f webm -loglevel error -passlogfile ${statsLog} /dev/null`);
  runFfmpegCommand(`ffmpeg -y -i ${mp4} -c:v libvpx-vp9 -b:v ${bitrate} -crf ${crfWebM} ${audioFlag} -pass 2 -c:a libopus -f webm -loglevel error -passlogfile ${statsLog} ${webm}`);

  // Poster image
  runFfmpegCommand(`ffmpeg -y -i ${mp4} -vf "select=eq(n\\,0)" -frames:v 1 -c:v libwebp ${webp}`);

  // HLS Output 
  runFfmpegCommand(`ffmpeg -y -i ${mp4} -c:v libx264 -crf ${crfHLS} -preset veryslow -c:a aac -f hls -hls_time 3 -hls_playlist_type vod -hls_segment_filename ${out}_%03d.ts ${hls}`);

  // Cleanup 2-pass log files
  if (fs.existsSync(`${statsLog}-0.log`)) fs.unlinkSync(`${statsLog}-0.log`);
  if (fs.existsSync(`${statsLog}-0.log.mbtree`)) fs.unlinkSync(`${statsLog}-0.log.mbtree`);

  return { mp4, webm, webp, hls };
};

const server_config = {
  name: 'video-processing',
  port: 8003,
  host: '0.0.0.0',
};

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'))
app.use(express.urlencoded())

app.get('/', (req, res) => {
  res.status(200).sendFile(path.join(__dirname + '/index.html'));
});

app.post('/file-upload', node_upload.single('file'), function (req, res, next) {
  // Let's be optimistic:
  let error = false;
  const formData = JSON.parse(req.body.formData);
  const fileData = req.file;

  // Get the base name coming into the system (NO EXTENSION)
  const pos = fileData.originalname.lastIndexOf(".");
  const rootName = fileData.originalname.substr(0, pos < 0 ? fileData.originalname.length : pos);

  // Get final names for export
  const finalFilename = fileData.destination+formData.prefix+"_"+rootName;
  const mp4File = finalFilename + ".mp4";
  const m3u8File = finalFilename + ".m3u8";
  const posterFile = finalFilename + ".jpg";

  // Check if this is an sfcCustom upload
  const isSfcCustom = formData.sfcCustom === true || formData.sfcCustom === 'true';
  const isSquareVideo = formData.isSquareVideo === true || formData.isSquareVideo === 'true';

  if (fileData.mimetype.indexOf("video") !== -1){
    
    if (isSfcCustom) {
      // Use alex-script-converted.js logic for sfcCustom uploads
      try {
        // Determine aspect ratio (defaulting to 16:9 for now, could be made configurable)
        const aspectRatio = formData.aspectRatio || '1'; // 1 = 16:9, 2 = 3:2, 3 = 47:36
        
        // Audio flag
        const removeAudio = formData.removeAudio === true || formData.removeAudio === 'true';
        const audioFlag = removeAudio ? '-an' : '';

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

        const baseInput = fileData.path;
        
        if (isSquareVideo) {
          // Build square video variants
          const square1280 = buildVideoVariants(baseInput, '1280', desktopRatio, true, audioFlag);
          const square960 = buildVideoVariants(baseInput, '960', squareRatio, true, audioFlag);
          const square480 = buildVideoVariants(baseInput, '480', mobileSquareRatio, true, audioFlag);
          
          // Upload all generated files to S3
          uploadFile(square1280.mp4, formData.prefix+"_"+rootName+"_1280.mp4", true);
          uploadFile(square1280.webm, formData.prefix+"_"+rootName+"_1280.webm", true);
          uploadFile(square1280.webp, formData.prefix+"_"+rootName+"_1280.webp", true);
          uploadFile(square1280.hls, formData.prefix+"_"+rootName+"_1280.m3u8", true);
          
          uploadFile(square960.mp4, formData.prefix+"_"+rootName+"_960.mp4", true);
          uploadFile(square960.webm, formData.prefix+"_"+rootName+"_960.webm", true);
          uploadFile(square960.webp, formData.prefix+"_"+rootName+"_960.webp", true);
          uploadFile(square960.hls, formData.prefix+"_"+rootName+"_960.m3u8", true);
          
          uploadFile(square480.mp4, formData.prefix+"_"+rootName+"_480.mp4", true);
          uploadFile(square480.webm, formData.prefix+"_"+rootName+"_480.webm", true);
          uploadFile(square480.webp, formData.prefix+"_"+rootName+"_480.webp", true);
          uploadFile(square480.hls, formData.prefix+"_"+rootName+"_480.m3u8", true);
          
          // Clean up files
          [square1280.mp4, square1280.webm, square1280.webp, square1280.hls,
           square960.mp4, square960.webm, square960.webp, square960.hls,
           square480.mp4, square480.webm, square480.webp, square480.hls].forEach(removeFile);
           
        } else {
          // Build regular video variants
          const regular1280 = buildVideoVariants(baseInput, '1280', desktopRatio, false, audioFlag);
          const regular960 = buildVideoVariants(baseInput, '960', tabletRatio, false, audioFlag);
          const regular480 = buildVideoVariants(baseInput, '480', mobileRatio, false, audioFlag);
          
          // Upload all generated files to S3
          uploadFile(regular1280.mp4, formData.prefix+"_"+rootName+"_1280.mp4", true);
          uploadFile(regular1280.webm, formData.prefix+"_"+rootName+"_1280.webm", true);
          uploadFile(regular1280.webp, formData.prefix+"_"+rootName+"_1280.webp", true);
          uploadFile(regular1280.hls, formData.prefix+"_"+rootName+"_1280.m3u8", true);
          
          uploadFile(regular960.mp4, formData.prefix+"_"+rootName+"_960.mp4", true);
          uploadFile(regular960.webm, formData.prefix+"_"+rootName+"_960.webm", true);
          uploadFile(regular960.webp, formData.prefix+"_"+rootName+"_960.webp", true);
          uploadFile(regular960.hls, formData.prefix+"_"+rootName+"_960.m3u8", true);
          
          uploadFile(regular480.mp4, formData.prefix+"_"+rootName+"_480.mp4", true);
          uploadFile(regular480.webm, formData.prefix+"_"+rootName+"_480.webm", true);
          uploadFile(regular480.webp, formData.prefix+"_"+rootName+"_480.webp", true);
          uploadFile(regular480.hls, formData.prefix+"_"+rootName+"_480.m3u8", true);
          
          // Clean up files
          [regular1280.mp4, regular1280.webm, regular1280.webp, regular1280.hls,
           regular960.mp4, regular960.webm, regular960.webp, regular960.hls,
           regular480.mp4, regular480.webm, regular480.webp, regular480.hls].forEach(removeFile);
        }
        
        // Remove original file
        removeFile(fileData.path);
        
        // Return response with SFC custom URLs
        const returnObj = {
          desktop_url: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_1280.mp4",
          tablet_url: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_960.mp4",
          mobile_url: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_480.mp4",
          desktop_webm: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_1280.webm",
          tablet_webm: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_960.webm",
          mobile_webm: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_480.webm",
          desktop_poster: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_1280.webp",
          tablet_poster: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_960.webp",
          mobile_poster: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_480.webp",
          desktop_hls: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_1280.m3u8",
          tablet_hls: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_960.m3u8",
          mobile_hls: cache_domain+s3_path_sfc+formData.prefix+"_"+rootName+"_480.m3u8"
        }
        
        return res.status(200).send(returnObj);
        
      } catch (error) {
        console.error('SFC Custom processing error:', error);
        return res.status(500).send({error: "SFC Custom processing failed"});
      }
      
    } else {
      // Original server.js logic for regular uploads
      // If we have a high quality setting, make the adjustment
      let qualValue = "-crf 24 ";
      if (formData.quality === "high"){
        qualValue = "-crf 18 ";
      } 

      // If we have a resize value, make the adjustment
      let resizeValue = "";
      if (formData.size === "tablet"){
        resizeValue = " -vf scale=1280:-2";
      } else if (formData.size === "mobile"){
        resizeValue = " -vf scale=768:-2";
      }
      
      // Do ffmpeg stuff here to create the versions of the video and the poster frame
      exec('ffmpeg -y -i '+fileData.path+resizeValue+' -vcodec libx264 '+qualValue+mp4File, (err, stdout, stderr) => {
        if (err){
          console.log("err:", err);
          return res.status( 500 );
        }
        if (stderr){
          console.log("stderr:", stderr);
        }
        // Upload the file to S3
        uploadFile(mp4File);
        // Now cut the poster image off the resized mp4
        exec('ffmpeg -y -i '+mp4File+' -vframes 1 -q:v 9 '+posterFile, (err, stdout, stderr) => {
          if (err){
            console.log("err:", err);
            return res.status( 500 );
          }
          if (stderr){
            console.log("stderr:", stderr);
          }
          // Upload the file to S3
          uploadFile(posterFile);
          // Remove files
          removeFile(posterFile);
          // Remove source mp4
          removeFile(mp4File);

          // Now create the mobile version
          exec('ffmpeg -y -i '+fileData.path+resizeValue+' -vcodec libx264 '+qualValue+m3u8File, (err, stdout, stderr) => {
            if (err){
              console.log("err:", err);
              return res.status( 500 );
            }
            if (stderr){
              console.log("stderr:", stderr);
            }
            // Upload the file to S3
            uploadFile(m3u8File);
            // Remove files
            removeFile(m3u8File);
            // Now loop through and send the playlist files
            let loopDone = false;
            let loopCount = 0;
            while (!loopDone){
              let pos = m3u8File.lastIndexOf(".");
              let checkFile = m3u8File.substr(0, pos < 0 ? m3u8File.length : pos) + loopCount + ".ts";
              if (fs.existsSync(checkFile)) {
                // Upload the file to S3
                uploadFile(checkFile);
                // Remove files
                removeFile(checkFile);
                // Increment
                loopCount++;
              } else {
                // We ran out of playlist files, exit the loop
                loopDone = true;
              }
            }

            // EVERYTHING COMPLETED SUCCESSFULLY!
            // Remove the original file
            removeFile(fileData.path);
          });
        });
      });

      // Send a response back right away since this will take a while
      const returnObj = {
        desktop_url: cache_domain+s3_path+formData.prefix+"_"+rootName+".mp4",
        mobile_url: cache_domain+s3_path+formData.prefix+"_"+rootName+".m3u8",
        poster_url: cache_domain+s3_path+formData.prefix+"_"+rootName+".jpg",
      }

      // Return resp
      return res.status( 200 ).send( returnObj );
    }

  } else if (allow_nonvideo_uploads === "true") {
    // If this isn't a video file, just upload it directly for user
    // Upload the file to S3
    uploadFile(fileData.path, formData.prefix+"_"+fileData.originalname, isSfcCustom);
    // Remove file
    removeFile(fileData.path);
    // Return resp
    const returnObj = {
      file_url: cache_domain+(isSfcCustom ? s3_path_sfc : s3_path)+formData.prefix+"_"+fileData.originalname
    }
    // Return resp
    return res.status( 200 ).send( returnObj );
  } else {
    // Just error out
    return res.status( 400 ).send({error: "unsupported file"});
  }
});



app.listen(server_config.port, server_config.host, (e)=> {
  if(e) {
    throw new Error('Internal Server Error');
  }
});
