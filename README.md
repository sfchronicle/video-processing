# SFC Video Processing

![Slate](https://files.sfchronicle.com/static-assets/misc/slate.jpg)

<sup>Photo by Donovan Silva on Unsplash</sup>

Compress videos the SF Chronicle way! This repo creates a simple config/upload page running on an express backend in a Docker container. By dropping a video onto the dropzone, the app will 
1. Process your video into .mp4 (desktop) and .m3u8 (mobile) formats
2. Upload them directly to a specified S3 bucket, and even
3. Create a poster image from the first video frame

Once you've got those URLs, you can include that video in your live pages like so:

```
<video poster="POSTER-URL">
  <source src="M3U8-MOBILE-URL" type="application/vnd.apple.mpegurl" />
  <source src="MP4-DESKTOP-URL" type="video/mp4" />    
</video>
```

To get this running locally (or on an EC2):

1. Make sure you have [Docker and Docker Compose installed](https://docs.docker.com/compose/install/)
1. Clone this repo and navigate to the new folder
1. Configure your .env file from the .env.example
1. Run `docker-compose up` to run it in your current terminal or `docker-compose up -d` to run it in the background

You should be able to browse to http://localhost:8003 to see the running app! You can turn it off at any time by navigating back to that root folder and running `docker-compose down`.

Feel free to swap out the gifs to give the UI your org's special flavor.

## FAQ (maybe)

*What's the cache_domain option in .env?*

SFC uses a cache URL so users aren't making requests on the S3 bucket resources directly, but if you don't mind taking those requests, you can put the bucket domain there.

*How about the allow_nonvideo_uploads option?* 

You may just want to use this a simple video upload tool. If so, change that flag to false. But it's helpful for our newsroom teams who want S3 to host things like gif and pngs, since our CMS does not handle those well.

*What's the deal with the unique prefix field?*

This app is designed to upload resources to the S3 bucket using the following string:

`<prefix>_<original file name>.<various extensions>`

By default, it will populate with a fresh unix timestamp each day. Today's is 1577174400.

The prefix was a way to strike a balance between having files accidentally replace each other (myvideo.mp4 replaces an earlier myvideo.mp4) and having each file at a unique S3 path, creating tons of unneeded files (since video editors will make tweaks and reupload several times).

If editors are working on an ongoing project, they can also create and use their own arbitrary prefix to always update the same video.

*You wrote XYZ in a dumb, inefficient way. How do I file a complaint?*

Better yet, file a pull request! This was written as a kludge and could definitely use some optimization. Or extra customization options!