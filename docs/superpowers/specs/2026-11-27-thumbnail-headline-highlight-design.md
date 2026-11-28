# A highlighted word in a thumbnail's headline

Design, 2026-11-27. An addition to generated thumbnails and title sets
(`2026-11-24-generated-thumbnails-and-title-sets-design.md`, decision 484) and
to picture changes (`2026-11-27-thumbnail-picture-changes-design.md`,
decision 485).

## 1. Why

A thumbnail's headline is at most four words, and usually one of them carries
the tension: the figure, the verdict, the name. Today the headline is one plain
block in the brand's text colour, so nothing tells the eye which word that is.

The owner asked on 2026-11-27 whether a word could be highlighted by writing
it in the Change the picture field. It cannot: that note goes to the image
model, which never sees the headline and is told to paint no text. The
headline is set by the app afterwards. The owner then asked for "a similar
functionality like we do for the headline graphic where we can include the
brand color highlight behind the word to emphasize that word in the headline".
The headline graphic (decision 257) draws the brand accent behind one phrase
of its headline; the thumbnail has nothing like it.

The owner chose, the same day, to pick the word by hand on each card. The
planner picking a word for every new thumbnail was offered and left for later.

## 2. Goals

1. On a generated thumbnail the owner names a word or a short run of words
   from the headline, saves, and the thumbnail comes back with the brand
   accent colour behind those words.
2. It is free. No image is bought: only the app's type is set again, as it is
   when the headline is edited.
3. An empty field means no highlight, and the thumbnail is exactly what it is
   today.

## 3. Non-goals

- The planner choosing the highlight. Every new package starts with none.
- More than one highlighted run in a headline.
- A choice of colour or of style. The colour is the channel's accent.
- Uploaded thumbnails. An upload has no headline the app sets.
- Shorts. Generated sets are for the full film.
- Any change to the headline graphic in the film.
- Any change to what Change picture sends to the image model.

## 4. Anti-goals

These make the feature a failure even if it works.

- A highlight that moves the headline: different line breaks, a different
  type size, or letters pushed out of the frame or into the corner where
  YouTube draws the duration.
- A block that covers part of the line above or below it.
- A highlighted word that is harder to read than the plain one was.
- Part of a word highlighted because the owner typed a fragment ("bill"
  lighting up half of "BILLION").
- A stored highlight that silently stops showing after the headline is
  edited, with nothing on the card saying why.
- A paid call of any kind.

## 5. Approaches

### 5.1 Who picks the word

| Approach                        | What it is                                                              | Trade-off                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **The owner, per card (chosen)** | A Highlight field under Headline. Empty means none                      | One more field to fill when a highlight is wanted. Full control, and the smaller build      |
| The planner, owner can change   | The planner names a phrase for every package; the same field edits it   | Thumbnails arrive highlighted. Changes the look of every new set, and the planner can pick badly |

Chosen by the owner on 2026-11-27. The second approach builds on the first's
field and can follow once the look has been seen on real thumbnails.

### 5.2 What the highlight looks like

| Approach                                     | What it is                                                                         | Trade-off                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **A solid accent block, dark type (chosen)** | The accent colour fills a block behind the words; the words take a contrasting brand colour | The strongest read at phone size. The block has to be fitted to the capitals so it cannot touch the next line                     |
| The film's marker band                       | The headline graphic's look: a translucent accent band over the lower part of the letters | Matches the film exactly. Built for dark ink on paper: off-white type on amber at full strength has a contrast near 1.9, so the word gets harder to read |
| The word in the accent colour                | No block; the letters themselves turn accent                                       | Cannot disturb the layout. It is not "behind the word", and it is the weakest of the three at small sizes                         |

This is my call, not the owner's: they asked for the colour "behind the
word", and of the two ways to do that only the solid block keeps the word
readable on a dark thumbnail. With the default kit the block is amber
`#f5a524` with near-black type `#0a0a0b` on it, a contrast near 9.7.

A sketch, the headline on the left of the frame:

```
+------------------------------------------------------+
| [mark]                                               |
|                                                      |
|  THEY LOST                                           |
|  ##############            (the painted picture)     |
|  # $2 BILLION #                                      |
|  ##############                                      |
|                                                      |
+------------------------------------------------------+
   # = the accent colour, the words on it in dark type
```

