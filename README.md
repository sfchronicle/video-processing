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

*You wrote XYZ in a dumb, inefficient way. How do I file a complaint?*

Better yet, file a pull request! This was written as a kludge and could definitely use some optimization. Or extra customization options!