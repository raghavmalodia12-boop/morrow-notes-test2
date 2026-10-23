import sanitizeHtml from "sanitize-html";

// Notes written before the rich editor are plain text. Only real HTML goes through the cleaner.
const LOOKS_LIKE_HTML = /^\s*<(p|h[1-6]|ul|ol|table|div|blockquote|img|pre|hr)\b/i;

export function cleanContent(value) {
  const text = typeof value === "string" ? value : "";
  if (!LOOKS_LIKE_HTML.test(text)) return text.trim();
  return sanitizeHtml(text, {
    allowedTags: ["p", "br", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "strike", "code", "pre", "blockquote", "hr",
      "ul", "ol", "li", "label", "input", "div", "span", "a", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col"],
    allowedAttributes: {
      a: ["href", "target", "rel", "class"],
      img: ["src", "alt", "title", "width", "height", "style"],
      ul: ["data-type"],
      li: ["data-type", "data-checked"],
      input: ["type", "checked"],
      th: ["colspan", "rowspan", "colwidth"],
      td: ["colspan", "rowspan", "colwidth"],
      col: ["span"]
    },
    // Only the image-size styles the editor writes are allowed through.
    allowedStyles: { img: {
      width: [/^\d+(\.\d+)?px$/],
      height: [/^(auto|\d+(\.\d+)?px)$/],
      "aspect-ratio": [/^\d+(\.\d+)? \/ \d+(\.\d+)?$/],
      "object-fit": [/^fill$/],
      "margin-left": [/^\d+px$/],
      "margin-top": [/^\d+px$/]
    } },
    allowedClasses: { a: ["file-link"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    // TipTap writes checkboxes as <input type="checkbox">; keep only that kind.
    exclusiveFilter: frame => frame.tag === "input" && frame.attribs.type !== "checkbox"
  }).trim();
}
