import { z } from "zod";

/** Keep nullable Rust enum names stable across Zod's equivalent union compaction. */
export function rustJsonSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema);
  expandTypeArrays(json);
  return json;
}

function expandTypeArrays(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const schema = value as Record<string, unknown>;
  if (Array.isArray(schema.type)) {
    schema.anyOf = schema.type.map((type) => ({ type }));
    delete schema.type;
  }

  // Visit schema keywords only: defaults, examples and const values are data.
  for (const key of [
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
    "dependentSchemas",
  ]) {
    const children = schema[key];
    if (children && typeof children === "object") {
      for (const child of Object.values(children)) expandTypeArrays(child);
    }
  }
  for (const key of [
    "items",
    "prefixItems",
    "additionalItems",
    "additionalProperties",
    "unevaluatedItems",
    "unevaluatedProperties",
    "contains",
    "propertyNames",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "contentSchema",
  ]) {
    const children = schema[key];
    if (Array.isArray(children)) children.forEach(expandTypeArrays);
    else expandTypeArrays(children);
  }
}
