FROM node:11-alpine

RUN apk add  --no-cache ffmpeg

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

COPY . .

RUN npm install

EXPOSE 8003

CMD ["npm", "run", "start"]