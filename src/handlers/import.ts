/**
 * Import handler — processes CSV/Excel product data from Slack messages.
 * Parses, validates, previews, and prepares data for Matrixify import.
 */

import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import type { ShopifyAgent } from "../agent.js";
import { parseCSV, parseExcel } from "../tools/csv-parser.js";
import { validateProducts, formatIssuesSummary } from "../tools/data-validator.js";
import { enrichProducts } from "../tools/data-enricher.js";
import { formatForMatrixify, generateExcelBuffer } from "../tools/matrixify-formatter.js";
import { createItem } from "@directus/sdk";

/**
 * Handle product data import from CSV/Excel content shared in Slack.
 * Looks for:
 * - Code blocks (```csv data```)
 * - URLs to downloadable files
 * - Raw CSV text in the message
 */
export async function handleImport(
  message: RoutedMessage,
  agent: ShopifyAgent,
): Promise<AgentResponse> {
  const text = message.text;

  // Extract CSV content from code blocks
  const codeBlockMatch = text.match(/```(?:csv|tsv|txt)?\s*\n?([\s\S]+?)```/);
  const rawCsvContent = codeBlockMatch?.[1]?.trim();

  // Check for "confirm" keyword — means user confirmed a previous import preview
  const isConfirmation = /\b(confirm|bevestig|ok|go|ja|yes|doe maar)\b/i.test(text);

  if (isConfirmation) {
    return handleImportConfirmation(message, agent);
  }

  if (!rawCsvContent) {
    return agent.reply(message, [
      "I can import product data from CSV or Excel. Share your data in one of these ways:",
      "",
      "**Option 1: Paste CSV in a code block**",
      "\\`\\`\\`csv",
      "Titel;Prijs;SKU;Beschrijving",
      "Product A;29.99;SKU-001;Een mooi product",
      "\\`\\`\\`",
      "",
      "**Option 2: Upload a CSV/Excel file**",
      "Drag and drop your .csv or .xlsx file into the chat.",
      "",
      "**Supported columns:** Title/Titel, Price/Prijs, SKU/Artikelnummer, Description/Beschrijving, Vendor/Leverancier, Type/Categorie, Tags, Image URL/Afbeelding, Barcode/EAN, Weight/Gewicht",
      "",
      "I'll auto-detect your column names (Dutch and English) and delimiter (comma or semicolon).",
    ].join("\n"));
  }

  try {
    // Parse the CSV data
    const products = parseCSV(rawCsvContent);

    if (products.length === 0) {
      return agent.reply(
        message,
        "No products found in the data. Make sure your CSV has a header row and at least one data row.",
      );
    }

    // Validate
    const { valid, issues } = validateProducts(products);
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;

    // Build preview of first 3 products
    const previewProducts = valid.slice(0, 3);
    const preview = previewProducts
      .map((p, i) => {
        const price = p.price ? ` — ${p.price}` : "";
        const sku = p.sku ? ` (${p.sku})` : "";
        return `  ${i + 1}. **${p.title ?? "Untitled"}**${sku}${price}`;
      })
      .join("\n");

    // Store parsed data in shared memory for confirmation step
    await agent.setMemory(`import:${message.channel_id}:pending`, {
      products: valid,
      totalParsed: products.length,
      validCount: valid.length,
      errorCount,
      warningCount,
      timestamp: new Date().toISOString(),
    });

    // Build response
    const lines: string[] = [
      `Parsed **${products.length} products** from CSV.`,
      "",
    ];

    if (errorCount > 0 || warningCount > 0) {
      lines.push(`Validation: ${valid.length} valid, ${errorCount} errors, ${warningCount} warnings`);
      lines.push("");
      lines.push(formatIssuesSummary(issues));
      lines.push("");
    } else {
      lines.push("All products passed validation.");
      lines.push("");
    }

    lines.push("**Preview (first 3):**");
    lines.push(preview);

    if (valid.length > 3) {
      lines.push(`  ... and ${valid.length - 3} more`);
    }

    lines.push("");
    lines.push(
      "Reply **confirm** to enrich missing data and generate a Matrixify import file, or share updated data to re-import.",
    );

    return agent.reply(message, lines.join("\n"));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return agent.reply(message, `Failed to parse CSV data: ${errMsg}`);
  }
}

