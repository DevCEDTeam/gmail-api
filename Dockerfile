# Dockerfile for the Blue Truck SMTP Relay
# Deploys to Cloud Run as gmail-relay service
#
# Build:
#   docker build -t gmail-relay .
#
# Run locally:
#   docker run --env-file .env -p 3000:3000 -p 3001:3001 gmail-relay
#
# Deploy to Cloud Run:
#   gcloud run deploy gmail-relay \
#     --image gcr.io/gmail-bulk-sending-389112/gmail-relay \
#     --region us-central1 \
#     --platform managed \
#     --allow-unauthenticated

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --production

COPY . .

EXPOSE 3000 3001

CMD ["node", "app.js"]
