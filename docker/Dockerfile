FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json packages/shared/
COPY packages/server/package*.json packages/server/
RUN npm ci --workspace=packages/shared --workspace=packages/server
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY tsconfig.json ./
RUN npm run build --workspace=packages/shared && npm run build --workspace=packages/server

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/server/migrations ./migrations
COPY --from=build /app/packages/shared/dist ./node_modules/@crmy/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@crmy/shared/package.json
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
