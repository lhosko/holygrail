FROM node:22-bookworm-slim
WORKDIR /app
# libexpat1: needed by canvas's prebuilt binary, used by the optional prismarine-viewer backup (VIEWER=1)
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
# canvas downloads a prebuilt binary from GitHub. On networks with TLS decryption that fails ("self-signed certificate
# in certificate chain") and npm silently drops canvas, so the viewer can't load. Trust the CAs in infra/certs (the
# `certs` build context in docker-compose.yml) during install only; no .pem files means no change.
RUN --mount=type=bind,from=certs,target=/certs \
    if ls /certs/*.pem >/dev/null 2>&1; then cat /certs/*.pem > /tmp/extra-ca.pem; export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; \
    npm install --omit=dev --no-audit --no-fund || npm install --omit=dev --omit=optional --no-audit --no-fund; \
    rm -f /tmp/extra-ca.pem
# prismarine-viewer predates worlds below y=0 (1.18+); our flat world is at y≈-60, so the browser showed only sky.
# Patch the bundled client: point the camera at the bot whatever its y, mesh sections from y=-64 to 320 (not 0-256),
# and index chunk sections from the column's minY (-64) instead of 0, otherwise every section below y=0 is skipped.
# No-ops if the viewer isn't installed.
RUN p=node_modules/prismarine-viewer/public; [ ! -d "$p" ] || { \
      sed -i -e 's/if(t\.y>0&&s&&(h\.target/if(s\&\&(h.target/' \
             -e 's/for(let i=0;i<256;i+=16)/for(let i=-64;i<320;i+=16)/g' "$p/index.js" && \
      sed -i -e 's/i\.sections\[Math\.floor(a\/16)\]/i.sections[Math.floor((a-(i.minY||0))\/16)]/' \
             -e 's/l\.sections\[Math\.floor(n\/16)\]/l.sections[Math.floor((n-(l.minY||0))\/16)]/' \
             -e 's/\.position\.y<0)continue/.position.y<-64)continue/g' "$p/worker.js"; }
COPY . .
USER node
EXPOSE 3000
CMD ["node", "server.js"]
