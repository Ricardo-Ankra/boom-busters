# Asking for changes to a thumbnail picture

Design, 2026-11-27. An addition to generated thumbnails and title sets
(`2026-11-24-generated-thumbnails-and-title-sets-design.md`, decision 484).
Section numbers in that document are cited as "sets 7.3".

## 1. Why

A generated picture is often nearly right: the queue is good but too long,
the sky is too bright, a sign in the background is distracting. Today the only
button is Regenerate picture, which repaints from the planner's brief with no
words from the owner and returns a different picture. The owner loses the 90%
that was right to fix the 10% that was not.

The owner asked on 2026-11-27 for "a field that allows us to request changes
to the image. So if its 90% there, and we want to make tweaks we can."

## 2. Goals

1. On a generated thumbnail, the owner writes what to change and presses one
   button. The picture comes back with that change and the rest kept, and the
   headline and mark are set on it again.
2. A change that comes back worse costs only the image price: the picture from
   before the change is kept, and one button puts it back for free.
3. A change is bought through the same budget gate and the thumbnails model
   route, as every other thumbnail picture is.

## 3. Non-goals

- Masks, brushes or regions drawn on the picture. The change is words only.
- A history of pictures. One previous picture is kept, not a stack.
- Changes to an uploaded thumbnail. An upload has no picture the app painted.
- Changes to the headline or the mark through the note. Those are the app's
  type, edited in their own fields, for free.
- A preview of the previous picture on the card. The switch is free and
  reversible, so the button is the preview.
- Shorts. Generated sets are for the full film (sets, section 4).

## 4. Anti-goals

These make the feature a failure even if it works. They are the set design's
own, applied to the note.

- A note that puts a real person into the picture who is not shown in it
  already. The note reaches the image model word for word.
- Model-painted text or a model-painted logo arriving through a note such as
  "add the bank's name on the sign".
- An image bought outside the budget gate, or a real provider called in tests.
- A change that silently destroys the picture it was meant to improve.
- A change to a thumbnail whose video is already uploading or on YouTube.

## 5. Approaches

### 5.1 How the change is made

| Approach                              | What it is                                                                                                         | Trade-off                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Edit the stored picture (chosen)**  | The current picture travels to the image model with the note and an instruction to change only what the note names | Keeps the picture. The model redraws the whole frame, so small details elsewhere can drift                       |
| Add the note to the brief and repaint | The planner's brief gains the owner's words and the picture is painted from scratch                                | Returns a different picture. That is what Regenerate picture already does, and it is the problem being solved    |
| Masked inpainting                     | The owner marks a region; only that region is repainted                                                            | Pixel-exact outside the mask. Needs a drawing surface on the card and an inpainting endpoint neither adapter has |

Both adapters can already carry the picture. Gemini takes every reference as
an inline image in one list, each preceded by a line saying what it is for.
fal routes a request with references to an edit endpoint
(`flux-pro/kontext`, `flux-2/edit`) that takes image URLs.

### 5.2 What happens to the picture that was there

| Approach                                             | What it is                                          | Trade-off                                                 |
| ---------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| **Keep it, with one button to put it back (chosen)** | The package remembers one previous picture          | One more object per package and one more column           |
| Replace it outright                                  | The old picture is deleted, as a repaint does today | A bad edit loses the picture the owner was trying to keep |

The owner chose the first on 2026-11-27 ("Go with option 1").

## 6. The design

### 6.1 What the owner sees

On a generated package that has a picture, the card gains a field and two
buttons. Every action is a visible labelled button (build spec 11.1).

```
[ the thumbnail ]
Title      [ Ueno Bank: The Collapse That Froze the Savings...   ]
Headline   [ $850m of state money                                ]
Change the picture
[ Fewer people in the queue, and a darker sky                    ]
[Change picture]  [Back to previous picture]
Change picture buys a new image. Back to previous picture is free.

[Save changes] [Make default] [Regenerate picture] [Text left] [Remove]
```

- The field is labelled "Change the picture", holds 1 to 300 characters, and
  is plain text.
- Change picture is disabled while the field is empty, while the package is
  being made, and while any other action on the card is working.
- Back to previous picture shows only when the package holds a previous
  picture. Pressing it a second time returns to the picture it replaced.
- While the change is made the card shows "Being made", as a repaint does.
  The toast says "Changing the picture". When it lands, the field is empty.
- A change whose paint fails leaves the picture and the composite as they
  were, and the card says why in the package's error line, as a failed repaint
  does.
- A change that is painted but cannot be composed leaves the new picture with
  the old composite and the error. Compose again and Back to previous picture
  both show then, and both are free. The paint is not undone: the image was
  bought, and the picture may be the one the owner wants. Change picture and
  Regenerate picture wait until then.
- The cost line is words, not a figure, matching "Regenerate picture buys a
  new image" on the same card.

### 6.2 The request

A new server action, `changeThumbnailPicture(packageId, note)`, in
`thumbnail-actions.ts`. It follows `regenerateThumbnailPicture` step for step:

