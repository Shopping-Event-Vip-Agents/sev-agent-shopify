import cron from "node-cron";
import type { ShopifyAgent } from "./agent.js";

let syncTask: cron.ScheduledTask | null = null;

export function initScheduler(agent: ShopifyAgent): void {
  if (process.env.PAPERCLIP_SCHEDULING_ENABLED === "true") {
    console.log("Paperclip scheduling enabled — skipping node-cron");
    return;
  }

  // Daily at 6:00 AM Brussels time — scan for untranslated products
  syncTask = cron.schedule(
    "0 6 * * *",
    async () => {
      console.log("Running daily untranslated scan...");
      try {
        const { getAllTranslatableResources } = await import("@domien-sev/shopify-sdk");
        const resources = await getAllTranslatableResources(agent.shopify, "fr");
        const untranslated = resources.filter(
          (r) => r.translations.length === 0 || r.translations.length < r.translatableContent.length,
        );
        console.log(`Daily scan: ${untranslated.length}/${resources.length} products need FR translation`);

        // Post to Slack via agent_events if there are untranslated products
        if (untranslated.length > 0) {
          const directus = agent.directus.getClient("sev-ai");
          const { createItem } = await import("@directus/sdk");
          await directus.request(
            createItem("agent_events" as never, {
              agent: "shopify",
              type: "slack_message",
              data: {
                channel_id: process.env.SLACK_CHANNEL ?? "shopify",
                text: `Daily scan: ${untranslated.length} products need FR translation (${resources.length} total)`,
              },
            } as never),
          );
        }
      } catch (err) {
        console.error("Daily scan failed:", err);
      }
    },
    { timezone: "Europe/Brussels" },
  );
}

export function stopScheduler(): void {
  syncTask?.stop();
}
