/**
 * Saved oEmbed responses (decision 284).
 *
 * The first two are byte-for-byte what `publish.x.com/oembed` returned on
 * 2026-09-29 for two real posts (see
 * `.superpowers/sdd/2026-09-29-social-post-shots/oembed-samples.json`),
 * copied in as the parsed objects rather than a JSON string. The other
 * three are hand-written for invented accounts: a fixture naming a real
 * person would be a fabricated record sitting in the repo, which is the
 * exact thing this reader exists to prevent.
 */

export interface OembedFixture {
  url: string
  author_name: string
  author_url: string
  html: string
  width: number
  height: number | null
  type: string
  cache_age: string
  provider_name: string
  provider_url: string
  version: string
}

/** Emad Mostaque's resignation post: entities, a mention, a trailing t.co link. */
export const OEMBED_EMOSTAQUE: OembedFixture = {
  url: 'https://x.com/EMostaque/status/1771400218170519741',
  author_name: 'Emad',
  author_url: 'https://x.com/EMostaque',
  html: '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">As my notifications are RIP some notes:<br><br>1. My shares have majority of vote <a href="https://x.com/StabilityAI?ref_src=twsrc%5Etfw">@StabilityAI</a> <br>2. They have full board control<br><br>The concentration of power in AI is bad for us all<br><br>I decided to step down to fix this at Stability &amp; elsewhere<br><br>Will be sharing more soon<br><br>Exciting times <a href="https://t.co/rknp5lCWh4">https://t.co/rknp5lCWh4</a></p>&mdash; Emad (@EMostaque) <a href="https://x.com/EMostaque/status/1771400218170519741?ref_src=twsrc%5Etfw">March 23, 2024</a></blockquote>\n\n',
  width: 550,
  height: null,
  type: 'rich',
  cache_age: '3153600000',
  provider_name: 'X',
  provider_url: 'https://x.com',
  version: '1.0',
}

/** The oldest surviving post on the platform: one line, no links, 2006. */
export const OEMBED_JACK: OembedFixture = {
  url: 'https://x.com/jack/status/20',
  author_name: 'jack',
  author_url: 'https://x.com/jack',
  html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20?ref_src=twsrc%5Etfw">March 21, 2006</a></blockquote>\n\n',
  width: 550,
  height: null,
  type: 'rich',
  cache_age: '3153600000',
  provider_name: 'X',
  provider_url: 'https://x.com',
  version: '1.0',
}

/** Invented account. Five paragraphs, joined the way X joins them: <br><br>. */
export const OEMBED_LONG_POST: OembedFixture = {
  url: 'https://x.com/riverkade_dev/status/9001000000000000001',
  author_name: 'River Kade',
  author_url: 'https://x.com/riverkade_dev',
  html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Five things I learned building in public this year:<br><br>1. Ship broken over ship never<br><br>2. Nobody reads the changelog<br><br>3. The best feedback comes from people who are annoyed<br><br>4. Rewrites are a trap<br><br>5. Done beats perfect, every single time</p>&mdash; River Kade (@riverkade_dev) <a href="https://x.com/riverkade_dev/status/9001000000000000001?ref_src=twsrc%5Etfw">June 5, 2022</a></blockquote>\n\n',
  width: 550,
  height: null,
  type: 'rich',
  cache_age: '3153600000',
  provider_name: 'X',
  provider_url: 'https://x.com',
  version: '1.0',
}

/** Invented account. The whole post is a t.co link: text must come back null. */
export const OEMBED_MEDIA_ONLY: OembedFixture = {
  url: 'https://x.com/priyaosei_build/status/9001000000000000002',
  author_name: 'Priya Osei',
  author_url: 'https://x.com/priyaosei_build',
  html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr"><a href="https://t.co/abc123">https://t.co/abc123</a></p>&mdash; Priya Osei (@priyaosei_build) <a href="https://x.com/priyaosei_build/status/9001000000000000002?ref_src=twsrc%5Etfw">January 9, 2021</a></blockquote>\n\n',
  width: 550,
  height: null,
  type: 'rich',
  cache_age: '3153600000',
  provider_name: 'X',
  provider_url: 'https://x.com',
  version: '1.0',
}

/** Invented account. Ends with a bare pic.twitter.com token, no anchor. */
export const OEMBED_ENDS_WITH_PIC: OembedFixture = {
  url: 'https://x.com/theomarchetti/status/9001000000000000003',
  author_name: 'Theo Marchetti',
  author_url: 'https://x.com/theomarchetti',
  html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">New workspace setup, finally organised. pic.twitter.com/xyz</p>&mdash; Theo Marchetti (@theomarchetti) <a href="https://x.com/theomarchetti/status/9001000000000000003?ref_src=twsrc%5Etfw">August 11, 2023</a></blockquote>\n\n',
  width: 550,
  height: null,
  type: 'rich',
  cache_age: '3153600000',
  provider_name: 'X',
  provider_url: 'https://x.com',
  version: '1.0',
}
