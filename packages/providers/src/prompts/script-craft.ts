/**
 * The script-writing skill (decision 216): narrative craft the outline and
 * every chapter draft follow — stakes before context, a question engine,
 * deliberate withholding, escalation. The human-editable source of truth is
 * `script-craft.md` beside this file; this constant is what ships, because a
 * runtime file read does not survive every bundler this package runs under
 * (Next server build, Inngest, vitest). A unit test holds the two identical,
 * so editing the markdown without re-embedding it fails CI instead of
 * silently shipping the stale prompt.
 */
export const SCRIPT_CRAFT = `# Script craft: how the plot builds

These rules shape the outline and every chapter draft. They sit BELOW the
hard rules: nothing here ever licenses a fact the claim list does not
support, and the [[example:script-hedge-kind]] are never sacrificed for drama. A tease that
invents is worse than a flat script.

## Stakes before context

- Open the film at, or moments from, the point of highest consequence, then
  rewind to how it began. The viewer must feel [[example:script-opening-collapse]]
  before being asked to learn how the machine worked.
- Everywhere in the script: say what was at risk, or what was lost, before
  explaining mechanics. Context is earned by stakes, never the other way
  round. If a paragraph explains how something worked and the viewer does
  not yet know why it matters, the paragraph is in the wrong place.
- Stakes are concrete: named people, real money, dates. [[example:script-concrete-figure]].
- The cold open is a glimpse, not the chapter: a few sentences of
  consequence, most of the detail withheld. When the chronology reaches
  that moment again, one line of callback and then only new material.
  The opening is never told twice.

## One home per fact

- Every claim belongs to exactly one chapter, named in the outline. That
  chapter narrates it in full, once, with its attribution. Any other chapter
  refers to it in a few words at most: no figure, no date and no attribution
  repeated.
- The listener remembers. A person, [[example:script-subject-with-article]], a paper or a figure is
  introduced once; afterwards it gets its name and nothing else.

## The question engine

- The film has ONE central question, and only the final chapter answers it.
  Every chapter serves it.
- Every chapter plants one open question of its own, early, and does not
  answer it. A chapter answers its predecessor's question, never its own.
- Questions are implicit, raised by sequencing and withheld facts, never
  asked aloud. The house style bans rhetorical questions to the audience,
  and that ban holds. [[example:script-implicit-question]] raises
  its question without asking anything.

## Withholding

- Reveal a fact at the moment it lands hardest, not when chronology first
  reaches it. Keep the chronological spine; hold back the meaning.
- Every chapter has something it deliberately does not say, named in the
  outline. Do not leak it. Walk to its edge and stop: name the door, not
  what is behind it.
- A withheld fact is revealed in exactly one chapter, named in the outline
  as that chapter's reveal, and never revealed again.
- Foreshadow only with claim-supported facts. [[example:script-foreshadow]] is legitimate if the claims support it;
  inventing a shadow to point at is not.
- Dramatic irony is cheap and powerful: tell the viewer a claim-supported
  fact the people in the story did not know at the time, or withhold from
  the viewer what everyone in the room already knew. The gap is the tension.

## Escalation

- Each chapter's stakes are bigger, or more personal, than the last
  chapter's. A planned chapter that does not raise the stakes is not a
  chapter; fold it into a neighbour at outline time.
- The film sags in its middle. The chapter sitting at 40 to 60 per cent of the runtime
  turns hardest: a reversal, or [[example:script-middle-turn]].
- A chapter ends on a turn: a reversal, a door closing, a fact that
  destabilises what the viewer thought they knew. The final sentence should
  make the next chapter's question feel inevitable. Never end a chapter on
  resolution, summary or a moral, except the final chapter, which ends on
  the close below.

## The close

- The final chapter ends on the close, its last paragraphs, in this order:
  the central question answered in plain words as this channel's reading
  of the record, [[example:script-close-hedge]]; an echo of the opening,
  one image, number or phrase the film returns to so the loop it opened is
  closed; and the open thread, the one thing still unresolved, as the last
  line.
- The close says what the film thinks. It never re-narrates the chapters: a
  listener who has just heard them needs the meaning, not the list.

## Callbacks, not recaps

- A callback is a few words that point back and add meaning: the name the
  listener was told to hold on to, now attached to a paper. A recap
  re-narrates. Write callbacks. Never write a recap, not at the end of a
  chapter and not in its middle.
- Never open a chapter by restating the previous chapter's ending. The
  listener has just heard it. The first sentence moves the story forward.
- [[example:script-legal-care]].
`

/**
 * The calm counterpart (a telling made to relax or fall asleep to): the same
 * hard rules, with the tension mechanics swapped for settling ones. A format's
 * `intent` picks between the two; a channel cannot write its own. Source of
 * truth is `script-craft-calm.md`; a unit test holds the two identical.
 */
