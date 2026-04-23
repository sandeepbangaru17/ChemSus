# SEO & AI Optimization — ChemSus Technologies

Complete documentation of the SEO, GEO (Generative Engine Optimization), and performance setup for `chemsus.in`.

---

## Table of Contents

1. [Overview](#overview)
2. [How Traditional Search Engines Work](#how-traditional-search-engines-work)
3. [How AI Models Work — Internal Process](#how-ai-models-work--internal-process)
4. [ChatGPT / OpenAI Optimization](#chatgpt--openai-optimization)
5. [Claude / Anthropic Optimization](#claude--anthropic-optimization)
6. [Perplexity AI Optimization](#perplexity-ai-optimization)
7. [Google AI Overview Optimization](#google-ai-overview-optimization)
8. [File Structure](#file-structure)
9. [Meta Tags](#meta-tags)
10. [Structured Data (Schema.org)](#structured-data-schemaorg)
11. [robots.txt](#robotstxt)
12. [sitemap.xml](#sitemapxml)
13. [llms.txt](#llmstxt)
14. [Google Search Console — Deep Dive](#google-search-console--deep-dive)
15. [Bing Webmaster Tools](#bing-webmaster-tools)
16. [PageSpeed & Core Web Vitals](#pagespeed--core-web-vitals)
17. [Pending Setup](#pending-setup)
18. [How to Update SEO When Adding a New Product](#how-to-update-seo-when-adding-a-new-product)
19. [Common Issues & Fixes](#common-issues--fixes)

---

## Overview

Two parallel systems decide whether ChemSus appears when someone searches for your chemicals:

**Traditional SEO** — Google, Bing rank your pages based on content quality, technical signals, and authority. Results appear as blue links.

**GEO (Generative Engine Optimization)** — ChatGPT, Claude, Perplexity, Google AI Overview generate a direct answer and may cite your site as a source. No blue link — your brand appears in the AI's response.

Both matter. A buyer searching "levulinic acid supplier India" might use Google, or they might ask ChatGPT. You need to be visible in both.

---

## How Traditional Search Engines Work

```
User types: "buy levulinic acid India"
                    │
                    ▼
        ┌─────────────────────┐
        │   Google's Index    │  ← built by Googlebot crawling your pages
        │  (billions of pages)│
        └─────────────────────┘
                    │
                    ▼
        ┌─────────────────────┐
        │   Ranking Algorithm │  ← 200+ signals evaluated
        │                     │
        │  • Relevance        │  ← does your content match the query?
        │  • Authority        │  ← do other sites link to you?
        │  • Technical        │  ← speed, mobile, HTTPS, structured data
        │  • UX signals       │  ← do users click and stay?
        └─────────────────────┘
                    │
                    ▼
        Search Results Page (SERP)
        ├── Blue links (organic results)
        ├── FAQ dropdowns (from FAQPage schema)
        ├── Breadcrumbs (from BreadcrumbList schema)
        └── AI Overview (from structured + indexed content)
```

**Three stages Google runs on your site:**

### Stage 1: Crawl
Googlebot visits your URLs, reads your HTML, follows links.
- Controlled by `robots.txt` (what to crawl) and `sitemap.xml` (what exists)
- Crawl frequency depends on page importance and how often content changes
- New sites get crawled slowly — can take weeks for all pages to be visited

### Stage 2: Index
Google parses and stores the page content in its index.
- Reads meta tags, headings, body text, structured data
- Evaluates page quality — thin content, duplicate content, and spam are filtered out
- `noindex` pages are explicitly excluded
- Canonical URL is respected — if two pages have the same content, only the canonical one is indexed

### Stage 3: Rank
Google scores your page for every possible search query and decides its position.
- **Relevance** — keyword match between query and your content, title, description
- **Authority** — PageRank: how many quality sites link to yours
- **Core Web Vitals** — LCP, CLS, FCP (speed = ranking factor)
- **Schema.org signals** — structured data helps Google understand what your page is about
- **Click-through rate** — if users skip your result in search, Google lowers your ranking

---

## How AI Models Work — Internal Process

AI assistants (ChatGPT, Claude, Perplexity, Gemini) decide what to say about your company through two completely different mechanisms depending on how the user asks:

### Mechanism 1: Training Data (Built-in Knowledge)

```
Anthropic / OpenAI trains the model
            │
            ▼
Crawls billions of web pages up to a cutoff date
(Claude cutoff: early 2025 | ChatGPT cutoff: early 2024)
            │
            ▼
Compresses all that knowledge into model weights
            │
            ▼
User asks: "Who makes levulinic acid in India?"
            │
            ▼
Model generates answer from memorized training data
(ChemSus will appear here ONLY if it was indexed before cutoff
 AND appeared in enough web sources to be memorized)
```

ChemSus was launched after these cutoff dates, so **it does not exist in any AI's built-in knowledge yet**. This will change as models are retrained (typically every 6–12 months).

### Mechanism 2: Live Web Search (Retrieval-Augmented Generation)

```
User asks: "Who sells levulinic acid in India?" (with web search enabled)
            │
            ▼
AI sends query to a search engine
(ChatGPT → Bing | Claude → multiple sources | Perplexity → its own index)
            │
            ▼
Search engine returns top results
            │
            ▼
AI reads the content of those pages
            │
            ▼
AI reads llms.txt if available (structured summary)
            │
            ▼
AI synthesizes an answer and cites sources
(ChemSus appears here IF it ranks on that search engine)
```

This is where your SEO and llms.txt work directly pays off — **right now, today**.

### What AI Models Look for When Citing a Source

When an AI reads your page and decides whether to cite it, it evaluates:

| Signal | What AI Looks For | ChemSus Status |
|---|---|---|
| Factual density | CAS numbers, formulas, molecular weights | ✓ Present on all product pages |
| Entity clarity | Clear company name, location, contact | ✓ In llms.txt and homepage schema |
| Page authority | Is this site indexed and trusted by search engines? | ✓ GSC verified, sitemap submitted |
| Structured data | Schema.org Product, Organization, FAQ | ✓ All product pages |
| llms.txt | Machine-readable site summary | ✓ Present at chemsus.in/llms.txt |
| Content specificity | Specific claims with numbers, not vague | ✓ IUPAC names, CAS, MW |
| Freshness | Recently crawled, recently updated | Improving as GSC indexes pages |

---

## ChatGPT / OpenAI Optimization

### How ChatGPT Finds Your Site

ChatGPT (when browsing is enabled) uses **Bing** as its search backend. The process:

```
User asks ChatGPT with browsing:
"Who sells 5-HMF in India?"
        │
        ▼
ChatGPT sends query to Bing API
        │
        ▼
Bing returns top results from its index
        │
        ▼
ChatGPT reads those pages + their llms.txt
        │
        ▼
ChatGPT generates answer citing chemsus.in
```

**Critical insight:** If you are not indexed on Bing, ChatGPT cannot find you even if you rank #1 on Google. They are completely separate indexes.

### OpenAI's Crawler: GPTBot

OpenAI crawls the web with a bot called `GPTBot` to:
1. Build training data for future model versions
2. Populate Bing's index with fresh content (indirectly)

Your `robots.txt` explicitly allows GPTBot:
```
User-agent: GPTBot
Allow: /
```

### What's Done for ChatGPT

| Task | Status |
|---|---|
| `robots.txt` allows GPTBot | ✓ Done |
| `llms.txt` present | ✓ Done |
| Google indexing (indirect Bing signal) | ✓ Requested |
| **Bing Webmaster Tools** | ⚠ PENDING — most critical step |
| Sitemap submitted to Bing | ⚠ PENDING |

### Bing Webmaster Tools Setup

Go to `bing.com/webmasters`:
1. Sign in with Microsoft account
2. Add site: `https://chemsus.in`
3. Verify with XML file method → paste file content here → deployed instantly
4. Submit sitemap: `https://chemsus.in/sitemap.xml`
5. Use "URL Submission" to manually push key product URLs

After Bing indexes your pages, ChatGPT will find ChemSus within **1–2 weeks**.

---

## Claude / Anthropic Optimization

### How Claude Finds Your Site

Claude (Anthropic) uses a different approach depending on context:

```
Claude with web search enabled:
        │
        ├── Searches multiple sources (not just Bing)
        ├── Reads llms.txt directly if URL is known
        ├── Reads page content via its crawler (ClaudeBot)
        └── Synthesizes answer citing sources

Claude without web search (built-in knowledge):
        │
        └── Answers from training data only
            (ChemSus not in training data yet — cutoff: early 2025)
```

### Anthropic's Crawlers

Anthropic has two crawler user agents:
- `ClaudeBot` — primary crawler
- `anthropic-ai` — secondary/research crawler

Both are explicitly allowed in your `robots.txt`:
```
User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /
```

### How llms.txt Specifically Helps Claude

Claude is built to respect the `llms.txt` standard (Anthropic is one of the founding supporters). When Claude accesses your site:

1. It first checks `chemsus.in/llms.txt`
2. Reads the structured product list with CAS numbers, uses, page URLs
3. Uses this as authoritative source data for answering queries

This is the most direct path to Claude citing ChemSus — your `llms.txt` is written exactly for this.

### Test Claude Citation Right Now

Open `claude.ai`, enable web search, and ask:
```
Search the web: who sells levulinic acid in India?
```
or:
```
Search the web: what is chemsus.in?
```

### What's Done for Claude

| Task | Status |
|---|---|
| `robots.txt` allows ClaudeBot | ✓ Done |
| `robots.txt` allows anthropic-ai | ✓ Done |
| `llms.txt` present and well-structured | ✓ Done |
| Schema.org Product data on all pages | ✓ Done |
| Google indexed (Claude searches Google too) | ✓ Requested |

---

## Perplexity AI Optimization

### How Perplexity Works

Perplexity is an "answer engine" — it always browses the web, even without a specific setting. It has its own index (separate from Google and Bing).

```
User asks Perplexity: "levulinic acid supplier India"
        │
        ▼
Perplexity queries its own index + live web
        │
        ▼
PerplexityBot reads your pages and llms.txt
        │
        ▼
Answer generated with inline citations and source links
```

### Perplexity's Crawler: PerplexityBot

Your `robots.txt` allows it:
```
User-agent: PerplexityBot
Allow: /
```

Perplexity automatically discovers and crawls sites — no submission portal needed. Once your site has a few external links pointing to it, Perplexity will index it within weeks.

### What's Done for Perplexity

| Task | Status |
|---|---|
| `robots.txt` allows PerplexityBot | ✓ Done |
| `llms.txt` present | ✓ Done |
| Rich product content with factual data | ✓ Done |
| No submission required | ✓ Auto-crawled |

---

## Google AI Overview Optimization

### How Google AI Overview Works

Google AI Overview (formerly SGE) appears at the top of search results for many queries. It generates a direct answer using your indexed pages and structured data.

```
User searches: "what is levulinic acid used for"
        │
        ▼
Google checks its index for relevant pages
        │
        ▼
Reads FAQPage schema → uses Q&A content directly
Reads Product schema → uses additionalProperty fields
Reads page headings and body text
        │
        ▼
Generates AI Overview paragraph
Cites source pages below the answer
```

### What Drives Google AI Overview Citations

1. **FAQPage schema** — the single most important signal. Your FAQ answers are directly injected into AI Overview responses. All 7 product pages have 4 FAQs each.
2. **Product schema** — CAS number, molecular formula, IUPAC name appear in AI answers about chemicals.
3. **Page authority** — higher-ranked pages get cited more. Backlinks improve this over time.
4. **Content freshness** — recently crawled pages with updated `<lastmod>` in sitemap are preferred.

### What's Done for Google AI Overview

| Task | Status |
|---|---|
| FAQPage schema on all product pages | ✓ Done (4 FAQs per page) |
| FAQPage schema on homepage | ✓ Done (4 company FAQs) |
| Product schema with CAS, formula, IUPAC | ✓ Done |
| Organization schema on homepage | ✓ Done |
| GSC verified + sitemap submitted | ✓ Done |

---

## File Structure

SEO-relevant files in this project:

```
public/
├── robots.txt                        ← controls all crawler access
├── sitemap.xml                       ← map of all 15 public pages
├── llms.txt                          ← AI/GPT crawler summary (llmstxt.org standard)
├── google39aca1545b862e69.html       ← Google Search Console ownership proof
│                                        ⚠ NEVER DELETE THIS FILE
├── index.html                        ← schema: Organization + WebSite + FAQ
├── about.html                        ← meta tags only
├── shop.html                         ← meta tags only
├── products.html                     ← meta tags only
├── contact.html                      ← meta tags + ContactPage schema
├── collaboration.html                ← meta tags only
├── recognitions.html                 ← meta tags only
├── investors.html                    ← meta tags only
└── products/
    ├── levulinic-acid.html           ← schema: Product + BreadcrumbList + FAQPage
    ├── 5-hmf.html                    ← schema: Product + BreadcrumbList + FAQPage
    ├── dala.html                     ← schema: Product + BreadcrumbList + FAQPage
    ├── sodium-levulinate.html        ← schema: Product + BreadcrumbList + FAQPage
    ├── calcium-levulinate.html       ← schema: Product + BreadcrumbList + FAQPage
    ├── ethyl-levulinate.html         ← schema: Product + BreadcrumbList + FAQPage
    └── methyl-levulinate.html        ← schema: Product + BreadcrumbList + FAQPage
```

---

## Meta Tags

Every public page has these tags inside `<head>`:

```html
<!-- Basic SEO -->
<meta name="description" content="...">
<meta name="keywords" content="...">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://chemsus.in/page.html">

<!-- Open Graph (LinkedIn, WhatsApp, Facebook link previews) -->
<meta property="og:type" content="website">
<meta property="og:title" content="...">
<meta property="og:description" content="...">
<meta property="og:url" content="https://chemsus.in/page.html">
<meta property="og:image" content="https://chemsus.in/assets/logo.webp">

<!-- Twitter / X Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="...">
<meta name="twitter:description" content="...">
<meta name="twitter:image" content="...">
```

**Private/functional pages** (cart, login, payment, etc.):
```html
<meta name="robots" content="noindex, nofollow">
```

### What Each Tag Does

| Tag | Purpose | Impact |
|---|---|---|
| `description` | Text shown under page title in Google results | High — affects click-through rate |
| `keywords` | Hints to search engines | Low on Google, moderate on Bing |
| `canonical` | Prevents duplicate content penalty | High — tells Google the "true" URL |
| `og:image` | Image when link is shared on social/messaging | Medium — drives link click rate |
| `robots: noindex` | Hides private pages from search | Critical — prevents private page indexing |

---

## Structured Data (Schema.org)

Schema.org is a machine-readable vocabulary embedded in HTML as JSON-LD. Google, Bing, Claude, ChatGPT all read it. It is the single most important technical SEO layer for a B2B chemical company.

All structured data is inside `<script type="application/ld+json">` in `<head>`.

### Homepage Schema (`index.html`)

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "name": "ChemSus Technologies Pvt Ltd",
      "url": "https://chemsus.in",
      "foundingDate": "2022",
      "address": { ... },
      "contactPoint": { "telephone": "+91-84868-77575", "email": "info@chemsus.in" },
      "hasOfferCatalog": { ... all 7 products listed ... }
    },
    {
      "@type": "WebSite",
      "potentialAction": { "@type": "SearchAction" }
    },
    {
      "@type": "FAQPage",
      "mainEntity": [ ... 4 company-level Q&As ... ]
    }
  ]
}
```

### Product Page Schema (`products/*.html`)

Each of the 7 product pages has:

```json
{
  "@graph": [
    {
      "@type": "Product",
      "name": "Levulinic Acid",
      "alternateName": ["4-Oxopentanoic Acid", "Laevulinic Acid"],
      "additionalProperty": [
        { "name": "CAS Number",        "value": "123-76-2" },
        { "name": "Molecular Formula", "value": "C5H8O3" },
        { "name": "Molecular Weight",  "value": "116.12 g/mol" },
        { "name": "IUPAC Name",        "value": "4-oxopentanoic acid" },
        { "name": "Origin",            "value": "Biomass-derived" }
      ]
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "position": 1, "name": "Home" },
        { "position": 2, "name": "Products" },
        { "position": 3, "name": "Levulinic Acid" }
      ]
    },
    {
      "@type": "FAQPage",
      "mainEntity": [ ... 4 product-specific Q&As ... ]
    }
  ]
}
```

### Why No Price in Product Schema

Google requires a numeric `price` in the `offers` block to show Product rich results (Merchant listings). ChemSus uses B2B negotiated pricing — no fixed price exists. Including a placeholder price would trigger "invalid item" errors. The `offers` block was **intentionally removed**. All other Product schema data (CAS, formula, manufacturer, category) remains and is used by AI models.

### Rich Results Enabled

| Schema Type | Google SERP Feature | Verified Status |
|---|---|---|
| `FAQPage` | Expandable Q&A dropdown under result | ✓ Valid — all product pages + homepage |
| `BreadcrumbList` | `Home › Products › Levulinic Acid` path | ✓ Valid — all product pages |
| `Organization` | Company knowledge panel (right sidebar) | ✓ Valid — homepage |
| `Product` | Product data in AI Overview | ✓ Valid — all product pages |

---

## robots.txt

Located at `public/robots.txt`. Served at `https://chemsus.in/robots.txt`.

```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /login.html
Disallow: /signup.html
Disallow: /cart.html
Disallow: /profile.html
Disallow: /my-orders.html
Disallow: /orders.html
Disallow: /buy.html
Disallow: /buynow.html
Disallow: /payment.html
Disallow: /payment2.html
Disallow: /quotation.html
Disallow: /request-sample.html
Disallow: /success.html
Disallow: /thankyou.html

Sitemap: https://chemsus.in/sitemap.xml

# AI crawlers — see llms.txt for structured content summary
# https://chemsus.in/llms.txt

User-agent: ClaudeBot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: GoogleOther
Allow: /

User-agent: anthropic-ai
Allow: /
```

### How robots.txt Works Internally

Every crawler checks `robots.txt` before visiting any page. The file is fetched once and cached. Rules are processed top to bottom — the first matching rule wins.

`User-agent: *` is the catch-all default. Specific user-agent blocks (like `User-agent: ClaudeBot`) override the default for that specific crawler. By explicitly listing AI crawlers with `Allow: /`, we ensure they are never accidentally blocked even if the catch-all rules change.

---

## sitemap.xml

Located at `public/sitemap.xml`. Served at `https://chemsus.in/sitemap.xml`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://chemsus.in/</loc>
    <lastmod>2026-04-22</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  ...
</urlset>
```

**Submitted to:** Google Search Console on 22 Apr 2026 — 15 pages discovered.

### Priority Structure

```
1.0  → homepage
0.9  → products.html, shop.html, all 7 product pages
0.8  → about.html, contact.html
0.7  → collaboration.html, investors.html
0.6  → recognitions.html
```

### When to Update sitemap.xml

- New page added → add `<url>` entry
- Major page change → update `<lastmod>` to today's date
- Page deleted → remove its `<url>` entry
- After any update → go to GSC → Sitemaps → click "Resubmit"

---

## llms.txt

Located at `public/llms.txt`. Served at `https://chemsus.in/llms.txt`.

This is the `llmstxt.org` standard — a plain text file that AI crawlers read to understand your entire site in one request, without scraping every page.

### Why It Matters

Without `llms.txt`, an AI reading your site must:
1. Crawl homepage → parse HTML → extract info
2. Crawl each product page → parse HTML → extract info
3. Stitch together a coherent picture

With `llms.txt`, the AI reads one file and immediately gets:
- Company identity, location, contact
- All products with CAS, formula, uses, page URLs
- Technology description
- Key page index

### Structure of chemsus.in/llms.txt

```
# ChemSus Technologies Pvt Ltd

> One-line summary for AI models

## Company
- Legal Name, Website, Email, Phone, Addresses

## Products
### Levulinic Acid (CAS 123-76-2)
- Molecular Formula: C5H8O3 | MW: 116.12 g/mol
- IUPAC: 4-oxopentanoic acid
- Uses: ...
- Page: https://chemsus.in/products/levulinic-acid.html

... (all 7 products)

## Key Pages
## About the Technology
## Sitemap
```

### AI Systems That Read llms.txt

| AI System | Reads llms.txt | Notes |
|---|---|---|
| Claude (Anthropic) | ✓ Yes | Anthropic co-created the standard |
| ChatGPT (OpenAI) | ✓ Yes | Via GPTBot crawler |
| Perplexity | ✓ Yes | Via PerplexityBot |
| Google Gemini | Partial | Reads if page is indexed |
| Microsoft Copilot | ✓ Yes | Uses Bing index |

### When to Update llms.txt

- New product → add `###` section with CAS, formula, uses, page URL
- Contact change → update Company section
- New important page → add to Key Pages
- Technology update → update About section

---

## Google Search Console — Deep Dive

**Property:** `https://chemsus.in`
**Verified:** HTML file method (`google39aca1545b862e69.html`) — do not delete
**Sitemap:** Submitted, 15 pages discovered

### What GSC Is

Google Search Console is Google's direct communication channel with webmasters. It tells you:
- Which pages are indexed and which are not
- Why pages failed to index
- Whether your Schema.org data is valid
- How many impressions and clicks your pages get in Google search
- Any manual penalties Google has applied

### Internal Flow: How GSC Works

```
You submit sitemap.xml to GSC
        │
        ▼
Google reads sitemap → discovers 15 URLs
        │
        ▼
Google crawl queue → Googlebot visits each URL
(timing: days to weeks for new sites)
        │
        ▼
Google parses HTML:
  ├── reads meta tags
  ├── reads Schema.org JSON-LD
  ├── checks canonical URL
  └── checks noindex
        │
        ├── If valid → page enters Index
        └── If issue → page flagged in Coverage report
        │
        ▼
You see status in GSC:
  ├── "Indexed" → page is live in Google search
  ├── "Discovered – currently not indexed" → in queue, not yet crawled
  ├── "Crawled – currently not indexed" → crawled but Google chose not to index
  └── "Excluded by noindex" → working correctly for private pages
```

### GSC Navigation Guide

**URL Inspection** (`GSC → URL Inspection`)
- Paste any URL → see its indexing status, last crawl date, detected schema
- Click "Request Indexing" to push a URL to the priority crawl queue
- Shows the exact HTML Google saw when it last crawled your page

**Coverage** (`GSC → Indexing → Pages`)
- Full list of all indexed + all errored pages
- Filter by status: Indexed / Not indexed / Excluded
- Most important errors: "Discovered not indexed" (waiting) vs "Crawled not indexed" (Google rejected it)

**Sitemaps** (`GSC → Indexing → Sitemaps`)
- Shows submitted sitemaps and how many pages were discovered vs indexed
- Re-submit after adding new pages

**Enhancements** (`GSC → Search appearance`)
- FAQPage, Breadcrumbs, Product snippets status
- Shows valid items and invalid items with exact error details
- Use this to verify Schema.org fixes worked

**Search Performance** (`GSC → Performance`)
- Queries that show your pages in search
- Impressions (how many times your page appeared in search results)
- Clicks (how many times users clicked your result)
- Average position (your rank for each query)
- Start checking this after 2–4 weeks of indexing

**Core Web Vitals** (`GSC → Experience → Core Web Vitals`)
- Real-user data on LCP, CLS, FID across all your indexed pages
- Categorized as Good / Needs Improvement / Poor
- Use alongside PageSpeed Insights for performance monitoring

### GSC Schema.org Status (as of 22 Apr 2026)

| Schema | Pages | Status |
|---|---|---|
| FAQPage | Homepage + 7 product pages | ✓ Valid |
| BreadcrumbList | 7 product pages | ✓ Valid |
| Organization | Homepage | ✓ Valid |
| Product snippets | 7 product pages | Previously invalid (offers missing price) → Fixed |

### Indexing Status (as of 22 Apr 2026)

| Page | Status |
|---|---|
| `https://chemsus.in/` | ✓ Indexed |
| `https://chemsus.in/products/calcium-levulinate.html` | ✓ Indexed |
| All other product pages | Indexing requested — expect 3–7 days |
| `shop.html`, `products.html`, `about.html`, `contact.html` | Indexing requested |

### GSC Routine Maintenance

**Weekly (first month):**
- Check Coverage for new errors
- Check if requested URLs got indexed

**Monthly (ongoing):**
- Check Performance → note which queries bring traffic
- Check Enhancements → verify no new schema errors
- Check Core Web Vitals → ensure scores stay green

**When you add a new page:**
1. Add URL to sitemap.xml + update `<lastmod>`
2. GSC → Sitemaps → Resubmit
3. GSC → URL Inspection → paste new URL → Request Indexing

---

## Bing Webmaster Tools

**Status: PENDING — most critical remaining task**

### Why Bing Matters More Than You Think

| AI System | Uses Bing |
|---|---|
| ChatGPT (browse mode) | ✓ Yes — primary source |
| Microsoft Copilot | ✓ Yes — only source |
| DuckDuckGo | ✓ Yes — powered by Bing |
| Yahoo Search | ✓ Yes — powered by Bing |

Not being on Bing means ChatGPT cannot find ChemSus when browsing.

### Setup Steps

1. Go to `bing.com/webmasters`
2. Sign in with Microsoft account (any)
3. Click "Add a site" → enter `https://chemsus.in`
4. Choose "XML file" verification → Bing gives you a file like `BingSiteAuth.xml`
5. Paste the file content here → deployed to server instantly
6. Click Verify in Bing
7. Go to Sitemaps → submit `https://chemsus.in/sitemap.xml`
8. URL Submission → manually submit all 9 key product/listing URLs

### After Bing Indexes Your Site

- ChatGPT will find ChemSus within 1–2 weeks
- Copilot will cite your product pages
- DuckDuckGo users will find your site

---

## PageSpeed & Core Web Vitals

Performance is a Google ranking factor. Scores as of 22 Apr 2026 after optimization:

| Metric | Before | After | Method |
|---|---|---|---|
| Mobile Performance | 37 | 82 | Video compress + WebP + async fonts + CSS minify |
| Desktop Performance | 53 | 92 | Same + logo resize |
| SEO | 92 | 100 | Fixed robots.txt + noindex on private pages |
| Accessibility | 96 | 100 (target) | Fixed nav label + search input contrast |
| Best Practices | 100 | 100 | — |

### What Was Optimized

**Images → WebP format**
All 19 used images converted from JPEG/PNG to WebP:
- Average reduction: 70%
- calciumm.png: 2,013KB → 71KB (−96%)
- Total payload: ~3.5MB → ~1MB

**Video → Compressed**
`vid-logo.mp4` compressed using ffmpeg (via imageio-ffmpeg):
- 1,603KB → 245KB (−85%)
- CRF 28, scale 720p, audio stripped, `+faststart` for web streaming
- Second video lazy-loaded with Intersection Observer

**Google Fonts → Async preload**
Changed from render-blocking `<link rel="stylesheet">` to:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="..." onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="..."></noscript>
```
Saves ~750ms blocking time on initial load.

**CSS → Minified**
All inline `<style>` blocks minified using `rcssmin` across 31 HTML files:
- Total saved: 149KB

**Logo → Resized**
logo.webp resized from 1,280×1,692px to 160×211px:
- 134KB → 6KB

### Remaining Unscored Warnings (Not Worth Fixing)

| Warning | Why Not Fixed |
|---|---|
| Forced reflow | In anonymous JS — would need full refactor |
| Non-composited animations | CSS animations on intro screen — cosmetic trade-off |
| DOM size | Large page with many components — structural |
| QR code cache (api.qrserver.com) | Third-party API — cannot control |

---

## Pending Setup

### 1. Bing Webmaster Tools ← Do This Next
See section above. Required for ChatGPT visibility.

### 2. Google Business Profile
- Go to `business.google.com`
- Add ChemSus as a business
- Add both addresses: Guwahati (Assam) + Visakhapatnam (AP)
- Verify address (Google sends a postcard or calls)
- Benefit: appears in Google Maps, right-side knowledge panel in search

### 3. IndiaMART / TradeIndia Listing
- Create free seller account on `indiamart.com`
- List all 7 products with descriptions, CAS numbers, website link
- These listings rank highly in Google for "chemical supplier India"
- Creates a backlink to chemsus.in → improves Google authority

### 4. External Backlinks
Google ranks newer sites low because they have no authority. Backlinks from trusted sites raise your rank. Targets:
- Collaborator websites → ask to link to chemsus.in
- ResearchGate → publish a paper or project page citing ChemSus
- Wikipedia → "Levulinic acid" article sources section
- Industry directories → chemical-specific databases

---

## How to Update SEO When Adding a New Product

Example: adding `Gamma-Valerolactone (GVL)`.

**Step 1 — Create product page**
Copy `products/levulinic-acid.html` → `products/gvl.html`

Update in `<head>`:
- `<title>Buy Gamma-Valerolactone GVL (CAS 108-29-2) | ChemSus Technologies — India</title>`
- `<meta name="description">` — new description
- `<link rel="canonical" href="https://chemsus.in/products/gvl.html">`
- All `og:` and `twitter:` tags with new values

Update Product schema:
- `name`, `alternateName`, `description`, `image`
- `additionalProperty` array — CAS 108-29-2, C5H8O2, 100.12 g/mol, 5-methyloxolan-2-one
- `BreadcrumbList` position 3 → name: "Gamma-Valerolactone", item: gvl.html
- `FAQPage` → write 4 relevant Q&As

**Step 2 — Update sitemap.xml**
```xml
<url>
  <loc>https://chemsus.in/products/gvl.html</loc>
  <lastmod>YYYY-MM-DD</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.9</priority>
</url>
```

**Step 3 — Update llms.txt**
```
### Gamma-Valerolactone / GVL (CAS 108-29-2)
- Molecular Formula: C5H8O2 | MW: 100.12 g/mol
- IUPAC: 5-methyloxolan-2-one
- Uses: green solvent, fuel additive, polymer precursor, food flavouring
- Page: https://chemsus.in/products/gvl.html
```

**Step 4 — Update homepage schema**
In `index.html`, add to `hasOfferCatalog.itemListElement`:
```json
{ "@type": "Offer", "itemOffered": { "name": "Gamma-Valerolactone (GVL)", "url": "https://chemsus.in/products/gvl.html" } }
```

**Step 5 — GSC + Bing**
- GSC → URL Inspection → `https://chemsus.in/products/gvl.html` → Request Indexing
- GSC → Sitemaps → Resubmit
- Bing Webmaster → URL Submission → submit new URL

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| "Product snippets: invalid items" | `offers` block missing `price` | Remove `offers` from Product schema — B2B sites don't list prices |
| "Discovered – currently not indexed" | Google found page but not crawled yet | Request Indexing in GSC, wait 2–5 days |
| "Crawled – currently not indexed" | Google crawled but chose not to index | Check content quality — page may be too thin or duplicate |
| robots.txt validation error | Non-standard directive in robots.txt | Only use standard directives — no `LLMs:` line |
| Page not in sitemap | Forgot to add new page | Add `<url>` to sitemap.xml, resubmit in GSC |
| Wrong canonical in search | Canonical URL mismatch | Check `<link rel="canonical">` matches exact page URL |
| Private page in Google | Missing noindex tag | Add `<meta name="robots" content="noindex, nofollow">` |
| GSC verification lost | Verification file deleted | Restore `google39aca1545b862e69.html` — never delete |
| ChatGPT can't find site | Not indexed on Bing | Set up Bing Webmaster Tools + submit sitemap |
| AI cites wrong info | llms.txt outdated | Update llms.txt when products or contact info changes |
| Low contrast accessibility fail | rgba opacity too low on colored backgrounds | Use solid color (`#fff`) not rgba for text on colored sidebars |
