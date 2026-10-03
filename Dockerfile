# Estate: Bun, its dependencies, and the source; the pages are bundled as it starts.
FROM oven/bun:1.3.11-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
USER bun
ENV ESTATE_SETTINGS=/etc/estate/estate.yaml
EXPOSE 8080
HEALTHCHECK CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["bun", "src/server/main.ts"]
