# depress — Revenue & Go-to-Market Plan

## Who the buyer is

Large companies on WordPress are not individual developers. They are:

- **Publishers and media sites** — 50–500 pages, active editorial team, can't afford downtime
- **SaaS marketing sites** — heavy WooCommerce or ACF usage, dev team wants off WP but migration risk blocks them
- **Agencies** — migrate 5–30 client sites per year, currently bill $8k–$40k per project manually
- **Enterprise brands** — running WordPress VIP ($25k+/yr) and looking to cut infra costs by moving to Jamstack

What they share: the migration itself isn't the scary part — **losing Google rankings, breaking the editorial workflow, and retraining the content team** is what blocks them. Your product solves all three.

---

## Tiers

### Free (open source, stays open source)
- Single site, CLI only
- AstroWind and Rocket themes
- Community support via GitHub Issues
- **Purpose:** builds trust, drives word-of-mouth among developers, feeds the paid funnel

### Pro — $299 one-time per migration
Targets: solo developers, small agencies, startup marketing teams

Unlocks:
- Web UI (no CLI required — upload WXR + SQL, download zip)
- DB import (SEO meta, featured images, author bios from `wp_postmeta`)
- Full media download (re-fetches images from live WP site)
- Priority email support (48h SLA)
- All theme adapters including premium ones

### Agency — $149/mo or $990/yr
Targets: digital agencies doing 5+ migrations per year

Everything in Pro, plus:
- Unlimited migrations
- White-label output (remove depress branding, inject agency footer)
- Client handoff package (generated README, Keystatic CMS walkthrough PDF)
- Webhook/API access for pipeline integration
- Team seats (up to 5)

### Enterprise — starting $4,000/yr
Targets: companies on WordPress VIP, large publishers, brands with 500+ pages

Everything in Agency, plus:
- Dedicated migration engineer (1 assisted migration per quarter included)
- Custom theme adapter for the company's existing design system
- SEO audit report pre/post migration (redirect map, canonical check)
- SLA: 4h response, named Slack channel
- On-prem/air-gapped deployment option
- Annual contract with invoicing (not card)

---

## Revenue streams beyond subscriptions

**1. Managed migration service** (highest margin)
Full done-for-you: depress team runs the migration, QAs every page, hands off a production-ready site. Price: $3k–$15k depending on site size. Gross margin ~70% once the tooling is mature. One or two of these per month covers operating costs.

**2. Premium theme marketplace**
Third-party Astro theme authors sell adapters through depress ($49–$149 one-time). You take 30%. Creates a network effect — more themes → more reasons to pay. Themes listed on astro.build already have audiences.

**3. Hosting partnerships**
Netlify, Vercel, and Cloudflare Pages all have referral programs. Every generated site can include a one-click "Deploy to Netlify" button. At scale this becomes meaningful passive revenue.

**4. WordPress agency reseller program**
WP agencies are scared of Astro but their clients are asking for Jamstack. Let agencies resell depress migrations as their own offering. They mark up 3x, you get $80–$200 per migration passively. Agencies become your sales force.

---

## What makes enterprise deals close

Enterprise buyers don't buy tools — they buy **risk reduction**. The pitch is not "Astro is faster than WordPress." The pitch is:

> "You keep your content team. They edit posts in the same CMS-like interface. Your URLs don't change. Your SEO doesn't drop. Your infra bill goes from $2,000/mo to $40/mo. The migration takes a weekend, not six months."

Three objections that kill deals and how to answer them:

| Objection | Answer |
|---|---|
| "We have 800 pages of custom page builder content" | DB import reads ACF and custom post types. Unmappable content is flagged with a report, not silently dropped. |
| "Our editors can't use markdown / git" | Keystatic admin is included. It looks like WordPress. No git knowledge needed. |
| "What about SEO? We can't risk rankings" | The migration generates a full redirect map and preserves Yoast meta. We can show a pre-migration SEO diff. |

---

## Where to find buyers

**Inbound (content-led)**
- Write "WordPress to Astro migration: what actually breaks" — ranks for high-intent searches, drives demo requests
- Post the open-source CLI on Hacker News, Product Hunt, Astro Discord — developer adoption creates the bottom of the funnel
- Guest posts on Smashing Magazine, CSS-Tricks, the Netlify/Vercel blogs

**Outbound (agency-led)**
- Target WP agencies on LinkedIn who list "WordPress" + "performance" + "Jamstack" in their services
- Offer a free pilot migration (one small site) in exchange for a case study
- The case study becomes the enterprise sales asset

**Community**
- Sponsor or present at WordCamp (ironic but the migration audience is there)
- Astro Discord is full of developers who are pitching Astro to clients but can't close because of migration risk — give them the tool and they sell it for you

---

## Pricing psychology note

$299 one-time for Pro sounds cheap against a $10,000 manual migration — and it is. That's intentional. The goal at Pro is volume and word-of-mouth. The enterprise value is in **managed migrations + custom theme adapters**, not seat licensing. Price those on business value (time saved, risk avoided), not on feature lists.

---

## 12-month milestone targets

| Month | Goal |
|---|---|
| 1–2 | Ship web UI (Pro tier). First 10 paying customers from existing open-source users. |
| 3–4 | First agency deal. One managed migration completed and documented as case study. |
| 5–6 | Agency tier live. 3 active agency subscriptions. Theme marketplace with 2 third-party adapters. |
| 7–9 | First enterprise contract ($4k+). WordPress VIP migration as flagship reference. |
| 10–12 | $8–12k MRR. Hosting partnership with Netlify or Cloudflare live. |
