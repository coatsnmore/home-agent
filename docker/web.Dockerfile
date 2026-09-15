# Modern Node.js container for Web Frontend
FROM node:22-slim

WORKDIR /app/services/web

COPY services/web/package*.json ./
RUN npm install

COPY services/web ./

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
