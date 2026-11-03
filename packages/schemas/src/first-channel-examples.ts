/**
 * Boom & Busters' example slots, each the exact text cut from the prompt it
 * came from (the channel bible lift). Kept apart from channels.ts because the
 * slots run long.
 */
export const FIRST_CHANNEL_EXAMPLES: Record<string, string> = {
  'script-channel-subject': 'corporate collapses, frauds and meltdowns',
  'script-elegant-variation':
    '"the\n  payments giant", "the embattled firm", "the Munich-based company"',
  'script-storyline-examples': 'the money, the credit, the courts',
  'script-subject-with-article': 'a company',
  'script-close-hedge': 'hedged where the law needs it',
  'script-opening-collapse': 'the size of the collapse',
  'script-concrete-figure': '"Thirty thousand\n  pensions", never "significant sums"',
  'script-implicit-question': '"The auditors signed. The money was not there."',
  'script-foreshadow': '"That signature would be the\n  last one EY ever gave them"',
  'script-middle-turn': 'the stakes reaching people who are not\n  investors',
  'script-legal-care':
    'Legal care is carried by the inline hedges: reportedly, according to,\n  alleged. Never narrate the caveat as a sentence of its own: no "no court\n  has found", no "that is an interpretation", no "the record shows the order\n  of events and nothing more". Once in the whole film, where a listener would\n  otherwise infer guilt, the outline\'s constraints may ask for one plain\n  sentence that nothing has been proven',
  'dossier-channel-subject': 'corporate collapses, frauds and comebacks',
  'dossier-wanted-example': 'to make every quarter look like\n  growth',
  'dossier-scene-examples':
    "A results call, a stage keynote, a board meeting, a raid,\n  a resignation, a short seller's report landing",
  'dossier-claims-focus': 'what the money did, who said what, what the numbers show over time',
  'direction-abstract-example':
    '"Financial pressure on the business and disagreements inside\n  the boardroom" is the principals at the boardroom table, mid-argument',
  'direction-subject-marks':
    "A real company's own marks belong in frame when the film is about that\n  company: the sign above the door, the badge on a laptop lid, the lanyard\n  on the desk. Name the company and let the shot hold what is really\n  there.",
  'direction-background-people': 'investors',
  'direction-identity-example': 'Emad Mostaque, founder of\n  Stability AI',
  'direction-worked-example':
    '"Emad Mostaque, founder of Stability AI, sitting at a desk" is right; adding "male in his 40s, short dark hair, closely cropped beard"',
  'direction-never-acts': 'no\n  cash changing hands, no shredder, no handcuffs, no whispered deal',
  'direction-guardrail-rule':
    'never handling cash or signing an invented contract; never in\n  handcuffs; never mocked"). It never fences a person away from ordinary\n  settings such as desks, documents, boardrooms or meetings. The guardrail\n  governs what the planner writes; it is never pasted into the image\n  prompt. Image models read negation as suggestion, so "never in\n  handcuffs" in a prompt invites handcuffs. Its concrete nouns may become\n  the negative prompt ("no gavel, no handcuffs, no cash',
  'direction-preflight-settings': 'a desk, a\n  document, a boardroom or a meeting',
  'direction-premise': 'a corporate collapse',
  'direction-motif-generic': 'any corporate collapse',
  'direction-never-show-examples':
    'fabricated documents\n  presented as real filings, generated images passed off as real\n  photographs, a figure sourced to a filing that does not exist, an invented\n  crime',
  'direction-guardrail-book':
    'specific acts the claims do not establish (handling cash, signing an\n  invented contract, handcuffs), plus caricature, malice, humiliation. It\n  never keeps them away from desks, documents, boardrooms, meetings,\n  interviews or podiums',
  'shotlist-two-units': 'a valuation in billions against a\nmargin in percent',
  'shotlist-headline-cue':
    '"the Financial Times reported", "the paper found", "when the story broke"',
  'shotlist-guardrail-negation': '"never in handcuffs" as a request for handcuffs',
  'shotlist-map-route-example': 'money flows, HQ hops',
  'direction-default-guardrail':
    'never handling cash or signing an invented contract; never in handcuffs',
  'direction-cast-settings': 'desks, documents, boardrooms or\n  meetings',
  'metadata-channel-subject': 'corporate collapses, cons and meltdowns',
  'metadata-title-mechanisms':
    'a question, a number, a timeline\n  ("Nine days"), a contradiction, a consequence',
  'metadata-description-opening': 'the company, its\n  best-known product and what happened',
  'metadata-tag-kinds': 'the\n  company, the product, the people, the events, the topic',
  'digest-channel-subject': 'corporate collapses',
  'script-read-aloud-numbers':
    '"1.9 billion euros", not "€1.9B"; "the S and P 500" is wrong, "the S&P 500"\n  is read correctly',
  'script-hedge-kind': 'legal hedges',
  'direction-era-objects': 'CRT monitors, a fax machine, a flip phone, paper ledgers',
  'direction-emotion-body':
    '"a\n  worried executive"; "an executive, jaw set, both hands flat on the\n  desk"',
  'direction-recreated-scenes':
    'a principal at a desk with\n  papers, in a boardroom, in a corridor, at a podium, in a car, in an\n  interview, reading a phone',
  'dossier-status-subject': 'the people and the money',
}
