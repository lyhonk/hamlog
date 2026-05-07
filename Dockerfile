FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --workspaces

COPY client client
COPY server server
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4174

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace server --omit=dev

COPY server server
COPY --from=builder /app/client/dist client/dist

EXPOSE 4174
CMD ["npm", "--workspace", "server", "run", "start"]
