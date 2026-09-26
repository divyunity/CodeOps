# PayFlow — Payment Processing Service

A high-availability payment processing microservice handling card transactions, refunds, and subscription billing for enterprise customers.

## Stack
- Node.js 18 + TypeScript
- Express 4.x
- PostgreSQL 15 (primary) + Redis (cache/queue)
- Stripe SDK v12
- Jest + Supertest

## Services
- `PaymentService` — charge processing, refunds, idempotency
- `SubscriptionService` — recurring billing, trial management
- `WebhookService` — Stripe webhook ingestion and retry
- `NotificationService` — real-time alerts via WebSocket + email

## Quick Start
```bash
npm install
cp .env.example .env
npm run dev
```

## Environment
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret |

## Architecture
```
Client → API Gateway → PaymentService
                           ↓
                    Decision Engine
                    ↙      ↓      ↘
               Stripe   Database  Redis Queue
                           ↓
                    Notification
                    ↙           ↘
               WebSocket       Email
```