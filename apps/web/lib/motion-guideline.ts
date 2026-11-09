/**
 * The reference guideline on the Motion tab (spec 2026-11-04, section 6):
 * the short form above the list, and the full text behind "Read the full
 * guideline". A typed copy of `docs/motion-references.md`; a test keeps the
 * two in step by heading.
 */

export const MOTION_GUIDELINE_SHORT: readonly string[] = [
  'Four to eight references per channel, twelve at most. Each teaches one thing: a mechanism, a look or a pacing. Have at least one of each.',
  'One idea per clip. Typography, shapes and charts, because that is what the catalogue can draw; a reference built on footage teaches nothing the designer can use.',
  'Stills: PNG, JPEG or WebP up to 8 MB. Clips: MP4, WebM or MOV up to 100 MB and 90 seconds, 1080p or better.',
  'Mark a window of one to four seconds. The model is shown the window, never the whole clip. No app chrome, captions, watermarks or logos in it.',
  'Write a title, the source and whose work it is, a rights note, one carry-over line ("borrow X, not Y") and an avoid line if anything must not be copied.',
  'The references are study material. Their pixels never enter a film.',
]

export const MOTION_GUIDELINE_FULL: readonly { heading: string; lines: readonly string[] }[] = [
  {
    heading: 'What to supply',
    lines: [
      'Four to eight references per channel; twelve at most. Each teaches one thing, and is tagged with it.',
      'Mechanism: one move. A word that splits open to show a figure. A numeral that stays while the background changes. Bars rising as years are spoken.',
      'Look: palette, type, texture, the weight and spacing of letters. Stills are good for look and useless for motion. The critic that reviews each graphic is shown the first two look references, so put the two that matter most first.',
      'Pacing: how long things hold, how fast they leave, how much is on screen at once.',
      'Have at least one of each. Up to two references may be negatives: a clip that shows what the channel must not do, with the avoid line saying what.',
    ],
  },
  {
    heading: 'What makes a good reference',
    lines: [
      'One idea per clip. Typography, shapes and charts, because that is what the catalogue can draw: our graphics have no footage, so a reference built on footage (masks, grain on a face, a presenter split) teaches nothing the designer can use.',
      'A clean background. A move the owner can describe in one sentence. Quality the channel would be proud of: the derivation copies the standard as much as the move.',
    ],
  },
  {
    heading: 'Format',
    lines: [
      'Stills: PNG, JPEG or WebP, up to 8 MB.',
      'Clips: MP4, WebM or MOV, up to 100 MB and 90 seconds. 1080p or better.',
      'The marked window is one to four seconds. The model is shown the window, never the whole clip, so the window is the reference.',
      'No app chrome, captions, watermarks or logos in the window: crop them out in the marker or choose another window.',
      'Silent is fine. Sound is not a reference here.',
    ],
  },
  {
    heading: 'What to write for each',
    lines: [
      'A title.',
      'The source link and whose work it is.',
      'A rights note: reference only, unless the owner holds a licence.',
      'One carry-over line of the form "borrow X, not Y". For example: "borrow the one numeral held over a changing background, not this numeral or story".',
      'One avoid line, if anything in the window must not be copied: "not the glow".',
    ],
  },
  {
    heading: 'How much is enough',
    lines: [
      'A window per reference and a sentence each. More than eight dilutes: the derivation weighs every reference, and twelve mixed references read as no style. Fewer than four leaves the model guessing on one of mechanism, look or pacing.',
    ],
  },
  {
    heading: 'What the tool does with them',
    lines: [
      "It reads each window into a one-page reading the owner can correct, builds the channel's motion identity from the readings and the owner's words, derives an exemplar per technique the channel uses, and shows those on the Exemplars tab for approval and steering. The references' pixels never enter a film.",
      'A reference is read only on "Save and read" or "Read", never on the upload alone, and the reading can be edited on its card.',
      '"Derive exemplars" on the Motion tab plans each technique from the readings, builds it, has the critic judge and fix it round by round under a cap you type, and stores the result as a draft version; nothing is approved for you.',
      'Each technique on the Exemplars tab shows its approved version or the house example, and "Refine" builds one new version from the approved one under a plain-words steer, shown beside it with "Approve this" and "Keep the approved one"; every version stays under "Versions" and a retired one can be restored.',
      '"Copy motion from another channel" forks that channel\'s identity, references and approved exemplars into this one.',
      '"Propose a technique from the mechanism references" in the Derive dialogue reads those references and, when they carry a move no technique covers, derives a technique of this channel\'s own that a steer phrase reaches once it is approved.',
    ],
  },
]
