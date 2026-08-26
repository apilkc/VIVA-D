# Railway deployment for the Rasuwa Flood Evidence Map.
# Runs the full Node app (uploads + social downloads + Google Drive archive)
# with Python 3.10+ and FFmpeg so yt-dlp can download and merge videos.

FROM node:20-bookworm-slim

# Python + FFmpeg for social-media downloads via the bundled yt-dlp.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ffmpeg \
        build-essential \
        python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Node builds native modules (better-sqlite3) against the runtime ABI.
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the application.
COPY . .

# Unprivileged user — safer on Railway.
RUN mkdir -p data && chown -R node:node /app
USER node

# Railway injects PORT automatically. Default to 3000 otherwise.
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]