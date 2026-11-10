FROM node:20-slim
WORKDIR /app
COPY backend/package*.json backend/
RUN npm --prefix backend ci --omit=dev
COPY backend backend
COPY frontend frontend
COPY db db
COPY data data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "backend/src/index.js"]