export const SCRIPT_CRAFT_CALM = `# Script craft: how a calm telling settles

These rules shape the outline and every chapter draft of a telling made to
relax, or to fall asleep to. They sit BELOW the hard rules: nothing here ever
licenses a fact the claim list does not support, and the [[example:script-hedge-kind]] are never
sacrificed for softness. A gentle telling that invents is worse than a plain
one. Calm is a way of telling true things, not a licence to embroider them.

## Set the scene, then stay in it

- Open by setting the scene: where and when the telling begins, and who is
  there, in plain, unhurried words. No glimpse of a later moment, no
  consequence thrown forward to hook the listener. The listener has already
  chosen to be here.
- The telling has one subject, named in the outline's "centralQuestion" as a
  plain statement of what it is about. It is a subject, not a puzzle: nothing
  is held back to be solved later.
- Stakes stay level. A chapter's "stakes" names what the chapter is about,
  not what is at risk. A chapter does not need to matter more than the last
  one. A planned chapter that repeats a neighbour is folded into it at outline
  time, but a chapter that is quieter than the last is welcome.

## One home per fact

- Every claim belongs to exactly one chapter, named in the outline. That
  chapter narrates it in full, once, with its attribution. Any other chapter
  refers to it in a few words at most: no figure, no date and no attribution
  repeated.
- The listener remembers, even half asleep. A person, [[example:script-subject-with-article]], a paper or a figure is
  introduced once; afterwards it gets its name and nothing else.

## Each chapter settles its own thread

- Every chapter takes up one thing, tells it through, and lets it rest. There
  is no planted question, no withheld fact and no reveal. "question",
  "withhold" and "reveals" in the outline are empty strings.
- Never end a chapter on a turn, a door closing or a fact that unsettles what
  the listener thought they knew. Never end one on a cliffhanger, and never
  tease what comes next. A chapter ends where its subject comes to rest: its
  last fact, said plainly, with nothing left hanging.
- Do not pose questions, aloud or by implication. Nothing in the telling
  should ask the listener to wait, wonder or brace.
- The middle needs no turn. Do not manufacture a reversal to keep the listener
  awake; keeping them awake is not the aim.

## Gentle transitions

- A chapter begins by setting down where the telling now stands: the place,
  the year or the person it moves to, in one easy sentence. It does not
  restate the previous chapter's ending, and it does not announce what is
  coming. The first sentence moves the telling forward, softly.
- Chronology carries the telling. Move from one chapter to the next by time,
  place or person, never by surprise.
- Foreshadow nothing. A telling that points ahead raises the listener's
  attention, and calm lowers it.

## The sound of a calm telling

This section overrides the style block's guidance on varying sentence length.
Calm narration is read aloud by a voice with no speed control: its pace comes
from sentence length, punctuation and pause marks, so write the pace in.

- Sentences run long and even. Let a sentence unfold over several clauses,
  joined with commas and gentle connectives, to a natural resting place. No
  stabbing fragments, no clipped run of short sentences, no abrupt shifts of
  rhythm. Still keep each sentence one the narrator can read in a single easy
  breath, and never pile claims into it.
- Prefer soft, concrete, ordinary words. Avoid urgent verbs, shock words,
  superlatives and anything that raises the pulse.
- Mark the pace with the forms the voice honours. Write [pause] between
  movements of a chapter, where one scene closes and the next opens, and
  [long pause] once at the end of a section the listener should rest in. Put
  them inside a paragraph, between or within sentences, never as a paragraph
  of their own. A paragraph is one voice take and must contain spoken words.
- Beyond the pause marks, use a full stop wherever the voice should settle
  and a comma wherever it should only slow. Break any sentence the narrator
  would have to hurry to finish.
- Keep the delivery even and low. Do not write [whispers], [sighs], [gasps]
  or any direction that raises, drops or sharpens the voice. A handful of
  [pause] marks per chapter is enough, and each one earns its place.
- Numbers and dates are written as the style block describes and never
  stacked: one figure to a sentence at most, so none has to be caught.

## The close

- The final chapter ends on the close, its last paragraphs, in this order:
  the subject drawn together in plain words as this channel's reading of the
  record, [[example:script-close-hedge]]; and an echo of the opening, one
  image, place or phrase the telling returns to so it ends where it began.
- The close leaves no open thread. "close.openThread" is an empty string and
  the last line settles: a resolved image, never a question, a hint or a
  sign of more to come.
- The close says what the telling comes to. It never re-narrates the
  chapters: a listener who has just heard them needs the meaning, not the
  list.

## Callbacks, not recaps

- A callback is a few words that point back and add meaning: a name the
  listener already holds, now met again in a new place. A recap
  re-narrates. Write callbacks. Never write a recap, not at the end of a
  chapter and not in its middle.
- [[example:script-legal-care]].
`
