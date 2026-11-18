/**
 * email-text.mjs — readable text from a saved email (.eml), for the job-alert
 * importers. Decodes each MIME part's base64 or quoted-printable body, turns an
 * HTML part into lines of text with every link written as `label url`, and
 * returns the HTML parts' text (or the plain-text parts' when there is no
 * HTML). Text that is not a MIME message comes back unchanged.
 *
 * Only `atob` and `TextDecoder` (both global in Node and browsers), so a
 * browser bundle can load it.
 */

const HEADER = /^([A-Za-z-]+):\s*(.*)$/;

function looksLikeMime(text) {
  const head = text.slice(0, 20_000);
  return /^content-type:\s*\S/im.test(head) && (/^mime-version:/im.test(head) || /boundary=/i.test(head));
}

function bytesToText(bytes, charset) {
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeBase64(body, charset) {
  const compact = body.replace(/[^A-Za-z0-9+/=]/g, '');
  try {
    const bin = atob(compact);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return bytesToText(bytes, charset);
  } catch {
    return body;
  }
}

/** Quoted-printable: soft breaks removed, `=XX` byte runs decoded as `charset`. */
export function decodeQuotedPrintable(body, charset = 'utf-8') {
  const unfolded = body.replace(/=\r?\n/g, '');
  return unfolded.replace(/(?:=[0-9A-F]{2})+/gi, (run) => {
    const bytes = Uint8Array.from(run.match(/=([0-9A-F]{2})/gi), (h) => parseInt(h.slice(1), 16));
    return bytesToText(bytes, charset);
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rupee: '₹' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const BLOCK_END = /<\/(?:p|div|tr|td|th|li|h[1-6]|table|section|article|header|footer|center|ul|ol)\s*>|<br\s*\/?>|<hr[^>]*>/gi;

/**
 * Lines of text from an HTML email body. Each `<a href="url">label</a>`
 * becomes `label url`, so an importer can read the label as button text or
 * a job title. Block elements end a line; runs of blank lines collapse.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (m, _q, dq, sq, inner) => {
      const href = decodeEntities(dq ?? sq ?? '').trim();
      const label = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (!/^https?:/i.test(href)) return ` ${label} `;
      return label ? ` ${label} ${href} ` : ` ${href} `;
    })
    .replace(BLOCK_END, '\n')
    .replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  return t
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    // Table cells and rows each end a line, so HTML spacing says nothing about
    // where one job ends. Drop the blank lines; the links mark each job.
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * @param {string} raw A saved email, or any other text.
 * @returns {string}
 */
export function emailToText(raw) {
  if (typeof raw !== 'string' || !looksLikeMime(raw)) return raw;
  const lines = raw.split(/\r?\n/);
  const html = [];
  const plain = [];
  let i = 0;
  while (i < lines.length) {
    // A part starts with a header block that names a Content-Type.
    if (!/^content-type:/i.test(lines[i])) {
      i++;
      continue;
    }
    const headers = {};
    let last = '';
    for (; i < lines.length && lines[i] !== ''; i++) {
      const line = lines[i];
      if (/^[ \t]/.test(line) && last) {
        headers[last] += ` ${line.trim()}`;
        continue;
      }
      const m = line.match(HEADER);
      if (m) {
        last = m[1].toLowerCase();
        headers[last] = m[2];
      }
    }
    const type = (headers['content-type'] || '').toLowerCase();
    const charset = (type.match(/charset="?([^";\s]+)/) || [])[1];
    const encoding = (headers['content-transfer-encoding'] || '').trim().toLowerCase();
    i++;
    const body = [];
    for (; i < lines.length && !/^--\S/.test(lines[i]); i++) body.push(lines[i]);
    if (!/^text\/(html|plain)/.test(type)) continue;
    let text = body.join('\n');
    if (encoding === 'base64') text = decodeBase64(text, charset);
    else if (encoding === 'quoted-printable') text = decodeQuotedPrintable(text, charset);
    if (type.startsWith('text/html')) html.push(htmlToText(text));
    else plain.push(text);
  }
  const parts = html.length ? html : plain;
  return parts.length ? parts.join('\n\n') : raw;
}
