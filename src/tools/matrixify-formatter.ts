/**
 * Matrixify-compatible Excel formatter.
 * Maps enriched product data to the column structure expected by the
 * Matrixify Shopify import/export app.
 */

import * as XLSX from "xlsx";
import type { SupplierProductData } from "@domien-sev/shopify-sdk";

/** Standard Matrixify column headers */
const BASE_HEADERS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Variant SKU",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Weight",
  "Variant Weight Unit",
  "Image Src",
  "Image Alt Text",
  "SEO Title",
  "SEO Description",
];

const TRANSLATION_HEADERS = ["Title (fr)", "Body (HTML) (fr)"];

export interface MatrixifyOutput {
  headers: string[];
  rows: string[][];
}

/**
 * Format enriched products into Matrixify-compatible columns.
 *
 * @param products - Enriched supplier product data
 * @param translations - Optional NL→FR translations map (key = "handle:field", value = translated text)
 * @returns Headers and rows ready for Excel export
 */
export function formatForMatrixify(
  products: SupplierProductData[],
  translations?: Map<string, string>,
): MatrixifyOutput {
  const includeTranslations = translations && translations.size > 0;
  const headers = includeTranslations
    ? [...BASE_HEADERS, ...TRANSLATION_HEADERS]
    : [...BASE_HEADERS];

  const rows: string[][] = [];

  for (const product of products) {
    const handle = generateHandle(product.title ?? "untitled");
    const price = normalizeToString(product.price);
    const compareAtPrice = normalizeToString(product.compareAtPrice);
    const weight = normalizeToString(product.weight);
    const weightUnit = product.weightUnit ?? "kg";
    const tags = Array.isArray(product.tags) ? product.tags.join(", ") : (product.tags ?? "");
    const seoTitle = String(product.raw?.["seoTitle"] ?? "");
    const seoDescription = String(product.raw?.["seoDescription"] ?? "");

    // First image goes on the main product row
    const firstImage = product.imageUrls?.[0] ?? "";
    const imageAlt = product.title ?? "";

    // Check for variant data
    const hasVariants = product.variants && product.variants.length > 0;

    if (hasVariants && product.variants) {
      // Multi-variant product — first row has product data + first variant
      for (let vi = 0; vi < product.variants.length; vi++) {
        const variant = product.variants[vi];
        const isFirstRow = vi === 0;

        const row = [
          handle,
          isFirstRow ? (product.title ?? "") : "",
          isFirstRow ? wrapHtmlDescription(product.description ?? "") : "",
          isFirstRow ? (product.vendor ?? "") : "",
          isFirstRow ? (product.productType ?? "") : "",
          isFirstRow ? tags : "",
          isFirstRow ? "TRUE" : "",
          variant.option1 ? "Size" : "",
          variant.option1 ?? "",
          variant.sku ?? "",
          normalizeToString(variant.price ?? price),
          compareAtPrice,
          normalizeToString(variant.weight ?? weight),
          weightUnit,
          isFirstRow ? firstImage : (product.imageUrls?.[vi] ?? ""),
          isFirstRow ? imageAlt : "",
          isFirstRow ? seoTitle : "",
          isFirstRow ? seoDescription : "",
        ];

        if (includeTranslations && translations) {
          row.push(
            isFirstRow ? (translations.get(`${handle}:title`) ?? "") : "",
            isFirstRow ? (translations.get(`${handle}:description`) ?? "") : "",
          );
        }

        rows.push(row);
      }
    } else {
      // Single variant product
      const row = [
        handle,
        product.title ?? "",
        wrapHtmlDescription(product.description ?? ""),
        product.vendor ?? "",
        product.productType ?? "",
        tags,
        "TRUE",
        "",
        "",
        product.sku ?? "",
        price,
        compareAtPrice,
        weight,
        weightUnit,
        firstImage,
        imageAlt,
        seoTitle,
        seoDescription,
      ];

      if (includeTranslations && translations) {
        row.push(
          translations.get(`${handle}:title`) ?? "",
          translations.get(`${handle}:description`) ?? "",
        );
      }

      rows.push(row);

      // Additional images get their own rows
      if (product.imageUrls && product.imageUrls.length > 1) {
        for (let imgIdx = 1; imgIdx < product.imageUrls.length; imgIdx++) {
          const imgRow = new Array(headers.length).fill("");
          imgRow[0] = handle; // Handle
          imgRow[headers.indexOf("Image Src")] = product.imageUrls[imgIdx];
          imgRow[headers.indexOf("Image Alt Text")] = `${imageAlt} - ${imgIdx + 1}`;
          rows.push(imgRow);
        }
      }
    }
  }

  return { headers, rows };
}

/**
 * Generate a downloadable Excel buffer from Matrixify-formatted data.
 */
export function generateExcelBuffer(headers: string[], rows: string[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const data = [headers, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(data);

  // Set column widths for readability
  const colWidths = headers.map((h) => ({
    wch: Math.max(h.length, 15),
  }));
  sheet["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(workbook, sheet, "Products");

  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer,
  );
}

/**
 * Generate a Shopify-compatible handle from a product title.
 * Handles Dutch special characters.
 */
function generateHandle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
    .replace(/\s+/g, "-") // Spaces to hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Trim leading/trailing hyphens
    .substring(0, 255);
}

/**
 * Wrap a plain text description in basic HTML if it isn't already HTML.
 */
function wrapHtmlDescription(description: string): string {
  if (!description.trim()) return "";

  // Already HTML
  if (description.trim().startsWith("<")) return description;

  // Split paragraphs on double newlines and wrap in <p> tags
  const paragraphs = description
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length <= 1) {
    return `<p>${description.trim()}</p>`;
  }

  return paragraphs.map((p) => `<p>${p}</p>`).join("\n");
}

function normalizeToString(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  return String(value);
}
