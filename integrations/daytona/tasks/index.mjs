// The controlled-task registry — business scenarios an AI agent runs into.
// Every task is gold-by-construction: a known failure, a known fix, and a
// deterministic oracle. Spread across real business functions AND distinct
// flywheel error classes, so the benchmark shows the measurement works broadly.
import { task as billing } from "./billing-invoice.mjs";
import { task as support } from "./support-record.mjs";
import { task as payments } from "./payments-integration.mjs";
import { task as analytics } from "./analytics-report.mjs";
import { task as orders } from "./orders-validation.mjs";
import { task as quality } from "./quality-check.mjs";

export const TASKS = [billing, support, payments, analytics, orders, quality];

export function getTask(id) {
  return TASKS.find((t) => t.id === id) ?? null;
}
