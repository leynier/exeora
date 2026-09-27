import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: [
    "./src/db/schema.ts",
    "./src/db/schema-cloud.ts",
    "./src/db/schema-locations.ts",
    "./src/db/schema-github.ts",
  ],
  out: "./migrations",
});
