# Article Share Link Fix

## Issue

Shared article links were opening the Times of SF homepage preview instead of the specific article preview.

Examples of the old link shape:

- `/?articleId=my-article-slug`

This worked for React deep-linking in the browser, but social platforms and link preview crawlers often read the raw server HTML instead of waiting for the frontend app to load and update metadata.

## Root Cause

There were two related problems:

1. Article sharing used SPA query-string deep links instead of stable article paths.
2. The server returned homepage HTML metadata for shared links, so crawlers saw the site-level title, description, and Open Graph tags instead of article-specific tags.

## Solution Implemented

We changed article sharing and metadata handling to use real article routes:

- New article URL format: `/articles/:slug`

We also updated the app and server so article metadata is resolved correctly.

### Frontend changes

- Share actions now copy/share `/articles/:slug`
- Canonical URLs and structured data now point to `/articles/:slug`
- The app still accepts legacy `?articleId=` links for backward compatibility

### Server changes

- Express now serves article-specific meta tags for `/articles/:slug`
- Sitemap article URLs now use `/articles/:slug`
- Legacy homepage deep links like `/?articleId=slug` are resolved server-side for better preview compatibility
- Invalid or missing article routes now fail more gracefully

## Files Updated

- `src/App.tsx`
- `src/components/SeoHead.tsx`
- `src/lib/site.ts`
- `server/db.ts`
- `server/index.ts`
- `server/ownerAdminHtml.ts`

## Result

- New article shares should preview the direct article instead of the homepage
- Older shared links using `?articleId=` should work more reliably
- Missing article links now degrade more safely instead of leaving a broken deep-link state

## Verification

- `npm run lint:server`
- `npm run build`

Both passed after the changes.
