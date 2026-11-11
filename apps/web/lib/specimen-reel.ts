import { cardDurationMs, cardWords } from '@boom-busters/schemas'
import type { GraphicCode, GraphicCodePayload, TechniqueKey } from '@boom-busters/schemas'
import { isTitleOnlySample } from '@/lib/card-sample'
import type { ChannelExemplarView } from '@/lib/exemplar-channel-views'
import type { ExemplarView } from '@/lib/exemplar-views'

/**
 * The Brand Kit's package reel (the settings page's Live specimen): the
 * pieces of the channel's motion package in a fixed order, each drawn by the
 * channel's approved exemplar when it has one and by the house design when
 * it does not. Pure: the page hands in the views it already loads.
 */

export interface ReelPiece {
  technique: TechniqueKey
  label: string
  source: 'channel' | 'house'
  /** What the player plays; absent when the design could not be compiled. */
  payload?: GraphicCodePayload
  /** Why the piece cannot be played. */
  issue?: string
}

/** The reel's order and the words the specimen shows for each piece. */
const ORDER: readonly { technique: TechniqueKey; label: string; card: boolean }[] = [
  { technique: 'film-title', label: 'Film title', card: true },
  { technique: 'chapter-title', label: 'Chapter card', card: true },
  { technique: 'lower-third', label: 'Lower third', card: false },
  { technique: 'bar-chart', label: 'Chart', card: false },
  { technique: 'stat-counter', label: 'Counter', card: false },
]

/** The card title every card piece shows, so two palettes compare like for like. */
export const SPECIMEN_CARD_TITLE = "The Money That Wasn't There"

function payloadOf(
  code: GraphicCode,
  data: GraphicCodePayload['data'] | undefined,
  card: boolean,
): GraphicCodePayload {
  return {
    kind: 'graphic-code',
    version: code.version,
    compiled: code.compiled,
    title: code.title,
    words: card ? cardWords(SPECIMEN_CARD_TITLE) : code.words,
    durationMs: card ? cardDurationMs(SPECIMEN_CARD_TITLE) : code.durationMs,
    logos: {},
    claimIds: [],
    ...(data ? { data } : {}),
  }
}

export function specimenReel(
  house: readonly ExemplarView[],
  channel: readonly ChannelExemplarView[],
): ReelPiece[] {
  return ORDER.flatMap(({ technique, label, card }): ReelPiece[] => {
    const approved = channel.find((view) => view.technique === technique)?.approved
    // A card's channel version counts only when its sample is title only, as assembly decides.
    if (approved && (!card || isTitleOnlySample(approved.code.words))) {
      return [
        {
          technique,
          label,
          source: 'channel',
          payload: payloadOf(approved.code, approved.data, card),
        },
      ]
    }
    const view = house.find((entry) => entry.technique === technique)
    if (view?.code) {
      return [{ technique, label, source: 'house', payload: payloadOf(view.code, view.data, card) }]
    }
    if (view?.issue) return [{ technique, label, source: 'house', issue: view.issue }]
    return []
  })
}
