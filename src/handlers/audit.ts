/**
 * Audit handler — full product completeness scan across the Shopify store.
 * Checks for missing descriptions, images, translations, tags, etc.
 */

import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import type { ShopifyAgent } from "../agent.js";
import {
  getAllProducts,
  getProductTranslations,
} from "@domien-sev/shopify-sdk";
import type { ShopifyProduct } from "@domien-sev/shopify-sdk";
import { createItem } from "@directus/sdk";

interface AuditIssue {
  handle: string;
  title: string;
  field: string;
  issue: string;
  severity: "critical" | "warning" | "info";
}

interface AuditSummary {
  totalProducts: number;
  productsWithIssues: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  issues: AuditIssue[];
  categories: {
    missingDescription: number;
    missingImages: number;
    missingTranslations: number;
    missingTags: number;
    missingSEO: number;
    draftStatus: number;
  };
}

/**
 * Handle full product audit request.
 * Scans all products and generates a completeness report.
 */
export async function handleAudit(
  message: RoutedMessage,
  agent: ShopifyAgent,
): Promise<AgentResponse> {
  if (!agent.shopifyClient) {
    return agent.reply(
      message,
      "Shopify client not configured. Set SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN environment variables.",
    );
  }

  try {
    agent.status = "busy";

    // Fetch all products
    const products = await getAllProducts(agent.shopifyClient, { limit: 250 });

    if (products.length === 0) {
      agent.status = "online";
      return agent.reply(message, "No products found in your Shopify store.");
    }

    // Run audit checks
    const summary = await auditProducts(products, agent);

    // Store report as Directus artifact
    const client = agent.directusManager.getClient("sev-ai");
    const artifact = {
      title: `Shopify Audit — ${products.length} products — ${new Date().toISOString().split("T")[0]}`,
      type: "shopify-audit",
      content: JSON.stringify({
        ...summary,
        generatedAt: new Date().toISOString(),
      }),
      created_by: "shopify",
      tags: ["shopify", "audit", "auto-generated"],
    };

    // @ts-ignore — @directus/sdk createItem generic
    await client.request(createItem("artifacts", artifact));

    agent.status = "online";

    // Store in shared memory for other agents
    await agent.setMemory(`audit:${Date.now()}`, {
      totalProducts: summary.totalProducts,
      productsWithIssues: summary.productsWithIssues,
      criticalCount: summary.criticalCount,
      categories: summary.categories,
      timestamp: new Date().toISOString(),
    });

    // Build formatted report
    return agent.reply(message, formatAuditReport(summary));
  } catch (err) {
    agent.status = "online";
    const errMsg = err instanceof Error ? err.message : String(err);
    return agent.reply(message, `Audit failed: ${errMsg}`);
  }
}

/**
 * Run all audit checks on a list of products.
 */
