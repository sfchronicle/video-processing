
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const AWS = require('aws-sdk');
const { exec } = require('child_process');

// This loads the .env file
// Copy and enter new values in the .env.example to set this up
require('dotenv').config();
// Set up access to the S3 bucket where files will land:
const s3_accesskeyid = process.env.s3_accesskeyid;
const s3_secretaccesskey = process.env.s3_secretaccesskey;
const s3_bucket = process.env.s3_bucket;
const s3_path = process.env.s3_path;
const cache_domain = process.env.cache_domain; // << This is the cache URL we want to actually serve files from -- you can make this the s3 domain if that's your preference
const allow_nonvideo_uploads = process.env.allow_nonvideo_uploads; // << You can allow users to upload nonvideo files or not by setting this boolean

const s3 = new AWS.S3({
  accessKeyId: s3_accesskeyid,
  secretAccessKey: s3_secretaccesskey
});

const node_upload = multer( { dest: './public/uploads/' } );

const uploadFile = (fileName, renameName) => {
  // Read content from the file
  const fileContent = fs.readFileSync(fileName);

  // Setting up S3 upload parameters
  let foundName = fileName.substr(fileName.lastIndexOf('/') + 1);
  if (renameName){
    foundName = renameName;
  }
  const fileLocation = s3_path+foundName;
  const params = {
    Bucket: s3_bucket,
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
  
  if (fileData.mimetype.indexOf("video") !== -1){
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

  } else if (allow_nonvideo_uploads) {
    // If this isn't a video file, just upload it directly for user
    // Upload the file to S3
    uploadFile(fileData.path, formData.prefix+"_"+fileData.originalname);
    // Remove file
    removeFile(fileData.path);
    // Return resp
    const returnObj = {
      file_url: cache_domain+s3_path+formData.prefix+"_"+fileData.originalname
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
