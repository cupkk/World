const UNSAFE_TAGS = ["script", "style", "iframe", "object", "embed", "link", "meta", "base", "form"];
const URL_ATTRS = new Set(["href", "src", "xlink:href", "formaction"]);

function shouldStripUrl(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("javascript:") || normalized.startsWith("data:text/html");
}

export function sanitizeHtml(input: string): string {
  if (!input.trim()) return "";

  if (typeof window === "undefined") {
    return input;
  }

  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = input;

  UNSAFE_TAGS.forEach((tag) => {
    doc.body.querySelectorAll(tag).forEach((node) => node.remove());
  });

  doc.body.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        return;
      }

      if (URL_ATTRS.has(name) && shouldStripUrl(value)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
}