async function auditProducts(
  products: ShopifyProduct[],
  agent: ShopifyAgent,
): Promise<AuditSummary> {
  const issues: AuditIssue[] = [];
  const productHandlesWithIssues = new Set<string>();

  const categories = {
    missingDescription: 0,
    missingImages: 0,
    missingTranslations: 0,
    missingTags: 0,
    missingSEO: 0,
    draftStatus: 0,
  };

  for (const product of products) {
    // Check description
    if (!product.body_html || product.body_html.trim().length === 0) {
      issues.push({
        handle: product.handle,
        title: product.title,
        field: "description",
        issue: "Missing product description",
        severity: "critical",
      });
      categories.missingDescription++;
      productHandlesWithIssues.add(product.handle);
    } else if (product.body_html.trim().length < 50) {
      issues.push({
        handle: product.handle,
        title: product.title,
        field: "description",
        issue: `Very short description (${product.body_html.trim().length} chars)`,
        severity: "warning",
      });
      productHandlesWithIssues.add(product.handle);
    }

    // Check images
    if (!product.images || product.images.length === 0) {
      issues.push({
        handle: product.handle,
        title: product.title,
        field: "images",
        issue: "No product images",
        severity: "critical",
      });
      categories.missingImages++;
      productHandlesWithIssues.add(product.handle);
    } else {
      // Check for missing alt text
      const missingAlt = product.images.filter((img) => !img.alt || img.alt.trim().length === 0);
      if (missingAlt.length > 0) {
        issues.push({
          handle: product.handle,
          title: product.title,
          field: "images",
          issue: `${missingAlt.length} image(s) missing alt text`,
          severity: "warning",
        });
        productHandlesWithIssues.add(product.handle);
      }
    }

    // Check tags
    if (!product.tags || product.tags.trim().length === 0) {
      issues.push({
        handle: product.handle,
        title: product.title,
        field: "tags",
        issue: "No tags set",
        severity: "warning",
      });
      categories.missingTags++;
      productHandlesWithIssues.add(product.handle);
    }

    // Check draft status
    if (product.status === "draft") {
      issues.push({
        handle: product.handle,
        title: product.title,
        field: "status",
        issue: "Product is in draft status",
        severity: "info",
      });
      categories.draftStatus++;
      productHandlesWithIssues.add(product.handle);
    }

    // Check variants for missing SKUs
    if (product.variants) {
      const missingSku = product.variants.filter((v) => !v.sku || v.sku.trim().length === 0);
      if (missingSku.length > 0) {
        issues.push({
          handle: product.handle,
          title: product.title,
          field: "variants",
          issue: `${missingSku.length} variant(s) missing SKU`,
          severity: "warning",
        });
        productHandlesWithIssues.add(product.handle);
      }

      // Check for zero-price variants
      const zeroPrice = product.variants.filter(
        (v) => !v.price || parseFloat(v.price) === 0,
      );
      if (zeroPrice.length > 0) {
        issues.push({
          handle: product.handle,
          title: product.title,
          field: "variants",
          issue: `${zeroPrice.length} variant(s) with zero/missing price`,
          severity: "critical",
        });
        productHandlesWithIssues.add(product.handle);
      }
    }

    // Check French translations (if Shopify client available for GraphQL)
    if (agent.shopifyClient) {
      try {
        const translations = await getProductTranslations(
          agent.shopifyClient,
          `gid://shopify/Product/${product.id}`,
          "fr",
        );

        const titleTranslation = translations.find((t) => t.key === "title");
        const descTranslation = translations.find((t) => t.key === "body_html");

        if (!titleTranslation?.value) {
          issues.push({
            handle: product.handle,
            title: product.title,
            field: "translation",
            issue: "Missing French title translation",
            severity: "warning",
          });
          categories.missingTranslations++;
          productHandlesWithIssues.add(product.handle);
        }

        if (product.body_html && !descTranslation?.value) {
          issues.push({
            handle: product.handle,
            title: product.title,
            field: "translation",
            issue: "Missing French description translation",
            severity: "warning",
          });
          categories.missingTranslations++;
          productHandlesWithIssues.add(product.handle);
        }
      } catch {
        // Translation check failed — skip silently, don't block the audit
      }
    }
  }

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  return {
    totalProducts: products.length,
    productsWithIssues: productHandlesWithIssues.size,
    criticalCount,
    warningCount,
    infoCount,
    issues,
    categories,
  };
}

/**
 * Format the audit summary as a human-readable Slack message.
 */
function formatAuditReport(summary: AuditSummary): string {
  const healthScore = Math.round(
    ((summary.totalProducts - summary.productsWithIssues) / summary.totalProducts) * 100,
  );

  const lines: string[] = [
    `**Shopify Product Audit Report**`,
    `_${new Date().toISOString().split("T")[0]}_`,
    "",
    `Products scanned: **${summary.totalProducts}**`,
    `Products with issues: **${summary.productsWithIssues}**`,
    `Health score: **${healthScore}%**`,
    "",
    "**Issue breakdown:**",
    `  Missing descriptions: ${summary.categories.missingDescription}`,
    `  Missing images: ${summary.categories.missingImages}`,
    `  Missing translations (FR): ${summary.categories.missingTranslations}`,
    `  Missing tags: ${summary.categories.missingTags}`,
    `  Draft status: ${summary.categories.draftStatus}`,
    "",
  ];

  // Show top critical issues
  const criticalIssues = summary.issues.filter((i) => i.severity === "critical");
  if (criticalIssues.length > 0) {
    lines.push(`**Critical issues (${criticalIssues.length}):**`);
    for (const issue of criticalIssues.slice(0, 10)) {
      lines.push(`  - **${issue.title}** (${issue.handle}): ${issue.issue}`);
    }
    if (criticalIssues.length > 10) {
      lines.push(`  ... and ${criticalIssues.length - 10} more critical issues`);
    }
    lines.push("");
  }

  lines.push("Full report stored as artifact in Directus.");
  lines.push("");
  lines.push(
    "_Tip: Use `translate` to fix missing translations, or `import` with updated CSV to fix other issues._",
  );

  return lines.join("\n");
}