/**
 * Handle import confirmation — enrich products and generate Matrixify Excel.
 */
async function handleImportConfirmation(
  message: RoutedMessage,
  agent: ShopifyAgent,
): Promise<AgentResponse> {
  // Retrieve pending import data from shared memory
  const pendingKey = `import:${message.channel_id}:pending`;
  const pending = await agent.getMemory(pendingKey);

  if (!pending || !pending.products) {
    return agent.reply(
      message,
      "No pending import found. Please share your CSV data first.",
    );
  }

  const products = pending.products as import("@domien-sev/shopify-sdk").SupplierProductData[];

  try {
    agent.status = "busy";

    // Step 1: Enrich missing data with AI
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    let enriched = products;

    if (anthropicKey) {
      enriched = await enrichProducts(products, anthropicKey);
    }

    // Step 2: Translate titles and descriptions to French via DeepL
    const translations = new Map<string, string>();

    if (agent.deeplClient) {
      const titlesToTranslate = enriched
        .filter((p) => p.title?.trim())
        .map((p) => p.title as string);

      const descriptionsToTranslate = enriched
        .filter((p) => p.description?.trim())
        .map((p) => p.description as string);

      if (titlesToTranslate.length > 0) {
        const translatedTitles = await agent.deeplClient.translateBatch(titlesToTranslate);
        enriched.forEach((p, i) => {
          if (p.title?.trim()) {
            const handle = generateHandle(p.title);
            const frTitle = translatedTitles.shift();
            if (frTitle) translations.set(`${handle}:title`, frTitle);
          }
        });
      }

      if (descriptionsToTranslate.length > 0) {
        const translatedDescs = await agent.deeplClient.translateBatch(descriptionsToTranslate);
        enriched.forEach((p) => {
          if (p.description?.trim()) {
            const handle = generateHandle(p.title ?? "untitled");
            const frDesc = translatedDescs.shift();
            if (frDesc) translations.set(`${handle}:description`, frDesc);
          }
        });
      }
    }

    // Step 3: Format for Matrixify
    const matrixify = formatForMatrixify(enriched, translations);
    const excelBuffer = generateExcelBuffer(matrixify.headers, matrixify.rows);

    // Step 4: Store artifact in Directus
    const client = agent.directusManager.getClient("sev-ai");
    const artifact = {
      title: `Shopify Import — ${enriched.length} products — ${new Date().toISOString().split("T")[0]}`,
      type: "shopify-import",
      content: JSON.stringify({
        productCount: enriched.length,
        translationCount: translations.size,
        headers: matrixify.headers,
        rowCount: matrixify.rows.length,
        products: enriched,
        generatedAt: new Date().toISOString(),
      }),
      created_by: "shopify",
      tags: ["shopify", "import", "matrixify", "auto-generated"],
    };

    // @ts-ignore — @directus/sdk createItem generic
    await client.request(createItem("artifacts", artifact));

    // Clear pending data
    await agent.setMemory(pendingKey, null);

    agent.status = "online";

    const enrichedCount = enriched.filter(
      (p) => p.description?.trim() && p.tags,
    ).length;

    return agent.reply(message, [
      `Import complete. Generated Matrixify file with **${enriched.length} products** (${matrixify.rows.length} rows).`,
      "",
      `- ${enrichedCount} products enriched with AI-generated content`,
      `- ${translations.size / 2} products translated to French`,
      `- Excel file: ${matrixify.headers.length} columns`,
      "",
      "The import file and product data are stored as an artifact in Directus.",
      "Upload the generated Excel to Matrixify in your Shopify admin to complete the import.",
    ].join("\n"));
  } catch (err) {
    agent.status = "online";
    const errMsg = err instanceof Error ? err.message : String(err);
    return agent.reply(message, `Import processing failed: ${errMsg}`);
  }
}

function generateHandle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 255);
}
