# Estate: the pages bundled as the image is built, then Bun, the production dependencies and the source.
FROM oven/bun:1.3.11-alpine AS pages
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN mkdir -p dist && bun src/server/bundle.ts src/web dist/pages.json && grep -q '^{"ok":true' dist/pages.json

FROM oven/bun:1.3.11-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY --from=pages /app/dist ./dist
USER bun
ENV ESTATE_SETTINGS=/etc/estate/estate.yaml
EXPOSE 8080
HEALTHCHECK CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["bun", "src/server/main.ts"]
