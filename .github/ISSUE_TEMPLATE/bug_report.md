---
name: Bug report
about: Report a migration that didn't pass the quality bar
title: "[Bug] "
labels: bug
assignees: ''
---

## Describe the bug
A clear description of what went wrong during migration.

## Checklist (helps us reproduce fast)
- [ ] **WP export size**: (e.g. 1,200 posts / 45MB WXR)
- [ ] **Theme used**: (name of the WordPress theme the export came from)
- [ ] **Which "bar to clear" check failed?** (see ROADMAP.md "The bar to clear" — pick one or more)
  - [ ] `npm run build` did not succeed
  - [ ] `redirects.json` missing an entry for a published post
  - [ ] A post has an empty `author` field
  - [ ] A post has blank `description`/`excerpt` despite Yoast meta in source
  - [ ] Migration report shows a silent drop (shortcode deleted instead of preserved as comment)
  - [ ] A post fails to open in Keystatic admin / fails validation

## Steps to reproduce
1. Command run (e.g. `depress migrate --input export.xml --output ./output`)
2. ...

## Expected behavior
What you expected to happen.

## Actual behavior
What actually happened. Include error output / stack trace if any.

## Environment
- depress / `@depress/cli` version:
- Node version:
- OS:

## Additional context
Anything else useful (sample WXR snippet, screenshots, etc).
