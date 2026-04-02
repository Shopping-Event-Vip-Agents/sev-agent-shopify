/**
 * CSV and Excel parser for supplier product data.
 * Handles various column naming conventions and delimiter formats.
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { SupplierProductData } from "@domien-sev/shopify-sdk";

/**
 * Column name mapping — maps common supplier column names (NL/EN/variants)
 * to the standardized SupplierProductData fields.
 */
const COLUMN_MAP: Record<string, keyof SupplierProductData> = {
  // Title
  titel: "title",
  title: "title",
  naam: "title",
  name: "title",
  productnaam: "title",
  "product name": "title",
  "product title": "title",

  // Description
  beschrijving: "description",
  description: "description",
  omschrijving: "description",
  "product description": "description",
  body: "description",
  "body html": "description",
  "body (html)": "description",

  // Price
  prijs: "price",
  price: "price",
  verkoopprijs: "price",
  "selling price": "price",
  "variant price": "price",

  // Compare at price
  "vergelijkingsprijs": "compareAtPrice",
  "compare at price": "compareAtPrice",
  "variant compare at price": "compareAtPrice",
  adviesprijs: "compareAtPrice",
  "richtprijs": "compareAtPrice",

  // SKU
  sku: "sku",
  artikelnummer: "sku",
  "article number": "sku",
  "variant sku": "sku",
  referentie: "sku",
  reference: "sku",
  ref: "sku",

  // Barcode
  barcode: "barcode",
  ean: "barcode",
  "ean code": "barcode",
  "ean-code": "barcode",
  gtin: "barcode",
  upc: "barcode",

  // Weight
  gewicht: "weight",
  weight: "weight",
  "variant weight": "weight",

  // Weight unit
  "gewicht eenheid": "weightUnit",
  "weight unit": "weightUnit",
  "variant weight unit": "weightUnit",

  // Vendor
  leverancier: "vendor",
  vendor: "vendor",
  merk: "vendor",
  brand: "vendor",
  fabrikant: "vendor",
  manufacturer: "vendor",

  // Product type
  type: "productType",
  "product type": "productType",
  producttype: "productType",
  categorie: "productType",
  category: "productType",

  // Tags
  tags: "tags",
  labels: "tags",
  trefwoorden: "tags",
  keywords: "tags",

  // Images
  afbeelding: "imageUrls",
  image: "imageUrls",
  "image src": "imageUrls",
  "image url": "imageUrls",
  foto: "imageUrls",
  photo: "imageUrls",
  afbeeldingen: "imageUrls",
  images: "imageUrls",

  // Supplier reference
  "leverancier ref": "supplierRef",
  "supplier ref": "supplierRef",
  "supplier reference": "supplierRef",
  "leverancier referentie": "supplierRef",
  "external id": "supplierRef",
};

/**
 * Parse a CSV string into SupplierProductData[].
 * Auto-detects comma and semicolon delimiters.
 */
export function parseCSV(content: string): SupplierProductData[] {
  // Try semicolon first (common in Dutch/Belgian CSV exports)
  const semicolonResult = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    delimiter: ";",
  });

  const commaResult = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    delimiter: ",",
  });

  // Pick the result with more columns (better delimiter detection)
  const semicolonCols = semicolonResult.meta.fields?.length ?? 0;
  const commaCols = commaResult.meta.fields?.length ?? 0;
  const result = semicolonCols > commaCols ? semicolonResult : commaResult;

  if (result.errors.length > 0) {
    const criticalErrors = result.errors.filter((e) => e.type === "FieldMismatch");
    if (criticalErrors.length > result.data.length / 2) {
      throw new Error(
        `CSV parsing failed: ${criticalErrors.length} field mismatch errors. Check delimiter and column count.`,
      );
    }
  }

  return mapToSupplierData(result.data);
}

/**
 * Parse an Excel buffer into SupplierProductData[].
 * Reads the first sheet and converts to JSON.
 */
export function parseExcel(buffer: Buffer): SupplierProductData[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("Excel file contains no sheets");
  }

  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new Error(`Could not read sheet "${firstSheetName}"`);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  if (rows.length === 0) {
    throw new Error("Excel sheet is empty — no data rows found");
  }

  return mapToSupplierData(rows);
}

/**
 * Map raw row data (from CSV or Excel) to SupplierProductData[].
 * Performs flexible column name matching against the COLUMN_MAP.
 */
export function mapToSupplierData(rows: Record<string, unknown>[]): SupplierProductData[] {
  if (rows.length === 0) return [];

  // Build the column mapping from actual headers to standardized fields
  const firstRow = rows[0];
  const actualHeaders = Object.keys(firstRow ?? {});
  const headerMapping = new Map<string, keyof SupplierProductData>();

  for (const header of actualHeaders) {
    const normalized = header.toLowerCase().trim();
    const mappedField = COLUMN_MAP[normalized];
    if (mappedField) {
      headerMapping.set(header, mappedField);
    }
  }

  return rows.map((row) => {
    const product: SupplierProductData = {};
    const raw: Record<string, unknown> = {};

    for (const [header, value] of Object.entries(row)) {
      const field = headerMapping.get(header);

      if (!field) {
        // Unmapped column — store in raw
        raw[header] = value;
        continue;
      }

      const strValue = String(value ?? "").trim();
      if (!strValue) continue;

      switch (field) {
        case "title":
          product.title = strValue;
          break;
        case "description":
          product.description = strValue;
          break;
        case "price":
          product.price = normalizePrice(strValue);
          break;
        case "compareAtPrice":
          product.compareAtPrice = normalizePrice(strValue);
          break;
        case "sku":
          product.sku = strValue;
          break;
        case "barcode":
          product.barcode = strValue;
          break;
        case "weight":
          product.weight = strValue;
          break;
        case "weightUnit":
          product.weightUnit = strValue;
          break;
        case "vendor":
          product.vendor = strValue;
          break;
        case "productType":
          product.productType = strValue;
          break;
        case "tags":
          product.tags = strValue;
          break;
        case "imageUrls":
          // Can be a single URL or comma/semicolon separated list
          product.imageUrls = strValue
            .split(/[,;]/)
            .map((u) => u.trim())
            .filter((u) => u.length > 0);
          break;
        case "supplierRef":
          product.supplierRef = strValue;
          break;
      }
    }

    // Attach unmapped columns if any
    if (Object.keys(raw).length > 0) {
      product.raw = raw;
    }

    return product;
  });
}

/**
 * Normalize price strings — handles comma decimals (European format),
 * currency symbols, and whitespace.
 */
function normalizePrice(value: string): string {
  let cleaned = value
    .replace(/[€$£\s]/g, "")
    .trim();

  // European format: 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  // Simple comma decimal: 12,50 → 12.50
  else if (/^\d+,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(",", ".");
  }

  return cleaned;
}
