/**
 * The House Visual Bible (decision 252): the fixed layer of visual direction
 * every shot brief follows. The human-editable source of truth is
 * `direction-craft.md` beside this file; this constant is what ships, because
 * a runtime file read does not survive every bundler this package runs under
 * (Next server build, Inngest, vitest). A unit test holds the two identical
 * (the decision 216 pattern), so editing the markdown without re-embedding it
 * fails CI instead of silently shipping the stale prompt.
 */
export const DIRECTION_CRAFT = `# Direction craft: how the film looks

These rules shape the director's book and every shot brief. They sit BELOW
the hard rules: nothing here ever licenses an image the claim list does not
support, and the legal hedges are never sacrificed for a stronger picture.
A beautiful frame that implies a fact the claims do not hold is worse than a
plain one.

## The house look

- Register: the Netflix money documentary. Dark, patient, photographic
  realism. The people, in the rooms where it happened: principals at the
  table, in the corridor, at the podium, re-created with a reconstruction's
  restraint. Empty rooms, documents and objects are punctuation between
  them, not the film.
- Restraint over spectacle. The story is the drama; the picture holds still
  and lets it land. One idea per frame.
- Light carries the mood. Faces are allowed, and where the cast is
  photographed they are wanted, lit by the scene's own sources. Practical
  sources the viewer can see: a desk lamp, a monitor, a window at dusk,
  sodium street light, fluorescent tubes. Name the source, its direction and
  its quality in every prompt.
- Grade and grain come from the Brand Kit anchors appended to every still
  prompt. Do not restate a grade in your own words; use the anchors.
- Era is a lock, not a flavour. Period-correct objects are named
  specifically: CRT monitors, a fax machine, a flip phone, paper ledgers.
  Never write "old fashioned"; write the object.

## Shot grammar for a film made of stills

- The sentence decides the frame. Read the narration the slot covers
  before anything else and show what it names: the place, the object, the
  event, the document, the person doing what the sentence says they did.
  A viewer with the sound off should be able to guess the sentence from
  the frame. A sentence that names a person or a place shows that person
  or that place.
- An abstract sentence is staged, not symbolised. Pressure, doubt, a
  disagreement, a judgment: show the people it concerns, in the place it
  happened. "Financial pressure on the business and disagreements inside
  the boardroom" is the principals at the boardroom table, mid-argument,
  never an object standing in for them. Only a sentence with no person and
  no place in it reaches for the director's book, and then for the
  chapter's location first and a motif last.
- Shot sizes, and what each is for:
  wide (a place and the scale of what happened there),
  medium (a person in a situation, or a room's purpose),
  close (one object or gesture that carries the beat),
  macro (texture, ink, a signature, a screen pixel),
  aerial (geography, distance, the size of an estate or a city),
  graphic (charts and maps, which are their own family).
- Every slot does at least one job: changes the emotion, advances the
  story, or raises the pressure. A slot that does none is filler; cut it or
  merge its seconds into its neighbour.
- No three adjacent slots at the same size. Alternate distance the way an
  editor would: wide, close, medium, macro.
- A paragraph that cites a number wants a chart AT the number, not after
  it. Charts and maps carry facts better than another photograph.
- Stills and stock alternate; they do not cluster. Two AI stills in a row
  is the ceiling.
- Inside a paragraph the rhythm steps down towards the beat that matters:
  long, shorter, shorter, a pause, impact. The pause before the impact
  matters more than the speed before it.
- Every chapter builds to one image, named in the director's book. Plan
  the chapter so that image lands on the chapter's turn.
- Motifs are optional punctuation. The director's book names three; use
  one only where its sentence has room for it, and
  each motif at most once per chapter. Never in two adjacent slots,
  and never as the subject of the frame unless the sentence is about
  it. A chapter with no motif in it is a chapter whose sentences were all
  about something; that is the goal, not a gap.
- A set is a room the film returns to, and the producer holds
  photographs of it and a room inventory, one line per wall.
  The plates and the room inventory are the room; the camera is the brief's.
  Name the set on a brief when the sentence puts us in that room, and write
  what happens inside it: the people, what they are doing, the light. Name
  the room in the prompt itself, in the same words the set list uses. Never
  describe its walls, furniture or materials again; the inventory states them.
  Every still in a set is a new photograph from its own camera.
  Place it by where it stands, how high, which way it faces and the lens, never by an angle name.
  Across a chapter the camera moves around the room the way a crew's would.
  Two stills of the same room never share a camera position. A set named
  on a shot that happens somewhere else is worse than no set at all.
  A room on every slot is a motif on every slot, and that mistake has
  been made once already.

## What a still prompt must contain

- One photographable moment. Not a montage, not a concept, not "the fall
  of a company". A room, a time of day, a light source, an object.
- Three physical facts in every prompt: an environmental pressure
  (rain on the window, a flickering tube, dust in a beam of light), a
  human trace (a coat on a chair, a half-drunk coffee, a hand on a
  document, a figure at a doorway), and
  one detail drawn from the sentence itself (the named object,
  document, place or time of day).
  On a shot that names a set, the environmental pressure is something
  passing through the room that day and never the room itself: the light
  at the glass, the weather beyond it, a screen's glow, steam off a cup,
  one tube on its way out. Walls, furniture, layout and materials are the
  photographs' to state, and a prompt that states them as well is arguing
  with the reference it was handed.
- Written in this order, as prose, not a keyword list: subject, action or
  state, style anchors, context (place and era), lighting (source,
  direction, quality), technical (lens, distance, aspect). Lead with the
  subject; the first third of the prompt gets the most attention.
- Name the lens: 24mm for a wide that breathes, 35mm for a documentary
  medium, 50mm for a close human scale, 85mm for a portrait, 100mm macro
  for texture.
- Every photograph is written as a photograph, in the house line, before the Brand Kit anchors:
  An available-light documentary photograph, 35mm, eye level, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line.
  A lens the camera names replaces the 35mm.
- Append the director's book palette line verbatim. The era lock is a
  constraint, not a list to paste: every period object in the frame comes
  from it, and the prompt names only the objects actually in the frame.
  Never copy the era lock's list into a prompt; the image model reads a
  list of objects as a list of things to show. Add the full name and role
  of any person shown, and their identity string ONLY when no photograph
  of them exists; where one does, the photograph is the likeness and the
  identity string stays out of the prompt.
- Banned words, because they render nothing: cinematic, stunning,
  dramatic lighting, high quality, masterpiece, epic, beautiful, moody,
  professional, ultra-detailed, 8k, 4k, 3d render, cgi, octane, unreal engine, hyperrealistic, photorealistic. Banned too: an emotion named without a body. Not "a
  worried executive"; "an executive, jaw set, both hands flat on the
  desk".
- The negative prompt names things, not categories: "no smartphone, no
  flat screen, no LED strip" for a 1990s office, never "no modern
  objects".
- A real company's own marks belong in frame when the film is about that
  company: the sign above the door, the badge on a laptop lid, the lanyard
  on the desk. Name the company and let the shot hold what is really
  there. Never ask for a mark the frame must render as legible letters,
  because a generated wordmark is a wrong one and a wrong one reads as a
  forgery. The same goes for any words the viewer is meant to read: a
  document can be dense with type, but the sentence it carries is never
  the point of the frame. Titles, captions and lower thirds are
  set by the compositor, never by the image model.

## Motion the renderer can do

- The compositor renders static, and Ken Burns in or out at slow, medium
  or fast. That is the whole vocabulary.
- Never plan a pan. The compiler turns "pan" into a push-in today, so a
  pan is a broken promise on the board.
- A push-in on a document or a face; a pull-out on a place, to show its
  scale after the detail. Static for charts, maps and the chapter's key
  image, so the frame is allowed to be looked at.
- Match speed to narration: slow under long sentences, medium under the
  montage staircase, never fast on a chart.

## Per-model prompt recipes

- FLUX family (dev, schnell, pro, FLUX.2, Krea): prose in the order above;
  no negative prompt exists, so write what must be there and fold the
  avoid list into a final sentence ("Avoid: ..."); hex colours beside
  colour names; lighting has the largest effect on quality.
- Imagen 3: subject, then context, then style; lens and proximity words
  ("close-up", "35mm", "wide angle"); keep under 480 tokens; person
  generation is enabled: name the person, then the identity string, then
  posture and clothing.
- Gemini image models: same prose as FLUX, same anchors; there is no
  negative field, so the avoid list is folded in.
- Hero video (Veo 3.1 or Kling, when the flag is on), in this shape:
  format and style; the subject with its identity string; place, era,
  time of day, weather; ONE primary action with an end state ("the
  printer runs until the last page drops, then stops"); shot size, lens
  and ONE camera move or a locked camera; light source, direction and
  quality; composition; constraints. Five to eight seconds. Name the
  final frame. No dialogue, no on-screen text.

## People

- Every named public figure in the claims is shown by likeness, and the
  likeness must look like the actual person. "likeness" is the default
  depiction for every principal; the producer alone downgrades someone to
  "archival-only", never the model. "anonymous" is for people the claims
  do not name: staff, customers, unnamed investors.
- A prompt that shows a real person names them first, by full name and
  role ("Emad Mostaque, founder of Stability AI"), then gives the identity
  string: a photographic description of that person as press photographs
  of the period show them (age, hair, beard, glasses, build, dress), so the
  image model can match the real face. Never a generic "a man in his 40s"
  standing in for a named person.
- Re-created scenes are allowed and expected: a principal at a desk with
  papers, in a boardroom, in a corridor, at a podium, in a car, in an
  interview, reading a phone. The film says on screen and in its
  description that re-creations are illustrative, so a scene does not need
  to have been photographed to be shown. It needs to be consistent with
  the claims.
- The line that is never crossed is defamation or mockery. Never show a
  named person committing a specific act the claims do not establish: no
  cash changing hands, no shredder, no handcuffs, no whispered deal. No
  exaggeration of features, no ageing or deforming, no expression of
  malice, guilt or stupidity, no caricature, no costume that mocks, no
  sexual, violent or degrading context, no invented quote in the frame.
  Neutral to sombre expression, natural posture, period-correct dress.
- The mood is carried by the environment and the light, never by the
  face. A person can stand in a dark room; the room is dark, the person is
  not made sinister.
- The director's book writes one guardrail line per principal, and it
  lists only the defamation and mockery exclusions specific to that person
  ("never handling cash or signing an invented contract; never in
  handcuffs; never mocked"). It never fences a person away from ordinary
  settings such as desks, documents, boardrooms or meetings. The guardrail
  governs what the planner writes; it is never pasted into the image
  prompt. Image models read negation as suggestion, so "never in
  handcuffs" in a prompt invites handcuffs. Its concrete nouns may become
  the negative prompt ("no gavel, no handcuffs, no cash"); its sentences
  are never quoted.
- When the cast holds photographs of a person, the still is generated from
  them: the prompt names the person and says "the person in the reference
  photo", and the photos travel with the request. The prompt varies
  clothing, place, light and posture freely. It carries NO physical
  description of them at all: no age, build, height, hair, beard, glasses,
  skin or face. The photograph settles every one of those, and a written
  description can only argue with it. "Emad Mostaque, founder of Stability
  AI, the person in the reference photo, sitting at a desk" is right; adding
  "male in his 40s, short dark hair, closely cropped beard" after it is the
  mistake.
- A person is photographed in the room, never pasted onto it: seated in a
  chair or standing on the floor, at true scale for the furniture around
  them, lit by the room's own light, with whatever stands between them and
  the camera in front of them.
- Anonymous figures (depiction "anonymous") and extras (investors,
  employees, staff, a crowd) are described by role, age range, build and
  clothing, with natural, realistic faces, visible and in focus.
  Their faces resemble no real or public person, and never a named one.
  A face is never blurred, smeared, hidden or turned away as a device.
- Archival slots hold real photographs and footage the producer uploads,
  and only those. A generated likeness is never presented as a real
  photograph, and a real photograph is never planned as a "still".
- When a model refuses a likeness, the fallback is a redirect: the same
  beat without the person (the podium after the speech, the door they
  walked through, the desk as they left it) or an anonymous figure. Keep
  the sentence the slot covers; change only what is in the frame.

## Pre-flight, before answering

- Every paragraph is covered and its slots add up to its narration.
- No three adjacent slots share a shot size.
- No motif more than once in a chapter, and none where its sentence has
  no room for it. Every chapter builds to its key image. Every frame shows
  what its sentence says; a sentence that names a person or a place shows
  that person or that place.
- Every era lock is obeyed in every prompt it touches, and its list is
  never pasted into one.
- No banned word appears in any prompt.
- Every prompt showing a real person names them in full and lists them in
  "depicts" by name alone, no role after it. It carries their identity
  string only where no photograph of them exists; a photographed person's
  prompt carries no physical description of them at all.
  No guardrail text appears in any prompt.
- No guardrail or never-show line keeps a principal away from a desk, a
  document, a boardroom or a meeting; they exclude only what would defame
  or mock.
- No pan.

Shot rules adapted in part from visual-skills by Serge Shima
(github.com/smixs/visual-skills, CC BY 4.0) and DirectorSKILL (MIT).
`

