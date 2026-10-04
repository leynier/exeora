import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./schema.js";

/** Native ChatGPT settings, isolated by owner, OAuth client and endpoint. */
export const pluginSettings = sqliteTable(
  "plugin_settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    endpoint: text("endpoint").notNull(),
    valuesJson: text("values_json").notNull().default("{}"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.clientId, table.endpoint] })],
);
