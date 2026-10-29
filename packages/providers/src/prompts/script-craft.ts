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