/** Words the bible bans from prompts because they render nothing. Lower case. */
export const BANNED_PROMPT_WORDS = [
  'cinematic',
  'stunning',
  'dramatic lighting',
  'high quality',
  'masterpiece',
  'epic',
  'beautiful',
  'moody',
  'professional',
  'ultra-detailed',
  '8k',
  '4k',
  '3d render',
  'cgi',
  'octane',
  'unreal engine',
  'hyperrealistic',
  'photorealistic',
] as const

/**
 * The house photograph line (decision 275): what makes a generated still read
 * as a photograph and not a render. Light with a direction, real materials
 * with wear, grain. Stated once here and in the bible, and sent on every
 * plate, sheet and still prompt before the Brand Kit anchors.
 */
export const HOUSE_PHOTOGRAPH =
  'An available-light documentary photograph, 35mm, eye level, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line.'

/**
 * A prompt with every banned word removed (decision 271).
 *
 * The bible bans these because they render nothing, and a plan note used to
 * be the only consequence of one appearing: it named the word and left it in
 * the prompt the image model read. Removing it is free and certain, so a
 * banned word is now something that cannot reach the model rather than
 * something the producer is told about.
 *
 * Whole words only, ignoring case, so "unprofessional" and "moodily" survive.
 * The comma a removal orphans goes with it: "a stunning, cold room" becomes
 * "a cold room", and "cold, stunning, quiet" keeps one comma.
 */
export function stripBannedWords(
  text: string,
  banned: readonly string[] = BANNED_PROMPT_WORDS,
): string {
  let out = text
  for (const word of banned) {
    const phrase = word
      .trim()
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+')
    if (phrase.length === 0) continue
    out = out.replace(
      new RegExp(`(\\s*,\\s*)?\\b${phrase}\\b(\\s*,)?`, 'gi'),
      (_match: string, before: string | undefined, after: string | undefined) =>
        before !== undefined && after !== undefined ? ', ' : ' ',
    )
  }
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

/**
 * A still or hero brief with its prompt cleaned (decision 271); any other
 * brief, and a clean one, comes back as the same object. The description is
 * for people and is left as written.
 */
export function withoutBannedWords<T extends { type: string }>(brief: T): T {
  if (brief.type !== 'still' && brief.type !== 'hero') return brief
  const prompt = (brief as { prompt?: unknown }).prompt
  if (typeof prompt !== 'string') return brief
  const cleaned = stripBannedWords(prompt)
  return cleaned === prompt ? brief : { ...brief, prompt: cleaned }
}
