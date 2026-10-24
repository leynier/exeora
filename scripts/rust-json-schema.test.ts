import { describe, expect, it } from "vitest";
import { z } from "zod";
import { rustJsonSchema } from "./rust-json-schema.js";

describe("Rust JSON Schema compatibility", () => {
  it("preserves nullable unions inside objects, arrays and records", () => {
    const schema = rustJsonSchema(
      z.object({
        value: z.string().nullable(),
        values: z.array(z.number().nullable()),
        default: z.record(z.string(), z.boolean().nullable()),
      }),
    );
    expect(schema.properties).toMatchObject({
      value: { anyOf: [{ type: "string" }, { type: "null" }] },
      values: { items: { anyOf: [{ type: "number" }, { type: "null" }] } },
      default: { additionalProperties: { anyOf: [{ type: "boolean" }, { type: "null" }] } },
    });
  });

  it("leaves schema-shaped default data and constrained union branches intact", () => {
    const fallback = { type: ["string", "null"] };
    const schema = rustJsonSchema(
      z.object({
        fallback: z.object({ type: z.array(z.string()) }).default(fallback),
        value: z.string().min(1).nullable(),
      }),
    );
    expect(schema.properties?.fallback).toHaveProperty("default", fallback);
    expect(schema.properties?.value).toMatchObject({
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    });
  });
});
