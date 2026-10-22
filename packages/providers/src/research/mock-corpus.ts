import type { CorpusDocument } from './corpus'

/**
 * The corpus mock mode researches from: one document for each check the
 * grounding step makes (a figure in a press release, a quote in an article,
 * a timestamped line in a transcript, a ruling on a regulator page). Every
 * text opens with "MOCK DOCUMENT" and names no real company, for the reason
 * the mock dossier says loudly that it is mock: fixture text that reads like
 * a source is a source somebody eventually cites by accident.
 *
 * The mock passes in `prompts/dossier.ts` cite these by number and quote
 * them word for word, so the order and the wording here are load-bearing.
 * The hosts differ between the article and the regulator page so a claim
 * supported by both counts as two sources.
 */
export function mockCorpusDocuments(): CorpusDocument[] {
  return [
    {
      id: 'mock-document-1',
      url: 'https://press.example.com/mockco-results',
      kind: 'press-release',
      title: 'MOCK press release: Mockco results',
      publishedAt: '2019-01-15',
      text:
        'MOCK DOCUMENT. A fixture press release written for mock mode; it describes no real ' +
        'company. Mockco Holdings announces its mock results. Revenue for 2017 was MOCK EUR ' +
        '1,200,000,000. Revenue for 2018 was MOCK EUR 2,000,000,000. The chief executive, ' +
        'Placeholder Person, said the mock growth would continue.',
      archivedUrl: null,
      httpStatus: 200,
    },
    {
      id: 'mock-document-2',
      url: 'https://news.example.org/mock-ledger',
      kind: 'reporting',
      title: 'MOCK article: The mock ledger',
      publishedAt: '2018-06-01',
      text:
        'MOCK DOCUMENT. A fixture article written for mock mode; nothing in it happened. A mock ' +
        'reporter found that the mock ledger listed cash that no bank could confirm. Placeholder ' +
        'Person told the mock reporter that there was nothing to hide. Two mock auditors ' +
        'declined to sign the accounts.',
      archivedUrl: null,
      httpStatus: 200,
    },
    {
      id: 'mock-document-3',
      url: 'https://video.example.com/watch?v=mock-documentary',
      kind: 'video',
      title: 'MOCK video: Mockco explained',
      publishedAt: '2020-03-10',
      text: [
        'MOCK DOCUMENT. A fixture transcript written for mock mode.',
        '[00:00] Welcome to a mock documentary about a company that never existed.',
        '[00:42] The mock story most videos tell is that the cash simply vanished overnight.',
        '[01:05] Placeholder Person stood on a mock stage and promised the mock growth would ' +
          'never stop.',
        '[01:30] That is the end of the mock transcript.',
      ].join('\n'),
      archivedUrl: null,
      httpStatus: 200,
    },
    {
      id: 'mock-document-4',
      url: 'https://regulator.example.net/mock-ruling',
      kind: 'regulator',
      title: 'MOCK regulator notice: Mockco',
      publishedAt: '2019-02-20',
      text:
        'MOCK DOCUMENT. A fixture regulator page written for mock mode; no regulator issued it. ' +
        "In February 2019 the mock regulator ruled that Mockco's mock ledger listed cash that " +
        'did not exist. The mock regulator fined Mockco a mock penalty.',
      archivedUrl: null,
      httpStatus: 200,
    },
  ]
}
