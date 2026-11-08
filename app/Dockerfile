# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS test
ENV NODE_ENV=test
COPY package.json ./
COPY src ./src
COPY test ./test
RUN npm test

FROM base AS runtime
COPY package.json ./
COPY src ./src
# Match runAsNonRoot / runAsUser 1000 on the Rollout.
USER 1000
EXPOSE 8080
CMD ["node", "src/server.js"]
