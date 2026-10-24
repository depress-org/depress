# Exact advisory inventory

Generated offline by scripts/security-audit.mjs from the baseline npm audit and baseline lock.
Package findings: 19; distinct direct advisories: 53.
A propagated package finding is not another distinct vulnerability. Reachability and remediation are in README.md.

| Package | Maximum severity | Exact locked nodes | Propagated via |
| --- | --- | --- | --- |
| @astrojs/cloudflare | high | node_modules/@astrojs/cloudflare: 10.4.2 | astro, esbuild, miniflare, wrangler |
| @astrojs/markdoc | moderate | node_modules/@astrojs/markdoc: 0.11.5 | astro, esbuild |
| @astrojs/tailwind | moderate | node_modules/@astrojs/tailwind: 5.1.5 | tailwindcss |
| @fastify/busboy | high | node_modules/@fastify/busboy: 2.1.1 | direct advisory |
| astro | critical | node_modules/astro: 4.16.19 | esbuild, sharp, vite, zod, zod-to-ts |
| esbuild | moderate | node_modules/@astrojs/markdoc/node_modules/esbuild: 0.21.5<br>node_modules/astro/node_modules/esbuild: 0.21.5<br>node_modules/esbuild: 0.19.12<br>node_modules/vite/node_modules/esbuild: 0.21.5<br>node_modules/wrangler/node_modules/esbuild: 0.17.19 | direct advisory |
| fast-xml-parser | moderate | node_modules/fast-xml-parser: 4.5.7 | direct advisory |
| miniflare | high | node_modules/miniflare: 3.20250718.3 | undici, ws, zod |
| nanoid | high | node_modules/nanoid: 5.1.11 | direct advisory |
| postcss-nested | moderate | node_modules/postcss-nested: 6.2.0 | postcss-selector-parser |
| postcss-selector-parser | moderate | node_modules/postcss-selector-parser: 6.1.5 | direct advisory |
| sharp | high | node_modules/sharp: 0.33.5 | direct advisory |
| tailwindcss | moderate | node_modules/tailwindcss: 3.4.19 | postcss-nested, postcss-selector-parser |
| undici | high | node_modules/undici: 5.29.0 | @fastify/busboy |
| vite | high | node_modules/vite: 5.4.21 | esbuild |
| wrangler | high | node_modules/wrangler: 3.114.17 | esbuild, miniflare, sharp |
| ws | high | node_modules/ws: 8.18.0 | direct advisory |
| zod | high | node_modules/astro/node_modules/zod: 3.25.76<br>node_modules/miniflare/node_modules/zod: 3.22.3<br>node_modules/zod: 4.4.2 | direct advisory |
| zod-to-ts | high | node_modules/astro/node_modules/zod-to-ts: 1.2.0 | zod |

