import type { AgentBoardAction } from "./agentProtocol";

type ParseStringResult = {
  value: string;
  closed: boolean;
  nextIndex: number;
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
      return { value: out, closed: true, nextIndex: i + 1 };
    }
    if (ch === "\\") {
      i += 1;
      if (i >= raw.length) return { value: out, closed: false, nextIndex: i };
      const decoded = decodeEscapedChar(raw, i);
      if (!decoded) return { value: out, closed: false, nextIndex: i };
      out += decoded.value;
      i = decoded.nextIndex;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { value: out, closed: false, nextIndex: i };
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

export function extractBoardActionsFromJsonPrefix(rawJsonLike: string): AgentBoardAction[] {
  if (!rawJsonLike.trim()) return [];

  const key = "\"board_actions\"";
  const keyIdx = rawJsonLike.indexOf(key);
  if (keyIdx < 0) return [];

  let i = keyIdx + key.length;
  while (i < rawJsonLike.length && /\s/.test(rawJsonLike[i] ?? "")) i += 1;
  if (rawJsonLike[i] !== ":") return [];
  i += 1;
  while (i < rawJsonLike.length && /\s/.test(rawJsonLike[i] ?? "")) i += 1;
  if (rawJsonLike[i] !== "[") return [];
  i += 1;

  let inString = false;
  let escape = false;
  let objectDepth = 0;
  let objectStart = -1;
  const objectSnippets: string[] = [];
  let partialObjectSnippet = "";

  for (; i < rawJsonLike.length; i += 1) {
    const ch = rawJsonLike[i] ?? "";

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (objectDepth === 0) {
        objectStart = i;
      }
      objectDepth += 1;
      continue;
    }

    if (ch === "}") {
      if (objectDepth > 0) {
        objectDepth -= 1;
        if (objectDepth === 0 && objectStart >= 0) {
          objectSnippets.push(rawJsonLike.slice(objectStart, i + 1));
          objectStart = -1;
        }
      }
      continue;
    }

    if (ch === "]" && objectDepth === 0) {
      break;
    }
  }

  if (objectDepth > 0 && objectStart >= 0) {
    partialObjectSnippet = rawJsonLike.slice(objectStart);
  }

  const parsedActions: AgentBoardAction[] = [];
  for (const snippet of objectSnippets) {
    try {
      const parsed = JSON.parse(snippet) as Partial<AgentBoardAction>;
      if (!parsed || typeof parsed.action !== "string") continue;
      parsedActions.push(parsed as AgentBoardAction);
    } catch {
      // ignore malformed partial object
    }
  }

  const partial = extractPartialActionFromObjectPrefix(partialObjectSnippet);
  if (partial) {
    parsedActions.push(partial);
  }

  return parsedActions;
}

function normalizeAction(value: string): AgentBoardAction["action"] | null {
  if (
    value === "create_structure" ||
    value === "update_section" ||
    value === "append_section" ||
    value === "clear_section" ||
    value === "set_template"
  ) {
    return value;
  }
  return null;
}

function normalizeTemplateType(value: string): AgentBoardAction["template_type"] | null {
  if (value === "document" || value === "table" || value === "code") {
    return value;
  }
  return null;
}

function setPartialActionField(action: Partial<AgentBoardAction>, key: string, value: string) {
  if (key === "action") {
    const normalized = normalizeAction(value);
    if (normalized) action.action = normalized;
    return;
  }
  if (key === "template_type") {
    const normalized = normalizeTemplateType(value);
    if (normalized) action.template_type = normalized;
    return;
  }
  if (key === "section_id") {
    action.section_id = value;
    return;
  }
  if (key === "section_title") {
    action.section_title = value;
    return;
  }
  if (key === "content") {
    action.content = value;
  }
}

function extractPartialActionFromObjectPrefix(rawObjectPrefix: string): AgentBoardAction | null {
  if (!rawObjectPrefix.trim().startsWith("{")) return null;

  let i = rawObjectPrefix.indexOf("{") + 1;
  const partial: Partial<AgentBoardAction> = {};

  const skipWhitespace = () => {
    while (i < rawObjectPrefix.length && /\s/.test(rawObjectPrefix[i] ?? "")) i += 1;
  };

  while (i < rawObjectPrefix.length) {
    skipWhitespace();
    if (rawObjectPrefix[i] === ",") {
      i += 1;
      continue;
    }
    if (rawObjectPrefix[i] === "}") break;
    if (rawObjectPrefix[i] !== "\"") break;
    i += 1;

    const keyParsed = parseJsonStringPrefix(rawObjectPrefix, i);
    i = keyParsed.nextIndex;
    if (!keyParsed.closed) break;

    skipWhitespace();
    if (rawObjectPrefix[i] !== ":") break;
    i += 1;
    skipWhitespace();

    if (rawObjectPrefix[i] === "\"") {
      i += 1;
      const valueParsed = parseJsonStringPrefix(rawObjectPrefix, i);
      setPartialActionField(partial, keyParsed.value, valueParsed.value);
      i = valueParsed.nextIndex;
      if (!valueParsed.closed) break;
      continue;
    }

    const valueStart = i;
    while (i < rawObjectPrefix.length && rawObjectPrefix[i] !== "," && rawObjectPrefix[i] !== "}") {
      i += 1;
    }
    const rawValue = rawObjectPrefix.slice(valueStart, i).trim();
    if (rawValue) {
      setPartialActionField(partial, keyParsed.value, rawValue);
    }
    if (rawObjectPrefix[i] === "}") break;
  }

  if (!partial.action) return null;
  return partial as AgentBoardAction;
}
