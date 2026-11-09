import type { ChannelExemplarRow } from '@boom-busters/db'
import { MANIFEST } from '@boom-busters/providers'
import { CRITIC_AXES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { channelExemplarViewsFrom } from './exemplar-channel-views'

const at = (iso: string) => new Date(iso)

const row = (over: Partial<ChannelExemplarRow>): ChannelExemplarRow =>
  ({
    id: 'v',
    channelId: 'c',
    technique: 'stat-counter',
    version: 1,
    status: 'draft',
    parentId: null,
    steer: null,
    plan: {
      slot: { intent: 'x', words: [] },
      concept: 'the concept',
      storyboard: ['0.0 s a'],
      mechanisms: ['drum'],
      leansOn: [],
    },
    code: {
      version: 1,
      source: 's',
      compiled: 'c',
      title: 'T',
      facts: [],
      words: [],
      durationMs: 6000,
      motion: 2,
    },
    critique: null,
    verify: null,
    pairwise: null,
    metrics: null,
    frames: null,
    derivationId: null,
    copiedFrom: null,
    costUsd: null,
    createdAt: at('2026-11-04T10:00:00.000Z'),
    updatedAt: at('2026-11-04T10:00:00.000Z'),
    approvedAt: null,
    ...over,
  }) as ChannelExemplarRow

describe('channelExemplarViewsFrom (spec 2026-11-04, section 11.4)', () => {
  it('builds one view per manifest technique with the approved, the pending draft and the versions newest first', () => {
    const critique = {
      scores: Object.fromEntries(CRITIC_AXES.map((axis) => [axis, { score: 8, line: 'fine' }])),
      defects: [],
      fixes: [],
      mechanisms: [],
      keep: true,
    }
    const views = channelExemplarViewsFrom([
      row({ id: 'v1', version: 1, status: 'retired' }),
      row({
        id: 'v2',
        version: 2,
        status: 'approved',
        approvedAt: at('2026-11-04T11:00:00.000Z'),
        critique: critique as unknown as ChannelExemplarRow['critique'],
        verify: {
          ...critique,
          priorDefects: [],
          verdict: 'ready',
        } as unknown as ChannelExemplarRow['verify'],
      }),
      row({
        id: 'v3',
        version: 3,
        parentId: 'v2',
        steer: 'slower',
        createdAt: at('2026-11-04T12:00:00.000Z'),
      }),
      row({ id: 'b1', technique: 'bar-chart', version: 1 }),
    ])
    expect(views).toHaveLength(MANIFEST.length)
    const stat = views.find((view) => view.technique === 'stat-counter')!
    expect(stat.approved?.id).toBe('v2')
    expect(stat.approved?.scores?.craft).toEqual({ score: 8, line: 'fine' })
    expect(stat.approved?.verdict).toBe('ready')
    expect(stat.approved?.approvedAt).toBe('2026-11-04T11:00:00.000Z')
    expect(stat.pendingDraft?.id).toBe('v3')
    expect(stat.pendingDraft?.steer).toBe('slower')
    expect(stat.versions.map((version) => version.id)).toEqual(['v3', 'v2', 'v1'])
    expect(stat.versions[0]?.concept).toBe('the concept')
    expect(stat.versions[0]?.mechanisms).toEqual(['drum'])
    const bar = views.find((view) => view.technique === 'bar-chart')!
    expect(bar.approved).toBeNull()
    expect(bar.pendingDraft?.id).toBe('b1')
    const empty = views.find((view) => view.technique === 'lower-third')!
    expect(empty).toEqual({
      technique: 'lower-third',
      name: null,
      description: MANIFEST.find((entry) => entry.technique === 'lower-third')!.description,
      channelOnly: false,
      steerPhrases: [],
      fromReference: null,
      approved: null,
      pendingDraft: null,
      versions: [],
    })
  })

  it("lists a channel-only technique after the catalogue with its proposal's words (spec 8.5)", () => {
    const proposal = {
      key: 'ledger-wipe',
      name: 'Ledger wipe',
      description: 'a ruled line wipes the old figure away',
      steerPhrases: ['ledger wipe'],
      mechanisms: ['persistent-actor' as const],
      slot: { durationMs: 6000, words: [{ text: 'one', atMs: 0 }], intent: 'i' },
      fromReference: 'Ledger scene',
    }
    const views = channelExemplarViewsFrom([
      row({ id: 'w1', technique: 'ledger-wipe', version: 1, status: 'approved', proposal }),
      row({
        id: 'w2',
        technique: 'ledger-wipe',
        version: 2,
        proposal: { ...proposal, description: 'the newer words' },
      }),
      row({
        id: 'a1',
        technique: 'another-move',
        version: 1,
        proposal: { ...proposal, key: 'another-move' },
      }),
    ])
    expect(views).toHaveLength(MANIFEST.length + 2)
    expect(views.slice(MANIFEST.length).map((view) => view.technique)).toEqual([
      'another-move',
      'ledger-wipe',
    ])
    const ledger = views.at(-1)!
    expect(ledger.channelOnly).toBe(true)
    expect(ledger.description).toBe('the newer words')
    expect(ledger.steerPhrases).toEqual(['ledger wipe'])
    expect(ledger.fromReference).toBe('Ledger scene')
    expect(ledger.approved?.id).toBe('w1')
    expect(ledger.pendingDraft?.id).toBe('w2')
    expect(views[0]!.channelOnly).toBe(false)
  })
})