| Advisory | Package | Severity | Affected versions (registry snapshot) | Title |
| --- | --- | --- | --- | --- |
| [GHSA-26w7-cxv4-gfx2](https://github.com/advisories/GHSA-26w7-cxv4-gfx2) | astro | critical | <7.2.8 | Astro: Remote code execution through AVIF image optimization |
| [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) | nanoid | high | >=4.0.0 <5.1.16 | nanoid: non-secure generators can loop indefinitely with negative size |
| [GHSA-2mjp-6q6p-2qxm](https://github.com/advisories/GHSA-2mjp-6q6p-2qxm) | undici | moderate | <6.24.0 | Undici has an HTTP Request/Response Smuggling issue |
| [GHSA-2pvr-wf23-7pc7](https://github.com/advisories/GHSA-2pvr-wf23-7pc7) | astro | high | <6.4.6 | Astro: Host header SSRF in prerendered error page fetch |
| [GHSA-35p6-xmwp-9g52](https://github.com/advisories/GHSA-35p6-xmwp-9g52) | undici | low | <6.27.0 | undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse |
| [GHSA-376h-93r7-7g6f](https://github.com/advisories/GHSA-376h-93r7-7g6f) | astro | moderate | <=7.2.3 | Astro: Authorization bypass from missing path-segment boundary check when stripping the configured base |
| [GHSA-4992-7rv2-5pvq](https://github.com/advisories/GHSA-4992-7rv2-5pvq) | undici | moderate | <6.24.0 | Undici has CRLF Injection in undici via `upgrade` option |
| [GHSA-4g3v-8h47-v7g6](https://github.com/advisories/GHSA-4g3v-8h47-v7g6) | astro | moderate | >=2.9.0 <=7.0.9 | Astro: Reflected XSS via unescaped View Transition animation properties |
| [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) | vite | moderate | <=6.4.1 | Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling |
| [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) | vite | high | <=6.4.3 | launch-editor: `fs.existsSync()` existence check can be bypassed on Windows |
| [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) | ws | moderate | >=8.0.0 <8.20.1 | ws: Uninitialized memory disclosure |
| [GHSA-5ff5-9fcw-vg88](https://github.com/advisories/GHSA-5ff5-9fcw-vg88) | astro | moderate | <5.14.3 | Astro's `X-Forwarded-Host` is reflected without validation |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | esbuild | moderate | <=0.24.2 | esbuild enables any website to send any requests to the development server and read the response |
| [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) | vite | moderate | <=6.4.3 | launch-editor: escapeCmdArgs() omits % escaping on Windows |
| [GHSA-7pw4-f3q4-r2p2](https://github.com/advisories/GHSA-7pw4-f3q4-r2p2) | astro | low | >=3.10.0 <7.0.4 | Astro: Cross-site scripting via unescaped transition:* directive values on hydrated islands |
| [GHSA-88gm-j2wx-58h6](https://github.com/advisories/GHSA-88gm-j2wx-58h6) | @astrojs/cloudflare | low | <13.1.10 | Cloudflare has SSRF via redirect following through its image-binding-transform endpoint (incomplete fix for GHSA-qpr4) |
| [GHSA-8hv8-536x-4wqp](https://github.com/advisories/GHSA-8hv8-536x-4wqp) | astro | high | <6.3.3 | Astro: Reflected XSS via unescaped slot name |
| [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) | undici | moderate | <6.28.0 | undici vulnerable to downstream response desynchronization via retry interceptor |
| [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | ws | high | >=8.0.0 <8.21.0 | ws: Memory exhaustion DoS from tiny fragments and data chunks |
| [GHSA-98hj-9722-w3j8](https://github.com/advisories/GHSA-98hj-9722-w3j8) | astro | moderate | <7.3.2 | Astro: Reflected/Stored XSS via unescaped <script>/<style> tag content in JSX/MDX rendering |
| [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) | vite | low | <=6.4.3 | Vite: Cross origin script execution through Vite custom middleware |
| [GHSA-f48w-9m4c-m7f5](https://github.com/advisories/GHSA-f48w-9m4c-m7f5) | astro | moderate | <7.0.6 | Astro: XSS via unescaped spread attribute names in renderHTMLElement (incomplete fix for CVE-2026-54298) |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | sharp | high | <0.35.0 | sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 |
| [GHSA-fvmw-cj7j-j39q](https://github.com/advisories/GHSA-fvmw-cj7j-j39q) | astro | moderate | <5.15.9 | Astro Cloudflare adapter has Stored Cross-site Scripting vulnerability in /_image endpoint |
| [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) | vite | high | <=6.4.2 | vite: `server.fs.deny` bypass on Windows alternate paths |
| [GHSA-g735-7g2w-hh3f](https://github.com/advisories/GHSA-g735-7g2w-hh3f) | astro | low | >=2.10.10 <5.18.1 | Astro: Remote allowlist bypass via unanchored matchPathname wildcard |
| [GHSA-g8m3-5g58-fq7m](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) | undici | low | <6.27.0 | undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching |
| [GHSA-g9mf-h72j-4rw9](https://github.com/advisories/GHSA-g9mf-h72j-4rw9) | undici | moderate | <6.23.0 | Undici has an unbounded decompression chain in HTTP responses on Node.js Fetch API via Content-Encoding leads to resource exhaustion |
| [GHSA-ggxq-hp9w-j794](https://github.com/advisories/GHSA-ggxq-hp9w-j794) | astro | moderate | <5.15.8 | Astro's middleware authentication checks based on url.pathname can be bypassed via url encoded values |
| [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) | fast-xml-parser | moderate | <5.7.0 | fast-xml-parser XMLBuilder: XML Comment and CDATA Injection via Unescaped Delimiters |
| [GHSA-gxm5-99cw-xjw9](https://github.com/advisories/GHSA-gxm5-99cw-xjw9) | @fastify/busboy | moderate | <3.2.2 | @fastify/busboy vulnerable to CRLF injection via multipart Content-Disposition filename and name |
| [GHSA-hr2q-hp5q-x767](https://github.com/advisories/GHSA-hr2q-hp5q-x767) | astro | moderate | >=2.16.0 <5.15.5 | Astro vulnerable to URL manipulation via headers, leading to middleware and CVE-2025-61925 bypass |
| [GHSA-j687-52p2-xcff](https://github.com/advisories/GHSA-j687-52p2-xcff) | astro | moderate | <6.1.6 | Astro: XSS in define:vars via incomplete </script> tag sanitization |
| [GHSA-jrpj-wcv7-9fh9](https://github.com/advisories/GHSA-jrpj-wcv7-9fh9) | astro | moderate | <6.4.6 | Astro: XSS via Unescaped Attribute Names in Spread Props |
| [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) | undici | moderate | <6.28.0 | undici vulnerable to CRLF Injection via blob-like body 'type' property |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | zod | high | <4.6.6 | Zod can exhaust memory while validating oversized constrained collections |
| [GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv) | undici | moderate | <6.27.0 | undici vulnerable to HTTP header injection via Set-Cookie percent-decoding |
| [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) | undici | low | <6.28.1 | undici vulnerable to downstream response splitting via retry interceptor |
| [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) | vite | moderate | <=6.4.3 | launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | sharp | high | <0.35.4 | sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545 |
| [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | postcss-selector-parser | moderate | <7.1.6 | PostCSS: Quadratic complexity in flat selector parsing allows CPU exhaustion |
| [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) | vite | moderate | <=6.4.3 | Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine |
| [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) | undici | moderate | <6.28.0 | undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields |
| [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) | vite | moderate | <=6.4.2 | launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows |
| [GHSA-v9p9-hfj2-hcw8](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) | undici | high | <6.24.0 | Undici has Unhandled Exception in WebSocket Client Due to Invalid server_max_window_bits Validation |
| [GHSA-vrm6-8vpv-qv8q](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q) | undici | high | <6.24.0 | Undici has Unbounded Memory Consumption in WebSocket permessage-deflate Decompression |
| [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | undici | high | <6.27.0 | undici WebSocket client vulnerable to denial of service via fragment count bypass |
| [GHSA-whqg-ppgf-wp8c](https://github.com/advisories/GHSA-whqg-ppgf-wp8c) | astro | moderate | <5.15.8 | Astro has an Authentication Bypass via Double URL Encoding, a bypass for CVE-2025-64765 |
| [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | sharp | high | <0.35.5 | sharp : Vulnerability in librsvg dependency CVE-2026-96889 |
| [GHSA-wrwg-2hg8-v723](https://github.com/advisories/GHSA-wrwg-2hg8-v723) | astro | high | <=5.15.6 | Astro vulnerable to reflected XSS via the server islands feature |
| [GHSA-x3h8-62x9-952g](https://github.com/advisories/GHSA-x3h8-62x9-952g) | astro | low | <5.14.3 | Astro Development Server has Arbitrary Local File Read |
| [GHSA-x8mw-p69m-v3mx](https://github.com/advisories/GHSA-x8mw-p69m-v3mx) | @fastify/busboy | high | >=1.0.0 <3.2.1 | @fastify/busboy vulnerable to Denial of Service via prototype-named multipart part header |
| [GHSA-xr5h-phrj-8vxv](https://github.com/advisories/GHSA-xr5h-phrj-8vxv) | astro | low | <6.1.10 | Astro: Server island encrypted parameters vulnerable to cross-component replay |