1. `requireOwner`, then `loadPackage`, which derives the project and the
   record from the package and applies the editable rule. A record that is
   uploading or on YouTube is refused there, as for every other button.
2. Refused unless the package is generated and has a picture: "There is no
   picture to change. Regenerate the picture."
3. Refused while the package is in flight or a set is being planned, with the
   existing "A set is being made. Wait for it to finish."
4. Refused unless the package is `ready`, with `Compose this thumbnail again
   first. It is free.` A package that was painted but not composed still
   shows its old thumbnail, and a change then would edit a picture the owner
   has not seen and delete the one they can see. Regenerate picture is
   refused the same way when the package has a picture.
5. The note is trimmed and checked (section 6.5).
6. The row is marked `painting` at once, then the event is sent. If the send
   fails the row's state and error go back, as they do today.

The event is the existing `thumbnails/set.requested` with a new mode,
`change`, and two new fields:

- `note`: required for `change`, refused on any other mode. The note travels
  in the event, not in the row, so the package keeps no field that could go
  stale.
- `baseKey`: the package's `picture_key` when the button was pressed. Sent
  with `change` (required) and with `paint` (optional, null when the package
  has no picture yet). An event without it, sent before this field existed,
  paints as it does today.

`baseKey` is what makes a retry safe. The runner retries once, and a step
that died after its picture was stored would otherwise run again on the
picture it had just made: the change applied twice, the keys rotated twice,
and the original deleted. So the paint step, for `change` and for `paint`
alike, first compares the row's `picture_key` with the event's `baseKey`. If
they differ, the picture has already moved on: the step buys nothing and
goes straight to the compose.

In `thumbnail-set-runner`, `change` runs the same two steps as `paint`:
`paint-<packageId>` then `compose-<packageId>`, with the note and the base
key handed to the paint.

A second action, `switchThumbnailPicture(packageId)`, is section 6.4.

### 6.3 Painting the change

`paintThumbnailPicture(packageId, change?)` gains an optional change. With no
change it paints from the brief exactly as now. With one:

**What travels.**

- The current picture, as a reference of a new kind, `base`. It is sent first.
  Its label on Gemini: "the picture to edit. Keep everything in it except
  what the text asks to change." On fal its presigned URL is the first of
  `referenceUrls`.
- The portraits of the people the package depicts, within the model's
  character budget, as a repaint sends them. A redraw can lose a likeness;
  the portraits hold it.
- No film stills and no style references. The picture already carries the
  setting and the look, and every further image pulls the model away from a
  small edit.

`base` is outside the three reference budgets: exactly one is allowed, and
only on a change.

**Size.** Gemini takes its images inline and caps a request at about 20 MB.
The base always travels at full size. Portraits are added in their usual
order while the images sent total at most 12 MB before encoding; the rest
are left out, and the prompt names only the portraits that travel.

**Which models can.** Every model either adapter lists. Gemini takes the
picture as one more inline image. fal already sends any request that carries
references to an edit endpoint (`flux-2/edit` for FLUX.2, Kontext for the
rest), so a change on a fal model runs on that endpoint and at its price, as
a repaint with portraits does today. The estimate already follows it through
`referenceRoute`. No new capability check is added.

**The prompt.** A new builder, `buildThumbnailChangePrompt`, beside
`buildThumbnailPicturePrompt`. The order is fixed, because the image model
follows a prompt's opening over its trailing lines:

1. "Edit the attached picture."
2. "Change only this: <note>."
3. "Keep everything else as it is: the composition, the framing, the people,
   the light and the colour."
4. "A 16:9 photograph. The <text side> third stays plain and uncluttered,
   kept clear for a headline."
5. One guardrail line per depicted person, as the picture prompt writes them,
   and the line naming the attached portraits when any travel.
6. The style note, when the channel has one.
7. The closing lines unchanged: no recognisable real person other than those
   shown, and "No text, no letters, no logos, no watermark, no interface
   elements."

The size stays `2K` and the model stays the thumbnails route's.

**Storing it.** As a repaint: the bytes are hashed, stored under
`thumbnailPictureKey`, and the row gets the new `pictureKey` and stays
`painting` until composed. What differs is section 6.4.

The planner's brief (`picture`) is not rewritten. Regenerate picture still
paints from the brief, so it discards the changes; that is what it is for.

### 6.4 The previous picture

One new column on `thumbnail_packages`: `previous_picture_key`, text, null.

- **Every paint that replaces a picture keeps the one it replaced.** After the
  new picture is stored, `previous_picture_key` takes the old `picture_key`,
  and the object the column held before, if any, is deleted. This holds for a
  change and for Regenerate picture alike: both can come back worse, and one
  rule is simpler than two. A paint that fails changes neither key.
- **Same bytes, no rotation.** When the new key equals the old one (the model
  returned the same bytes, or a mock repaint) nothing is rotated and nothing
  is deleted. An object is deleted only when no key of the row still names
  it.
