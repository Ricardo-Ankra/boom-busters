# The owner's own brief for a thumbnail picture

Design, 2026-11-27. An addition to generated thumbnails and title sets
(`2026-11-24-generated-thumbnails-and-title-sets-design.md`, decision 484) and
to picture changes (`2026-11-27-thumbnail-picture-changes-design.md`,
decision 485). A small change: no new event mode, and one column added after
the whole-branch review (section 9).

## 1. Why

Change picture edits the stored picture and keeps the rest, which suits a
picture that is nearly right. Regenerate picture paints from scratch, but from
the planner's brief, which the owner never sees and cannot edit. When the idea
itself is wrong there is no way to say what the picture should be.

The owner asked on 2026-11-27: "what if I want to generate a completely new
image, but I get to prompt what it should generate. So if I don't like the
generated image at all I can draft my idea of what I want".

## 2. Goals

1. On a generated thumbnail the owner reads the brief the picture was painted
   from, rewrites or replaces it, and presses Regenerate picture. The picture
   that comes back is painted from the owner's words.
2. The owner's brief becomes the package's brief. Every later Regenerate
   paints from it.
3. Any person in the film's cast can be named, and is then painted from their
   portraits (owner's choice, 2026-11-27).
4. The picture still works as a thumbnail: 16:9, a clear third for the
   headline, the channel's style, no painted text.

## 3. Non-goals

- A raw prompt that reaches the model without the fixed frame around it.
- Keeping the planner's wording for a free reset. The picture it made stays
  under Back to previous picture.
- A history of briefs.
- Uploaded thumbnails and Shorts.
- Choosing which film stills or style references travel.

## 4. Anti-goals

The set design's own, applied to the owner's words.

- A real person painted without their portrait, so the model invents a face.
- A person removed from the cast painted because the brief names them.
- An image bought outside the budget gate, or a real provider called in tests.
- A brief that is saved while the picture on screen still shows the old one,
  with nothing on the card saying so.

## 5. Approaches

| Approach                                    | What it is                                                                           | Trade-off                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **One editable brief on the card (chosen)** | The planner's brief shows in fields on the card; Regenerate paints what they say     | The planner's wording is overwritten. One brief, always the one on screen                         |
| A separate one-off prompt                   | A second note field paints once from the owner's words and stores nothing            | The next Regenerate returns to the planner's idea. Two note fields that are easy to confuse       |
| The planner rewrites the owner's idea       | The owner's rough idea goes to the planner, which writes a full brief and then paints | One more model call and wait per attempt, and the model reinterprets words the owner chose to use |

The owner chose the first on 2026-11-27 ("Option 1, one editable brief on the
card").

## 6. The design

### 6.1 What the owner sees

On every generated package that is open for editing, whether or not its
picture was painted, two fields sit above Change the picture:

```
[ the thumbnail ]
Title      [ WeWork: The $47 Billion Office Lease...              ]
Headline   [ $47bn to zero                                        ]
Picture
[ Adam Neumann barefoot on a glass office floor, empty desks      ]
[ behind him                                                      ]
Framing
[ Low angle, cold morning light, he looks past the camera         ]
Will show: Adam Neumann
Regenerate picture paints what this says and buys a new image.

Change the picture
[                                                                 ]
[Change picture]  [Back to previous picture]

[Save changes] [Make default] [Regenerate picture] [Text left] [Remove]
```

- **Picture** holds the brief's `subject`, 1 to 400 characters. **Framing**
  holds its `framing`, 0 to 400 characters. Both open filled with what the
  package holds, so the owner can see why the picture came out as it did.
  These are the brief's existing limits.
- **Will show** lists the cast members the two fields name, worked out as the
  owner types by the same rule the server uses. It reads "Will show: nobody
  from the cast" when none is named. A surname alone names nobody, and this
  line is where the owner sees that before buying.
- **Regenerate picture** is the one button. With the fields untouched it does
  what it does today. With either field changed it stores the brief and
  paints from it in the same press.
- Save changes does not store the brief. A stored brief that differs from the
  picture on screen is the fourth anti-goal; the brief changes only when a
  paint is asked for.
- The toast, the "Being made" state, the failure line and Back to previous
  picture behave as for any repaint. A paint that fails leaves the old
  picture and the new brief; the fields show the new brief, and Regenerate
  tries again.

### 6.2 The request

`regenerateThumbnailPicture(packageId, brief?)` gains an optional
`{ subject, framing }`. Without it, or when both equal what the row holds
after trimming, nothing about the action changes. With a changed brief, after
the existing guards (owner, editable record, generated, not in flight, a
painted package must be `ready`):

1. Both texts are trimmed and checked against the limits. Empty subject:
   "Write what the picture shows."
2. The people are worked out (6.3). A refusal there stops the request before
   the row is touched.
3. The row is written in the same update that marks it `painting`:
   `picture.subject`, `picture.framing`, `picture.depicts` and the row's
   `depicts` take the new values, and `picture.stillSlotIds` is emptied.
   `picture.textSide` is untouched.
4. The `paint` event is sent with `baseKey`, as today. If the send fails the
   row goes back to what it held, brief included.

No new event mode and no new event field: the paint reads the brief from the
row, as it always has.

### 6.3 The people

A new pure helper in `packages/schemas`, used by the action, the paint and
the card:

- **Shown**: every cast member, not dismissed, whose full name appears as
  whole words in the subject or the framing (`namesWholeName`, as decision
  484 (v) uses it). Their names become `depicts`, at most five, in cast
  order. More than five named: "A picture shows at most 5 people from the
  cast."
- **Removed from the cast**: a dismissed name in either text is refused with
  "<name> was removed from the cast.", by the rule `changeNoteIssue` already
  applies.
- **No portrait**: a named member with no stored photograph is refused with
  "<name> has no portrait. Add one on the Cast card first." Without one the
  model invents a face.
- A real person who was never in the cast is held back only by the prompt's
  closing line, as in the set design.

The paint runs the removed-from-the-cast check on the row's brief before it
buys, for every paint, so it holds whatever sends the event and whoever was
dismissed since.

Change picture needs no change: its name rule reads the row's `depicts`,
which now holds the people the owner named.

### 6.4 The paint

`buildThumbnailPicturePrompt` is not changed. The owner's subject and framing
go where the planner's went: after the format, the subject's size and the
clear third, and before the people, the style and the closing lines.

What travels with an owner's brief: the portraits of the people shown, the
channel's style references in use, and the style note. No film stills,
because `stillSlotIds` is empty. The planner chose those stills for its own
scene, and the prompt line that goes with them tells the model to keep that
scene.

Cost, budget gate, model route, size, storage and the previous picture are
the repaint's, untouched.

### 6.5 Data

- `PictureBriefSchema`: no change. The package's `picture` already holds the
  brief.
- The card's package prop gains `subject` and `framing`. The card gains the
  cast as `{ name, hasPortrait }[]` and the dismissed names, for Will show.
- The idea label, the angle, the title, the headline and the claims of the
  package stay as planned.

### 6.6 Mock mode and tests

A mock paint's key is `mock-<packageId>` whatever the brief says, so a mock
repaint from a new brief rotates nothing. That is the existing same-bytes
rule and the e2e test asserts the brief, not a new picture.

Tests land with the code they test:

- Schemas: the helper's shown list, the five-person cap, the dismissed rule,
  the portrait rule, a surname alone naming nobody.
- Action: an unchanged brief behaves as today; a changed one writes the four
  brief values with the `painting` mark; every refusal in 6.2 and 6.3; the
  brief is put back when the send fails.
- Paint: an owner's brief sends portraits and style references and no
  stills; a brief naming a dismissed person buys nothing and fails with
  words.
- Card: the fields open filled; Will show follows the text; Regenerate sends
  the brief only when a field changed; Save changes does not send it.
- e2e (mock providers): rewrite the picture field, regenerate, see the
  package ready again with the new brief in the field after a reload.

## 7. Left to the builder

- How the two fields sit among the card's controls, and whether the hint
  line shows always or only once a field has changed.
- Whether the helper replaces the planner's own name checks in
  `firstFailure` or sits beside them.
- The decision number in `PROGRESS.md`, taken at merge from `origin/master`.
- The branch. The highlighted-word design
  (`2026-11-27-thumbnail-headline-highlight-design.md`) changes the same
  card; the second of the two to merge carries the card conflict.

## 8. Calls made without the owner

For the owner to check while reading:

1. Two fields, Picture and Framing, as the brief stores them, in place of one
   box (6.1).
2. Regenerate picture stores the brief; Save changes does not (6.1).
3. Any edit to the brief drops the planner's film stills from the paint
   (6.4). A small fix to a picture is what Change picture is for.
4. A named cast member needs a full name and a stored portrait (6.3).
5. The Will show line under the fields (6.1).
6. The planner's wording is not kept (section 3).
7. The package's idea label stays as planned, so the channel's test results
   keep counting it under that idea even when the owner's picture is a
   different kind (6.5).
8. Every paint now refuses a brief that names a person removed from the cast
   (6.3). Today only the planner's vet and the change note check this.

## 9. Found by the whole-branch review, 2026-11-27

This section overrides 6.2, 6.3 and 6.5 where they differ, and the line at
the top that says there is no migration.

**The gap.** Section 6.2 wrote the people the owner named into the row's
`depicts` when the paint was asked for, and 6.3 said Change picture needs no
change. That holds only while the picture on screen is the one painted from
the owner's brief. It is not after Back to previous picture, and not after a
paint that failed and a Compose again. In both the card showed people the
picture does not show, and a paid change would have been checked against the
wrong people, sent with the wrong portraits, and closed on a line telling the
model that the person in the picture must not appear. The altered-content
count of an approved thumbnail reads the same list.

**The rule now.** The row's `depicts` is who the stored picture shows. The
brief's own `picture.depicts` is who the next paint will show. They are the
same on a planned row and part ways when the owner rewrites the brief.

- The action writes the brief only. It no longer touches the row's `depicts`.
- The people land with the picture. `landPaintedPicture` takes who the new
  picture shows: the brief's people for a paint from the brief, the row's own
  people for a change. The people of the picture it replaces go to a new
  column, `previous_depicts`, beside `previous_picture_key`.
- Back to previous picture swaps the people with the two keys.
- A change reads the row's people for its name rule, its portraits, its
  guardrail lines and its closing line.
- A paint that fails changes nobody.

**Data.** Migration `0058_thumbnail_previous_depicts`: one column,
`thumbnail_packages.previous_depicts text[] not null default '{}'`, and a
backfill: every row that holds a previous picture takes its own `depicts` as
that picture's people. This is exact, because before 0058 nothing rewrote a
package's people after it was planned, so both of its pictures show them.
Without it, going back on such a row would have emptied the list under a
picture that still shows the person, and an approved thumbnail would have
dropped out of the altered-content count. A second review of the fix found
this.

**Left open, for the owner.**

1. The brief's text does not travel with its picture. After Back to previous
   picture, and after a failed paint and a Compose again, the Picture and
   Framing fields hold the newer brief while an earlier picture is on screen.
   The fields say what Regenerate picture will paint, as the hint under them
   states, and the Shows line is right. Keeping one brief per picture needs
   the brief to travel in the event and land with the picture.
2. The card works out a refusal it does not show: a brief naming someone
   removed from the cast reads "Will show: nobody from the cast", and a
   person with no portrait is listed. The press is refused and nothing is
   bought.
3. A rewritten brief keeps the side the planner cleared for the headline. If
   the owner has since moved the headline with Text left or Text right, the
   new picture clears the other third. A plain repaint did this before too.
4. The paint does not check again that a named person still has a portrait.
5. A name can be read across the two fields: a subject ending in a first
   name and a framing starting with the surname.
