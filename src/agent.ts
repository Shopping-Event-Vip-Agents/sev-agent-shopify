import { BaseAgent } from "@domien-sev/agent-sdk";
import type { AgentConfig } from "@domien-sev/agent-sdk";
import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import { ShopifyAdminClient, DeepLClient } from "@domien-sev/shopify-sdk";

import { handleImport } from "./handlers/import.js";
import { handleTranslate } from "./handlers/translate.js";
import { handleEnrich } from "./handlers/enrich.js";
import { handleExport } from "./handlers/export.js";
import { handleStatus } from "./handlers/status.js";
import { handleProducts } from "./handlers/products.js";

export class ShopifyAgent extends BaseAgent {
  public shopify!: ShopifyAdminClient;
  public deepl?: DeepLClient;

  constructor(config: AgentConfig) {
    super(config);
  }

  async onStart(): Promise<void> {
    this.logger.info("Initializing Shopify agent...");

    // Initialize Shopify client
    if (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) {
      this.shopify = new ShopifyAdminClient({
        shop: process.env.SHOPIFY_SHOP ?? "",
        clientId: process.env.SHOPIFY_CLIENT_ID,
        clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
      });
    } else {
      this.shopify = new ShopifyAdminClient({
        shop: process.env.SHOPIFY_SHOP ?? "",
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN ?? "",
      });
    }

    // Initialize DeepL for translations
    if (process.env.DEEPL_API_KEY) {
      this.deepl = new DeepLClient({
        apiKey: process.env.DEEPL_API_KEY,
        free: process.env.DEEPL_FREE === "true",
      });
      this.logger.info("DeepL client initialized");
    }

    this.logger.info(`Shopify agent started for shop: ${this.shopify.shopName}`);
  }

  async onStop(): Promise<void> {
    this.logger.info("Shopify agent stopped");
  }

  async handleMessage(message: RoutedMessage): Promise<AgentResponse> {
    const text = message.text.trim().toLowerCase();
    this.logger.info(`Received: "${text}" from ${message.user_id}`);

    try {
      if (text.startsWith("import")) {
        return handleImport(this, message);
      }

      if (text.startsWith("translate") || text.startsWith("vertaal")) {
        return handleTranslate(this, message);
      }

      if (text.startsWith("enrich") || text.startsWith("enhance")) {
        return handleEnrich(this, message);
      }

      if (text.startsWith("export") || text.startsWith("matrixify")) {
        return handleExport(this, message);
      }

      if (text.startsWith("status") || text.startsWith("scan")) {
        return handleStatus(this, message);
      }

      if (text.startsWith("products") || text.startsWith("list") || text.startsWith("count")) {
        return handleProducts(this, message);
      }

      if (text === "help" || text === "?") {
        return this.helpResponse(message);
      }

      return this.helpResponse(message);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
      this.logger.error(`Handler error: ${errMsg}`);
      return {
        channel_id: message.channel_id,
        thread_ts: message.thread_ts ?? message.ts,
        text: `Error: ${errMsg}`,
      };
    }
  }

  private helpResponse(message: RoutedMessage): AgentResponse {
    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text: [
        "*Shopify Agent Commands:*",
        "",
        "`products [brand]` — List products (optionally filter by vendor/brand)",
        "`count` — Product counts by status",
        "`import <csv>` — Import products from CSV",
        "`translate [brand/SKU]` — Translate NL→FR via DeepL",
        "`scan untranslated` — Find products missing FR translations",
        "`enrich [brand/SKU]` — AI-enrich product descriptions",
        "`export matrixify [brand]` — Generate Matrixify-compatible export",
        "`status` — Translation pipeline status",
        "`help` — Show this message",
      ].join("\n"),
    };
  }
}
