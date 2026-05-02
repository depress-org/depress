import chalk from 'chalk';
import ora from 'ora';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createReadStream, existsSync } from 'fs';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'fs/promises';
import { join, resolve, extname } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

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

// MIME types for common file extensions served from uploads
const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
};

/**
 * Starts a simple static HTTP server rooted at `rootDir`.
 * Returns the bound port and a stop function.
 */
function startFileServer(
  rootDir: string,
): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let rawPath = req.url ?? '/';

      // strip query string
      rawPath = rawPath.split('?')[0];

      // decode percent-encoded path (handles Cyrillic filenames)
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawPath);
      } catch {
        decoded = rawPath;
      }

      // prevent path traversal
      const safePath = join(rootDir, decoded.replace(/\.\./g, ''));
      const filePath = resolve(safePath);

      if (!filePath.startsWith(resolve(rootDir))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_MAP[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      createReadStream(filePath).pipe(res);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        rejectPromise(new Error('Could not determine server port'));
        return;
      }
      resolvePromise({
        port: addr.port,
        stop: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });

    server.on('error', rejectPromise);
  });
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
function patchXmlUrls(xml: string, siteUrl: string, localBase: string): string {
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
function extractSiteUrl(xml: string): string {
  const match = xml.match(/<link>(https?:\/\/[^<]+)<\/link>/);
  return match ? match[1].trim() : 'https://example.com';
}

/** Resolve the path to the wordpress-export-to-markdown CLI entry point */
function resolveWp2mdBin(): string {
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

/** Run wordpress-export-to-markdown as a child process */
function runWpExportToMarkdown(
  binPath: string,
  args: string[],
): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code === 0) res();
      else rej(new Error(`wordpress-export-to-markdown exited with code ${code}`));
    });
    child.on('error', rej);
  });
}

export async function runWp2md(options: Wp2mdOptions) {
  console.log(chalk.cyan('WordPress → Markdown (wordpress-export-to-markdown)\n'));

  const inputFile = resolve(options.input);
  const outputDir = resolve(options.output);

  if (!existsSync(inputFile)) {
    console.error(chalk.red(`Input file not found: ${inputFile}`));
    process.exit(1);
  }

  await mkdir(outputDir, { recursive: true });

  const binPath = resolveWp2mdBin();

  const useLocalMedia =
    options.wpDir &&
    options.saveImages !== 'none' &&
    existsSync(resolve(options.wpDir));

  let tmpDir: string | undefined;
  let serverStop: (() => Promise<void>) | undefined;
  let effectiveInput = inputFile;

  if (useLocalMedia) {
    const wpDir = resolve(options.wpDir!);
    const serverSpinner = ora('Starting local media server…').start();

    try {
      const { port, stop } = await startFileServer(wpDir);
      serverStop = stop;
      const localBase = `http://127.0.0.1:${port}`;
      serverSpinner.succeed(`Local media server running at ${chalk.cyan(localBase)} → ${chalk.gray(wpDir)}`);

      // Read and patch the XML
      const patchSpinner = ora('Patching XML image URLs to use local server…').start();
      const rawXml = await readFile(inputFile, 'utf8');
      const siteUrl = extractSiteUrl(rawXml);
      const patchedXml = patchXmlUrls(rawXml, siteUrl, localBase);

      // Write patched XML to a temp file
      tmpDir = await mkdtemp(join(tmpdir(), 'depress-wp2md-'));
      effectiveInput = join(tmpDir, 'patched-export.xml');
      await writeFile(effectiveInput, patchedXml, 'utf8');
      patchSpinner.succeed(`XML patched (site URL: ${chalk.gray(siteUrl)} → ${chalk.cyan(localBase)})`);
    } catch (err) {
      serverSpinner.fail(`Failed to start local server: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else if (options.wpDir && options.saveImages !== 'none') {
    console.warn(chalk.yellow(`⚠ -d/--wp-dir not found, images will be downloaded from original URLs`));
  }

  // Build argument list for wordpress-export-to-markdown
  const args: string[] = [
    '--wizard=false',
    `--input=${effectiveInput}`,
    `--output=${outputDir}`,
    `--save-images=${options.saveImages}`,
    `--post-folders=${options.postFolders}`,
    `--prefix-date=${options.prefixDate}`,
    `--date-folders=${options.dateFolders}`,
    `--strict-ssl=${options.strictSsl}`,
    `--request-delay=${options.requestDelay}`,
  ];

  console.log(chalk.bold('\nRunning wordpress-export-to-markdown…\n'));

  try {
    await runWpExportToMarkdown(binPath, args);
    console.log(chalk.bold.green('\nMigration complete!'));
    console.log(`\n  Output: ${chalk.cyan(outputDir)}`);
  } catch (err) {
    console.error(chalk.red(`\nMigration failed: ${err instanceof Error ? err.message : String(err)}`));
  } finally {
    // Clean up temp dir and server
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (serverStop) {
      await serverStop().catch(() => undefined);
    }
  }
}

