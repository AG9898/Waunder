# syntax=docker/dockerfile:1

# The Playwright base image ships the browsers and OS dependencies the worker
# needs. Keep the tag in sync with the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
