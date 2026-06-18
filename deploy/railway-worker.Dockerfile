# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS build
WORKDIR /app
COPY workers/package.json workers/package-lock.json ./
RUN npm ci
COPY workers/ .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app
ENV NODE_ENV=production
COPY workers/package.json workers/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
