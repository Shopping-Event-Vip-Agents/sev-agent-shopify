import type { RoutedMessage, AgentResponse } from "@domien-sev/shared-types";
import type { ShopifyAgent } from "../agent.js";

export async function handleImport(agent: ShopifyAgent, message: RoutedMessage): Promise<AgentResponse> {
  // CSV import is a complex operation — for now, acknowledge and guide
  return {
    channel_id: message.channel_id,
    thread_ts: message.thread_ts ?? message.ts,
    text: [
      "*Product Import*",
      "",
      "To import products, provide a CSV file with these columns:",
      "• `Handle`, `Title`, `Body (HTML)`, `Vendor`, `Type`, `Tags`",
      "• `Variant SKU`, `Variant Price`, `Variant Inventory Qty`",
      "• `Image Src`, `Image Alt Text`",
      "",
      "Upload the CSV and I'll process it. For large imports (500+ products), use Matrixify directly.",
      "",
      "_Tip: Use `export matrixify` to see the expected format._",
    ].join("\n"),
  };
}
