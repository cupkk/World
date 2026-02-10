type ParseStringResult = {
  value: string;
  closed: boolean;
};

function decodeEscapedChar(raw: string, index: number): { value: string; nextIndex: number } | null {
  const ch = raw[index];
  if (ch === "\"" || ch === "\\" || ch === "/") {
    return { value: ch, nextIndex: index + 1 };
  }
  if (ch === "b") return { value: "\b", nextIndex: index + 1 };
  if (ch === "f") return { value: "\f", nextIndex: index + 1 };
  if (ch === "n") return { value: "\n", nextIndex: index + 1 };
  if (ch === "r") return { value: "\r", nextIndex: index + 1 };
  if (ch === "t") return { value: "\t", nextIndex: index + 1 };
  if (ch === "u") {
    const hex = raw.slice(index + 1, index + 5);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
    const code = Number.parseInt(hex, 16);
    return { value: String.fromCharCode(code), nextIndex: index + 5 };
  }
  return { value: ch, nextIndex: index + 1 };
}

function parseJsonStringPrefix(raw: string, startIndex: number): ParseStringResult {
  let i = startIndex;
  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\"") {
      return { value: out, closed: true };
    }
    if (ch === "\\") {
      i += 1;
      if (i >= raw.length) return { value: out, closed: false };
      const decoded = decodeEscapedChar(raw, i);
      if (!decoded) return { value: out, closed: false };
      out += decoded.value;
      i = decoded.nextIndex;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { value: out, closed: false };
}

export function extractAssistantMessageFromJsonPrefix(rawJsonLike: string): string {
  if (!rawJsonLike.trim()) return "";

  const key = "\"assistant_message\"";
  const keyIdx = rawJsonLike.indexOf(key);
  if (keyIdx < 0) return "";

  let i = keyIdx + key.length;
  while (i < rawJsonLike.length && /\s/.test(rawJsonLike[i] ?? "")) i += 1;
  if (rawJsonLike[i] !== ":") return "";
  i += 1;
  while (i < rawJsonLike.length && /\s/.test(rawJsonLike[i] ?? "")) i += 1;
  if (rawJsonLike[i] !== "\"") return "";
  i += 1;

  return parseJsonStringPrefix(rawJsonLike, i).value;
}
