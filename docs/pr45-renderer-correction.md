# PR45 / #30 bounded renderer correction

This author correction is **not** original #30 completion, full-all-theme P12
acceptance, security remediation completion, or release GO. The existing sole
independent QA lane retains final exact-head integration ownership.

## P04: distinguish H2 prose loss from H1 attribute publication

The unchanged independent one/two-newline fixture was reproduced before editing:

```html
<p>First body marker alpha.</p>[unknown-widget
internal="QA_ATTRIBUTE_OPACITY_30"]Safe inner prose.[/unknown-widget]<p>Safe tail prose.</p>
```

Default-empty/enabled plugin configuration × service/CLI × one/two newlines
produced eight successful scaffold builds, CLI exit 1 when invoked, failed item
101, and false canonical readiness. All eight lost `Safe inner prose.` in the
actual nested article body. The attribute was **not** published: this is H2, not
a recurrence of H1. The original fixture, raw RED logs, generated documents,
actual HTML and byte-scan results are retained in the task evidence.

Two boundaries matter: the lexer must own the complete balanced multiline
shortcode boundary (newlines are attribute whitespace), and unresolved opaque
review comments must be isolated by blank lines. A line-leading Markdown HTML
comment otherwise consumes same-line following ordinary prose. No regex rewrite
of arbitrary source text, raw attribute publication, or plugin execution was
introduced. Malformed-boundary fallback remains bounded; unresolved tokens remain
unowned and fail closed. Owned gallery output is unchanged.

The existing generated suite retains H1's eight builds and adds H2's eight:
actual inner/first/tail body prose, source attribute opacity across all public and
dist files, private report absence, item failure, CLI exit 1, service/CLI parity,
and canonical rejection. Safe code/escaped examples and historical privacy,
nested/XHTML, media, gallery and negative renderer controls remain required.

## P12: supported AstroWind physical output is not canonical proof

The independent cold full-theme evidence at reviewed candidate `0c6003f`
shows successful AstroWind install/build, real CMS article/body reading, ordered
gallery images with decoded alts and distinct source bytes, and unchanged-lock
reinstall/rebuild. Scaffold additionally supports pages. Rocket remains MDX-only
and must be rejected **before any output**, not enabled to make a matrix green.

AstroWind's generated article is plain `.md`. The canonical report's `bodyText`
and `images` deliberately prove only the bounded static Markdoc grammar for
`.mdoc`; they return unknown prose/empty image proof for `.md`. Thus even a
physically rendered correct gallery stays `not-preserved` in canonical JSON and
Markdown. **This renderer-specific proof gap remains unresolved by this bounded
correction.** Removing the extension guards or parsing Markdown as Markdoc would
not establish equivalence with AstroWind's Markdown pipeline and remark/rehype
configuration. No arbitrary HTML, MDX, imports, custom modules, or content code
may be enabled to establish preservation. A future closure needs bounded exact
renderer/provenance proof plus actual negative controls and canonical replay.

AstroWind has no supported page adapter. A normal published page in a layout
without `pagesDir` now reports source-linked `unsupported-page`, with unsupported
status and false readiness, instead of misleading `unsafe-path`. This does not
add a route or adapter; physical content/public inventory still runs independently.
Malformed slugs, symlinks and unsupported physical documents remain fail-closed.
Unclaimed bundled `public/decapcms/index.html` still fails inventory; there is no
blanket public-HTML exemption or invented template-provenance approval.

Full-all-theme P12 remains NOT PASS. The supported physical build evidence is
not a waiver for canonical gallery proof, absent pages, Rocket MDX policy, or
unclaimed public HTML. No compatibility matrix is promoted to shipped/general
WordPress plugin support. Root/packed-CLI findings, literal Release failure,
default canonical quality false, #25 and #26 NO-GO remain independent blockers.
