/**
 * Saved article heads, hand-written (decision 257).
 *
 * Every publisher habit the extractor has to survive, in one place. The
 * outlets are invented: a fixture naming a real paper and a real journalist
 * would be a fabricated record sitting in the repo, which is the exact thing
 * this feature exists to prevent.
 */

/** The good case: a complete NewsArticle block, and a dateModified to ignore. */
export const HEAD_JSONLD = `<!doctype html><html><head>
<title>Auditors cannot find the $1.9bn the company says it holds | The Financial Record</title>
<meta property="og:site_name" content="The Financial Record">
<meta property="og:title" content="Auditors cannot find the $1.9bn the company says it holds">
<meta property="og:description" content="Three banks say they never held the escrow accounts.">
<meta property="article:published_time" content="2023-03-14T06:02:11Z">
<meta name="author" content="E. Marsh">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"NewsArticle",
 "headline":"Auditors cannot find the $1.9 billion the company says it holds",
 "description":"Three banks told investigators they had never held the escrow accounts named in the filings.",
 "datePublished":"2023-03-14T06:02:11Z","dateModified":"2024-11-02T09:40:00Z",
 "author":[{"@type":"Person","name":"Elena Marsh"}],
 "publisher":{"@type":"Organization","name":"The Financial Record"}}
</script>
</head><body></body></html>`

/** Open Graph only, which is most of the web. */
export const HEAD_OG = `<!doctype html><html><head>
<title>Board backs chief executive as shares fall 41% - City Herald</title>
<meta property="og:site_name" content="City Herald">
<meta property="og:title" content="Board backs chief executive as shares fall 41%">
<meta property="article:published_time" content="2023-04-02">
<meta property="article:author" content="https://cityherald.example/staff/t-vieira">
<meta name="author" content="By Tom&#233;s Vieira">
</head><body></body></html>`

/** Nothing but a title, with the masthead stuck on the end of it. */
export const HEAD_TITLE_ONLY = `<!doctype html><html><head>
<title>Regulator opens inquiry into missing escrow | The Daily Ledger</title>
<meta name="application-name" content="The Daily Ledger">
<meta name="DC.date.issued" content="2023-06-02">
</head><body></body></html>`

/** Three bylines, an @graph wrapper, and an entity-encoded headline. */
export const HEAD_GRAPH = `<!doctype html><html><head>
<title>x</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"WebSite","name":"Not the article"},
 {"@type":["ReportageNewsArticle"],
  "headline":"Auditors &amp; regulators split over the &#8220;missing&#8221; accounts",
  "datePublished":"2021-09-30T11:00:00+02:00",
  "author":[{"name":"Elena Marsh"},{"name":"Tom Vieira"},{"name":"Ada Kane"}],
  "publisher":{"name":"The Financial Record"}}]}
</script>
</head><body></body></html>`

/** A modified date and no publication date: the trap. */
export const HEAD_MODIFIED_ONLY = `<!doctype html><html><head>
<title>An old story, republished | The Financial Record</title>
<meta property="og:site_name" content="The Financial Record">
<meta property="og:title" content="An old story, republished">
<script type="application/ld+json">
{"@type":"NewsArticle","headline":"An old story, republished",
 "dateModified":"2024-11-02T09:40:00Z","publisher":{"name":"The Financial Record"}}
</script>
</head><body></body></html>`

/** A consent wall: a real page, no article metadata at all. */
export const HEAD_CONSENT_WALL = `<!doctype html><html><head>
<title>Please accept cookies to continue</title>
<meta name="robots" content="noindex">
</head><body></body></html>`

/** A malformed JSON-LD block beside usable Open Graph tags. */
export const HEAD_BROKEN_JSONLD = `<!doctype html><html><head>
<title>Escrow accounts were never opened, court hears</title>
<meta property="og:site_name" content="City Herald">
<meta property="og:title" content="Escrow accounts were never opened, court hears">
<meta property="article:published_time" content="2022-01-18T08:00:00Z">
<script type="application/ld+json">{ "@type": "NewsArticle", oops }</script>
</head><body></body></html>`

/** A date no parser should accept, and one from the future. */
export const HEAD_BAD_DATES = `<!doctype html><html><head>
<title>A story with a broken date | City Herald</title>
<meta property="og:site_name" content="City Herald">
<meta property="og:title" content="A story with a broken date">
<script type="application/ld+json">
{"@type":"NewsArticle","headline":"A story with a broken date",
 "datePublished":"sometime in the spring","publisher":{"name":"City Herald"}}
</script>
</head><body></body></html>`
