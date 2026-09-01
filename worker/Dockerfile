FROM node:22-bookworm-slim
# ffmpeg mixes; python3 + Pillow draw caption plates; DejaVu is the burn-in font.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pil fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.json vitest.config.ts ./
RUN npm ci --omit=dev --ignore-scripts && npm install --no-save tsx
COPY src ./src
COPY worker ./worker
# Music library is resolved relative to the working directory (assets/music/**).
COPY assets/music ./assets/music
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "worker/src/server.ts"]
