// Minimál JSON-séma validátor (F2, D3). A séma a szerződés, nem a modell —
// bármelyik provider kimenete ezen megy át. Csak azt támogatja, amit a
// szerep-sémáink használnak: object (properties/required/additionalProperties),
// array (items), string+enum, integer, number, boolean, null.

function typeOk(value, type) {
  switch (type) {
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}

function check(value, schema, path, errors) {
  if (schema.type && !typeOk(value, schema.type)) {
    errors.push(`${path || "root"}: várt ${schema.type}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path || "root"}: enum-on kívüli érték (${JSON.stringify(value)})`);
  }
  if (schema.type === "object") {
    const props = schema.properties ?? {};
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${path ? path + "." : ""}${req}: hiányzó kötelező mező`);
    }
    for (const [key, val] of Object.entries(value)) {
      if (props[key]) check(val, props[key], `${path ? path + "." : ""}${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path ? path + "." : ""}${key}: nem engedélyezett mező`);
    }
  }
  if (schema.type === "array" && schema.items) {
    value.forEach((item, i) => check(item, schema.items, `${path}[${i}]`, errors));
  }
}

/** @returns {{ok:boolean, errors:string[]}} */
export function validate(data, schema) {
  const errors = [];
  check(data, schema, "", errors);
  return { ok: errors.length === 0, errors };
}

/** Szöveg → JSON: tiszta, ```json``` kerítéses, vagy szövegbe ágyazott első objektum/tömb. */
export function extractJson(text) {
  if (typeof text !== "string") return null;
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

  let direct = tryParse(text.trim());
  if (direct !== undefined) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const p = tryParse(fenced[1].trim());
    if (p !== undefined) return p;
  }
  // első kiegyensúlyozott { } vagy [ ] blokk keresése
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) {
        const p = tryParse(text.slice(start, i + 1));
        return p === undefined ? null : p;
      }
    }
  }
  return null;
}