### 5.3 What happens when the headline changes under a highlight

| Approach                         | What it is                                                                     | Trade-off                                                       |
| -------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Refuse the save (chosen)**     | A save whose headline no longer holds the highlight is refused, in plain words | One extra edit for the owner. Nothing is ever silently dropped  |
| Clear the highlight silently     | The headline saves and the highlight is emptied                                | No friction. The owner finds out by looking at the thumbnail    |
| Keep it and draw nothing         | The stored words stay; the thumbnail shows no block                            | Stale state that reappears if the word is ever typed back       |

My call. The card checks the pair before the save is sent, so the owner sees
the problem while typing and the refusal is the backstop.

## 6. The design

### 6.1 What is stored

`thumbnail_packages` gains one column, `highlight`: text, not null, default
`''`. Migration `0058_thumbnail_highlight` (the next free number today; the
journal on `origin/master` is compared again at merge). Existing rows and
every newly planned package hold `''`.

The planner's schema (`PlannedPackageSchema`) and prompt do not change.

### 6.2 The matching rule

One pure function in `packages/schemas/src/thumbnails.ts`, used by the save
action, the page and the card:

```ts
export const HIGHLIGHT_MAX = 60

/** The headline split around the words to highlight, or null when they are not a run of its words. */
export function headlineHighlight(
  headline: string,
  highlight: string,
): { before: string; hit: string; after: string } | null
```

- Both texts are trimmed and split on white space into words.
- An empty highlight returns null. So does an empty headline.
- The highlight matches when its words equal a run of neighbouring headline
  words. Words are compared without regard to case, because the thumbnail
  sets the headline in capitals, and without regard to punctuation at either
  end of a word, so `gone` matches `GONE.` and `2 billion` matches
  `$2 BILLION`.
- A fragment never matches: `bill` is not a word of `$2 BILLION`.
- The first run that matches is the one taken.
- `hit` is the matched words exactly as the headline writes them, punctuation
  included, joined by single spaces. `before` and `after` are the rest, each
  either empty or carrying the space that separates it from `hit`, so that
  `before + hit + after` is the headline with its white space collapsed.

### 6.3 Saving

`saveThumbnailPackage` takes `highlight?: string` in its patch.

1. The value is trimmed. Longer than `HIGHLIGHT_MAX` is refused with
   `A highlight is at most 60 characters.`
2. On an uploaded thumbnail a non-empty highlight is refused with
   `An uploaded thumbnail has no headline to highlight.`
3. The pair that would be stored is checked: the patch's headline or else the
   row's, with the patch's highlight or else the row's. When the highlight is
   not empty and `headlineHighlight` returns null, the save is refused with
   `The highlight must be words from the headline.` and nothing is written.
   This covers a headline edited out from under a stored highlight.
4. A highlight that differs from the row's is a retype, exactly as a headline
   or a text side is: refused while the package is in flight, and on a
   painted package the row is marked `painting` and a `compose` event is
   sent. No new event mode, no new runner branch.
5. When the event cannot be sent, the highlight goes back with the headline,
   the text side and the state.

Nothing else about the action changes. An approved thumbnail that is
recomposed reaches the record the way an edited headline already does.

### 6.4 Setting the type

`thumbnailDocument` takes `highlight: string`, and `composeThumbnailPackage`
passes the row's.

- `headlineHighlight` returns null: the headline's markup is byte for byte
  what it is today. A mismatch that reaches the page (a row written some
  other way) draws the plain headline and never throws.
- Otherwise the headline's inner span holds `before`, then a span with
  `data-role="highlight"` holding `hit`, then `after`, each escaped.
- The block's colour is `brand.colors.accent`.
- The type on the block is whichever of `brand.colors.background` and
  `brand.colors.textPrimary` has the higher contrast against the accent
  (`contrastRatio`, already in `page-pure.ts`). A channel with a dark accent
  therefore gets light type on it without a setting.
- A highlight of several words that wraps gets a block on each line
  (`box-decoration-break: clone`).

Two rules bind the CSS, and the plan chooses how to meet them:

1. **A highlight never moves a letter.** The headline's text boxes (position,
   size and text of every line, as `screenshotFrame` reports them) are the
   same with the highlight and without it. The block's breathing room at the
   sides comes from something that takes no space in the line, such as
   padding cancelled by an equal negative margin.
