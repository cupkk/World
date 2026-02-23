import DOMPurify from 'dompurify';

/**
 * Sanitizes an HTML string to prevent XSS attacks.
 * Uses DOMPurify under the hood.
 * 
 * @param dirtyHtml The potentially unsafe HTML string
 * @returns A safe, sanitized HTML string
 */
export const sanitizeHtml = (dirtyHtml: string): string => {
  if (!dirtyHtml || !dirtyHtml.trim()) return '';

  // Basic configuration to allow common rich text elements but strip dangerous ones
  return DOMPurify.sanitize(dirtyHtml, {
    ALLOWED_TAGS: [
      'b', 'i', 'em', 'strong', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'br', 'hr', 'blockquote', 'code', 'pre', 'span', 'div',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id', 'title'],
    // Ensure links open in new tabs securely
    ADD_ATTR: ['target'],
  });
};
