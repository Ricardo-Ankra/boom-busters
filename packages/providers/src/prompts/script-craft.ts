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
support, and the legal hedges are never sacrificed for drama. A tease that
invents is worse than a flat script.

## Stakes before context

- Open the film at, or moments from, the point of highest consequence, then
  rewind to how it began. The viewer must feel the size of the collapse
  before being asked to learn how the machine worked.
- Everywhere in the script: say what was at risk, or what was lost, before
  explaining mechanics. Context is earned by stakes, never the other way
  round. If a paragraph explains how something worked and the viewer does
  not yet know why it matters, the paragraph is in the wrong place.
- Stakes are concrete: named people, real money, dates. "Thirty thousand
  pensions", never "significant sums".

## The question engine

- The film has ONE central question, and only the final chapter answers it.
  Every chapter serves it.
- Every chapter plants one open question of its own, early, and does not
  answer it. A chapter answers its predecessor's question, never its own.
- Questions are implicit, raised by sequencing and withheld facts, never
  asked aloud. The house style bans rhetorical questions to the audience,
  and that ban holds. "The auditors signed. The money was not there." raises
  its question without asking anything.

## Withholding

- Reveal a fact at the moment it lands hardest, not when chronology first
  reaches it. Keep the chronological spine; hold back the meaning.
- Every chapter has something it deliberately does not say, named in the
  outline. Do not leak it. Walk to its edge and stop: name the door, not
  what is behind it.
- Foreshadow only with claim-supported facts. "That signature would be the
  last one EY ever gave them" is legitimate if the claims support it;
  inventing a shadow to point at is not.
- Dramatic irony is cheap and powerful: tell the viewer a claim-supported
  fact the people in the story did not know at the time, or withhold from
  the viewer what everyone in the room already knew. The gap is the tension.

## Escalation

- Each chapter's stakes are bigger, or more personal, than the last
  chapter's. A planned chapter that does not raise the stakes is not a
  chapter; fold it into a neighbour at outline time.
- A chapter ends on a turn: a reversal, a door closing, a fact that
  destabilises what the viewer thought they knew. The final sentence should
  make the next chapter's question feel inevitable. Never end a chapter on
  resolution, summary or a moral.
`
