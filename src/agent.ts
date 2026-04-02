/**
 * ShopifyAgent — Shopify data input agent for interactive product management.
 * Handles imports, translations, product creation, and audits via Slack.
 */

import { BaseAgent } from "@domien-sev/agent-sdk";
import type { AgentConfig } from "@domien-sev/agent-sdk";
import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import { ShopifyAdminClient, DeepLClient } from "@domien-sev/shopify-sdk";
import { handleImport } from "./handlers/import.js";
import { handleTranslate } from "./handlers/translate.js";
import { handleProduct } from "./handlers/product.js";
import { handleAudit } from "./handlers/audit.js";

export class ShopifyAgent extends BaseAgent {
  public shopifyClient: ShopifyAdminClient | null = null;
  public deeplClient: DeepLClient | null = null;

  constructor(config: AgentConfig) {
    super(config);

    // Initialize Shopify client if credentials are available
    const shop = process.env.SHOPIFY_SHOP;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (shop && clientId && clientSecret) {
      this.shopifyClient = new ShopifyAdminClient({ shop, clientId, clientSecret });
      this.logger.info(`Shopify client initialized for ${shop} (client credentials flow)`);
    } else if (shop && accessToken) {
      this.shopifyClient = new ShopifyAdminClient({ shop, accessToken });
      this.logger.info(`Shopify client initialized for ${shop} (static token)`);
    } else {
      this.logger.warn("Shopify credentials not set — need SHOPIFY_SHOP + SHOPIFY_CLIENT_ID/SECRET or SHOPIFY_ACCESS_TOKEN");
    }

    // Initialize DeepL client if API key is available
    const deeplKey = process.env.DEEPL_API_KEY;
    if (deeplKey) {
      this.deeplClient = new DeepLClient({
        apiKey: deeplKey,
        free: process.env.DEEPL_FREE === "true",
      });
      this.logger.info("DeepL client initialized");
    } else {
      this.logger.warn("DeepL API key not set — translation features disabled");
    }
  }

  async onStart(): Promise<void> {
    this.logger.info("Shopify agent started — ready for product management");
  }

  async onStop(): Promise<void> {
    this.logger.info("Shopify agent shutting down");
  }

  async handleMessage(message: RoutedMessage): Promise<AgentResponse> {
    const text = message.text.trim().toLowerCase();
    this.logger.info(`Request from ${message.user_id}: ${message.text.substring(0, 100)}`);

    if (!text) {
      return this.reply(message, "Please send a command. Type **help** to see what I can do.");
    }

    // Route based on keywords
    if (matchesAny(text, ["import", "upload", "csv", "excel", "xlsx", "spreadsheet"])) {
      return handleImport(message, this);
    }

    if (matchesAny(text, ["translate", "check translation", "vertaal", "vertaling", "translation"])) {
      return handleTranslate(message, this);
    }

    if (matchesAny(text, ["create product", "new product", "add product", "maak product", "nieuw product", "voeg product toe"])) {
      return handleProduct(message, this);
    }

    if (matchesAny(text, ["audit", "check all", "product check", "scan", "controleer", "health check"])) {
      return handleAudit(message, this);
    }

    // Check if this is a follow-up to a pending product creation
    const pendingProductKey = `product:${message.channel_id}:pending`;
    const pendingProduct = await this.getMemory(pendingProductKey);
    if (pendingProduct) {
      return handleProduct(message, this);
    }

    // Check if this is a confirmation for a pending import
    const pendingImportKey = `import:${message.channel_id}:pending`;
    const pendingImport = await this.getMemory(pendingImportKey);
    if (pendingImport && /\b(confirm|bevestig|ok|go|ja|yes|doe maar)\b/i.test(text)) {
      return handleImport(message, this);
    }

    // Default: show help
    return this.reply(message, [
      "I'm the Shopify product management agent. Here's what I can do:",
      "",
      "**Import products:**",
      '  `import` — Paste CSV data or upload a spreadsheet to bulk import products',
      "",
      "**Translate:**",
      '  `translate` — Scan products for missing French translations',
      '  `translate "product-handle"` — Check/translate a specific product',
      "",
      "**Create product:**",
      '  `create product title: My Product, price: 29.99` — Create a single product interactively',
      "",
      "**Audit:**",
      "  `audit` — Full product completeness scan (descriptions, images, translations, tags)",
      "",
      "All products are created as **draft** and auto-translated NL → FR.",
    ].join("\n"));
  }

  /**
   * Build a standard agent response.
   */
  reply(message: RoutedMessage, text: string): AgentResponse {
    return {
      channel_id: message.channel_id,
      thread_ts: message.thread_ts ?? message.ts,
      text,
    };
  }
}

/**
 * Check if the text contains any of the given keywords/phrases.
 */
function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}
