# VidIQ fixtures, recorded live 2026-10-29

Recorded by the controller through the VidIQ MCP connection with the owner's approval.
Balance 1,473 before, 1,443 after: 30 credits for six calls (5 each; balance is free).

Each file is the tool's text response exactly as returned, except `video_transcript.json`,
which is cut after the [1:20] line so no full transcript of another creator's video is stored
(YouTube storage limits; spec anti-goal). Its JSON shape is unchanged.

Calls:

| File | Tool | Arguments |
|---|---|---|
| balance.json | vidiq_balance | none |
| outliers.json | vidiq_outliers | keyword "business collapse documentary", limit 5, language en |
| get_videos_by_ids.json | vidiq_get_videos_by_ids | videoIds ["JH89RGzulEE", "_d1ntT462Ac"] |
| channel_videos.json | vidiq_channel_videos | channelId "@boom-busters", videoFormat long, popular true |
| video_transcript.json | vidiq_video_transcript | videoId JH89RGzulEE, language en |
| keyword_research.md | vidiq_keyword_research | keyword "wework", mode matching_terms, limit 8 |
| keyword-questions.ts | vidiq_keyword_research | keyword "wework", mode questions (hand-made, see below) |
| score_title.json | vidiq_score_title | title "How WeWork Lost $47 Billion", type long |

`keyword-questions.ts` is a hand-made stand-in in the recorded format, not a recording: no live
`questions` call was made. It copies the matching_terms table layout and column names so the same
parser reads it; its volumes are invented and only serve the mock.

Formats found (the plan assumed JSON everywhere; these override it):

- **outliers** is JSON `{ answer: <markdown>, _credits }`. The videos are inside `answer` as
  `### n. <title>` blocks with `- **Channel:** <name> · <subs> · [country ·] channelId \`UC…\``,
  `- **Performance:** <views> views · <n>x breakout · …`, `- **Details:** published <YYYY-MM-DD> …`,
  `- **Video:** videoId \`<id>\` · …`. Views are abbreviated ("66.8K", "503.5K"): parse K/M to numbers.
- **keyword_research** is plain markdown with no `_credits`: a pipe table whose cells may read `null`
  (unknown, keep as null). Credits fall back to VIDIQ_CREDIT_COST.
- **video_transcript** is JSON `{ videoId, transcription: string, language, _credits }`; the
  transcription is one string with `[m:ss]` (or `[h:mm:ss]`) markers starting each segment and
  `[music]` / `>>` noise inline. Parse markers into segments; strip `[music]` and `>>`.
- **get_videos_by_ids** is JSON `{ videos: [{ id, title, channelId, channelTitle, publishedAt,
  description, tags: string[] | null, duration, viewCount, … , outlierScore }], _credits }`.
- **channel_videos** is JSON `{ channelId, channelTitle, …, videos: [{ videoId, title, publishedAt,
  viewCount, …, vph: number | null, breakoutScore: number | null }], _credits }`. The handle
  resolved to the channel id (`UCzgd02HrspamnkL-6sW8BDQ`).
- **score_title** is JSON `{ score, _credits }`. **balance** is JSON with `totalCredits`,
  `renewableResetsAt`.
