import { ServiceError } from '../services/process.js'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface Wp2mdOptions {
  input: string;
  wpDir?: string;
  output: string;
  saveImages: string;
  postFolders: boolean;
  prefixDate: boolean;
  dateFolders: string;
  strictSsl: boolean;
  requestDelay: number;
}

/**
 * Rewrites image URLs in the WXR XML so they all point to the local static server.
 *
 * Handles:
 *  - Relative attachment_url paths:  /wp-content/uploads/... → http://localhost:PORT/wp-content/uploads/...
 *  - https://instinsight.com/...      → http://localhost:PORT/...
 *  - http://instinsight.com/...       → http://localhost:PORT/...
 *  - http://127.0.0.1/wp/...          → http://localhost:PORT/...   (strips /wp prefix)
 */
export function patchXmlUrls(xml: string, siteUrl: string, localBase: string): string {
  // parse just the hostname from siteUrl to also cover http:// variant
  let siteOrigin = siteUrl;
  try {
    const u = new URL(siteUrl);
    siteOrigin = u.origin; // e.g. https://instinsight.com
  } catch {
    // keep as-is
  }

  // derive http:// variant too
  const siteOriginHttp = siteOrigin.replace(/^https:\/\//, 'http://');
  const siteOriginHttps = siteOrigin.replace(/^http:\/\//, 'https://');

  let patched = xml;

  // 1. Replace site origin (both http and https)
  patched = patched.split(siteOriginHttps).join(localBase);
  patched = patched.split(siteOriginHttp).join(localBase);

  // 2. Replace 127.0.0.1/wp/ (strip the /wp prefix)
  patched = patched.split('http://127.0.0.1/wp/').join(localBase + '/');
  patched = patched.split('https://127.0.0.1/wp/').join(localBase + '/');
  patched = patched.split('http://127.0.0.1/').join(localBase + '/');
  patched = patched.split('https://127.0.0.1/').join(localBase + '/');

  // 3. Make relative /wp-content/uploads/... in attachment_url absolute
  //    Only inside CDATA blocks that look like attachment_url
  patched = patched.replace(
    /(<wp:attachment_url><!\[CDATA\[)(\/wp-content\/)/g,
    `$1${localBase}$2`,
  );

  // 4. Make relative <link> elements in RSS items absolute so scraped-image
  //    resolution works (parser.js needs an absolute post link to resolve
  //    relative img src paths)
  patched = patched.replace(/<link>(\/[^<]*)<\/link>/g, `<link>${localBase}$1</link>`);

  return patched;
}

/** Extract the site URL from the WXR <link> element */
export function extractSiteUrl(xml: string): string {
  const match = xml.match(/<link>(https?:\/\/[^<]+)<\/link>/);
  return match ? match[1].trim() : 'https://example.com';
}

/** Resolve the path to the wordpress-export-to-markdown CLI entry point */
export function resolveWp2mdBin(): string {
  // Try to resolve from package location relative to this file
  const candidates = [
    // installed as dependency in the monorepo
    fileURLToPath(
      new URL(
        '../../../../../node_modules/wordpress-export-to-markdown/app.js',
        import.meta.url,
      ),
    ),
    fileURLToPath(
      new URL(
        '../../../../node_modules/wordpress-export-to-markdown/app.js',
        import.meta.url,
      ),
    ),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  throw new Error(
    'wordpress-export-to-markdown not found. Run: npm install wordpress-export-to-markdown',
  );
}

/** Raw upstream conversion is intentionally unavailable: it bypasses #24's network/path boundary. */
export async function runWp2md(_options: Wp2mdOptions): Promise<never> {
  throw new ServiceError('UNSAFE_CONVERTER_DISABLED', 'Raw wp2md is disabled; use migrate with the bounded native converter')
}