- **Back to previous picture** is `switchThumbnailPicture(packageId)`. Guards
  as in 6.2, steps 1 and 3; it is refused with "There is no previous
  picture." when the column is null. It swaps the two keys in one update,
  marks the row `painting`, and sends a `compose`. If the send fails the keys
  are swapped back with the state. It buys nothing.
- **Removal.** Every place that deletes a package's picture object also
  deletes its previous picture: `removeThumbnailPackage`,
  `replaceUnapprovedGenerated`, and any other the builder finds.
- **Mock keys** are never deleted from storage, as now.

The composite is not kept twice. Switching back composes again, which is free
and takes a few seconds.

### 6.5 Rules on the note

Checked in the action, before the row is touched, with the words the card
shows:

- Empty after trimming: "Write what to change."
- Longer than 300 characters: "A change is at most 300 characters."
- **The name rule** (sets 7.5, decision 484 (v)). The note is tested the way
  the planner's subject and framing are: a cast member named in the note who
  is not in the package's `depicts` is refused with "<name> is not shown in
  this picture. A change cannot add a person." A person removed from the cast
  is refused with "<name> was removed from the cast." The whole-name match is
  the existing `namesWholeName`, exported for this. A real person who was
  never in the cast is held back only by the prompt's closing line, as in the
  set design.

The paint checks the name rule again before it buys, so it holds whatever
sends the event.

Text in the picture is not parsed out of the note. The prompt's closing line
forbids it, and a picture that comes back with letters is what Back to
previous picture is for.

### 6.6 Cost and budget

A change is one image. It goes through `withCost` with the same estimate a
repaint uses (the reference route's price where one bills, else the model's
2K price), counting the base picture among the references sent. The ledger
row's `meta` gains `change`, the note's first 200 characters, beside the
existing `kind: 'thumbnail'` and `package`. A budget refusal reads as it does
for a repaint.

### 6.7 Data

- Migration: `thumbnail_packages.previous_picture_key text`. Generated as the
  next drizzle number at merge time; the journals of this branch and
  `origin/master` are compared first.
- `ThumbnailSetRequestedSchema`: mode `change`, field `note` (1 to 300
  characters) and field `baseKey` (string or null), with the rules in 6.2.
- `ImageReference.kind`: `base` added.
- The card's package prop gains `hasPrevious`.

No change to settings, to the brief schema, or to `publish_records`.

### 6.8 Mock mode and tests

Mock mode buys nothing and writes no object, as now. A mock paint's key is
`mock-<packageId>`; a mock change's key adds the first eight characters of
the note's SHA-256, so the previous picture differs from the new one and the
switch can be exercised.

Tests land with the code they test:

- Schemas: the event's mode, note and base key rules; the name rule on a note.
- Prompt: the fixed order, the note word for word, the closing lines.
- Adapters: `base` is sent first with its label; exactly one is allowed; on
  fal its URL is first; no real provider is called.
- Paint: a change sends base and portraits and no stills or styles; portraits
  past the size cap are left out; the previous key is kept and the older one
  deleted; a failed paint leaves both keys and the composite untouched; a
  paint whose base key no longer matches buys nothing; same bytes rotate
  nothing.
- Actions: every refusal in 6.2, 6.4 and 6.5; the state is put back when the
  send fails; the switch swaps and swaps back.
- Runner: `change` paints with the note and the base key, then composes; a
  retried paint step after the picture moved goes straight to the compose.
- Database: removal and set replacement return the previous key for deletion.
- Card: the field, the two buttons and when each shows, and both ways out on
  a package that was painted but not composed.
- e2e (mock providers): write a note, change the picture, see the package
  ready again, switch back to the previous picture.

## 7. Left to the builder

- How the note field is laid out among the card's existing controls.
- Whether the name rule is shared with `vetPlannedPackages` through one
  helper or called beside it.
- The exact wording of Gemini's `base` label, provided it says the picture is
  the one to edit and that everything unnamed is kept.

## 8. Calls made without the owner

For the owner to check while reading:

1. Regenerate picture also keeps the picture it replaces (6.4). The owner
   asked for this on a change; a repaint can come back worse too.
2. Film stills and style references do not travel on a change (6.3).
3. A note can never add a cast member who is not already shown (6.5).
4. The card shows no preview of the previous picture (section 3).
5. The note is capped at 300 characters.
6. The note is not stored on the package; only the cost ledger records it.
7. A change that was painted but could not be composed is not undone (6.1).
8. On a fal model a change runs on fal's edit endpoint at that endpoint's
   price, as a repaint with portraits already does (6.3). Production
   thumbnails are routed at Gemini, where the model does not change.
9. On Gemini, portraits past a 12 MB total are left out of a change; the
   picture being edited always travels (6.3).
10. Change picture and Regenerate picture wait for a composed thumbnail
    (6.2). Found by the whole-branch review, 2026-11-27.
