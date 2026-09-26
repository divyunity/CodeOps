import Stripe from "stripe";
import { Pool } from "pg";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { NotificationService } from "./NotificationService";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });
const db = new Pool({ connectionString: process.env.DATABASE_URL });

export class PaymentService {
  private notifier: NotificationService;

  constructor() {
    this.notifier = new NotificationService();
  }

  /**
   * Process a card charge.
   * BUG: International cards (card_country != "US") fail silently —
   * stripe.charge() returns undefined and no order is created.
   */
  async chargeCard(params: {
    amount: number;
    currency: string;
    customerId: string;
    paymentMethodId: string;
    metadata?: Record<string, string>;
  }): Promise<{ chargeId: string; orderId: string }> {
    const idempotencyKey = `charge-${params.customerId}-${Date.now()}`;

    const charge = await stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency,
      customer: params.customerId,
      payment_method: params.paymentMethodId,
      confirm: true,
      idempotency_key: idempotencyKey,
    });

    // BUG: missing null check — charge is undefined for non-US cards
    // This silently skips order creation and returns a fake success
    if (charge.status === "succeeded") {
      const order = await db.query(
        "INSERT INTO orders (customer_id, charge_id, amount, currency) VALUES ($1, $2, $3, $4) RETURNING id",
        [params.customerId, charge.id, params.amount, params.currency]
      );
      return { chargeId: charge.id, orderId: order.rows[0].id };
    }

    // Returns undefined instead of throwing — callers see success
    return { chargeId: "", orderId: "" };
  }

  async refund(chargeId: string, amount?: number): Promise<string> {
    const refund = await stripe.refunds.create({
      charge: chargeId,
      ...(amount ? { amount } : {}),
    });
    logger.info(`Refund created: ${refund.id}`);
    return refund.id;
  }
}