2. **A block stays on its own line.** The headline's line height is 0.95, and
   an inline background is as tall as the font's full ascent and descent, so a
   naive background overlaps the lines above and below. The block is fitted
   to the capitals: it reaches no further than the gap to the neighbouring
   lines' letters.

The type size (`headlineFontPx`) is still worked out from the whole headline.

### 6.5 Warnings

- `headlineBoxes` today returns the boxes of the first text node, which was
  the whole headline. With a highlight the headline is up to three text
  nodes, so the frame and keep-out checks would see only the words before
  the block. It must return every text box of the headline and none of the
  wordmark's. The plan picks how they are told apart.
- One new warning, raised only when a highlight is drawn and the better of
  the two type colours still has a contrast under `HEADLINE_CONTRAST_MIN`
  (4.5) against the accent: `The highlighted words do not stand out enough
  from the accent colour.`

### 6.6 The card

Under Headline on a generated package, a text field:

- Label `Highlight`, placeholder `A word from the headline`,
  `maxLength` `HIGHLIGHT_MAX`, disabled exactly when Headline is.
- It is a draft like Title and Headline, saved by the same Save button and
  sent only when it changed.
- While the typed highlight is not empty and `headlineHighlight` of the two
  typed values is null, the line `The highlight must be words from the
  headline.` shows under the field in the danger colour and Save is disabled.
- Uploaded thumbnails do not show the field.

`ThumbnailPackageProp` gains `highlight: string`.

### 6.7 Mock mode

Unchanged. A mocked compose launches no browser and lands the same mock key,
so a highlight saved in mock mode is stored and nothing is drawn.

## 7. Tests

- **Schemas:** `headlineHighlight` for a single word, a run of words, case,
  punctuation at the ends of a word, a fragment, words that are not
  neighbours, a run that occurs twice, an empty highlight, an empty headline,
  and extra white space.
- **Database:** the migration applies; a new package holds `''`;
  `updateThumbnailPackage` writes and reads the column.
- **The page (`thumbnail-document.test.ts`):** no highlight gives today's
  markup unchanged; a match gives the three parts with the accent block; the
  type colour follows the higher contrast, shown with a light accent and a
  dark one; a mismatch gives the plain headline; the hit is escaped;
  `headlineBoxes` returns the boxes of all the headline's text nodes and not
  the wordmark's; the new warning appears below 4.5 and not at or above it.
- **The action:** a highlight saves and sends one `compose`; an unchanged one
  sends nothing; a mismatch, an over-long value and an upload are refused with
  the exact words and write nothing; a headline edit that orphans the stored
  highlight is refused; a headline and a highlight changed together are
  checked as a pair; a failed send restores the highlight; in flight is
  refused.
- **The card:** the field shows on a generated package and not on an upload;
  the inline line and the disabled Save on a mismatch; Save sends only the
  changed fields.
- **e2e:** the field is on the card, and a mismatch shows its line. The suite
  runs no Inngest, so a completed recompose is not provable there.
- **Real frames, before merge:** the two CSS rules in 6.4 cannot be proved by
  a string test. A throwaway probe in `apps/web` renders, in the local
  browser and at no cost, the same headline with and without a highlight in
  three shapes: one line, a highlighted word on the middle of three lines,
  and a two-word highlight that wraps. The text boxes must be equal, and the
  owner is shown the stills before anything is merged. The probe is deleted
  after.

## 8. Left to the builder

- The CSS that meets the two rules in 6.4, and the block's exact side room
  and corner radius, within the look in 5.2.
- How `headlineBoxes` tells the headline's nodes from the wordmark's.
- Where on the card the mismatch line sits relative to the existing warnings.

## 9. Calls made here that the owner did not make

1. The look: a solid accent block with contrasting type, not the film's
   translucent marker band (5.2).
2. A save that would orphan the highlight is refused, not silently cleared
   (5.3).
3. Words match whole, without regard to case or to punctuation at their ends
   (6.2).
4. The type on the block is picked by contrast from two brand colours, with a
   warning when neither is enough (6.4, 6.5).
5. Stills from a local render are shown to the owner before the merge (7).
