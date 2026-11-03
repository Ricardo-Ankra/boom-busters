import { describe, expect, it } from 'vitest'
import {
  channelTagsWithin,
  fillTitleTemplate,
  missingTitleSlots,
  runtimeWords,
  topicForTitle,
  type TitleSlotValues,
} from './channel-publish'

const values: TitleSlotValues = {
  topic: 'Cleopatra',
  formatKeyword: 'History for Sleep',
  pillar: null,
  runtime: '2 Hours',
}

describe('channelTagsWithin', () => {
  it('keeps tags in order until the joined length would pass the limit', () => {
    const tags = ['history for sleep', 'sleep stories', 'calm history']
    expect(channelTagsWithin(tags, 32)).toEqual({
      kept: ['history for sleep', 'sleep stories'],
      dropped: ['calm history'],
    })
  })
  it('keeps everything under the default limit', () => {
    expect(channelTagsWithin(['a', 'b']).dropped).toEqual([])
  })
  it('does not keep a later short tag after one was dropped', () => {
    expect(channelTagsWithin(['aaaa', 'bbbbbbbb', 'c'], 8).kept).toEqual(['aaaa'])
  })
})

describe('runtimeWords', () => {
  it('rounds down and never up', () => {
    expect(runtimeWords(95 * 60 + 59)).toBe('95 Minutes')
    expect(runtimeWords(60)).toBe('1 Minute')
    expect(runtimeWords(7200)).toBe('2 Hours')
    expect(runtimeWords(9000 + 1700)).toBe('2.5 Hours')
  })
  it('says under a minute below 60 seconds', () => {
    expect(runtimeWords(59)).toBe('Under a Minute')
  })
})

describe('topicForTitle', () => {
  const formatKeywords = ['history for sleep']
  it('uses the subject when the target already holds a format keyword or is null', () => {
    expect(
      topicForTitle({
        targetKeyword: 'cleopatra history for sleep',
        subject: 'Cleopatra',
        formatKeywords,
      }),
    ).toBe('Cleopatra')
    expect(topicForTitle({ targetKeyword: null, subject: 'Cleopatra', formatKeywords })).toBe(
      'Cleopatra',
    )
  })
  it('uses the target keyword otherwise', () => {
    expect(
      topicForTitle({
        targetKeyword: 'cleopatra documentary',
        subject: 'Cleopatra',
        formatKeywords,
      }),
    ).toBe('cleopatra documentary')
  })
})

describe('fillTitleTemplate', () => {
  const template = '{topic} | {formatKeyword} ({runtime})'
  it('fills every slot', () => {
    expect(fillTitleTemplate(template, values)).toBe('Cleopatra | History for Sleep (2 Hours)')
  })
  it('drops a null runtime with its brackets', () => {
    expect(fillTitleTemplate(template, { ...values, runtime: null })).toBe(
      'Cleopatra | History for Sleep',
    )
  })
  it('drops a null format keyword with its separator', () => {
    expect(fillTitleTemplate(template, { ...values, formatKeyword: null })).toBe(
      'Cleopatra (2 Hours)',
    )
  })
  it('handles other separators and a leading null slot', () => {
    expect(fillTitleTemplate('{topic}: {pillar}', values)).toBe('Cleopatra')
    expect(fillTitleTemplate('{topic} - {pillar}', { ...values, pillar: 'Empires' })).toBe(
      'Cleopatra - Empires',
    )
    expect(fillTitleTemplate('{pillar} | {topic}', values)).toBe('Cleopatra')
  })
  it('never leaves a brace behind', () => {
    for (const formatKeyword of [null, 'x']) {
      for (const runtime of [null, '1 Hour']) {
        for (const pillar of [null, 'p']) {
          const out = fillTitleTemplate('{pillar}: {topic} | {formatKeyword} ({runtime})', {
            topic: 't',
            formatKeyword,
            pillar,
            runtime,
          })
          expect(out).not.toContain('{')
        }
      }
    }
  })
})

describe('missingTitleSlots', () => {
  it('flags a required slot whose value is absent from the title', () => {
    expect(
      missingTitleSlots('Cleopatra: A Calm Story', ['topic', 'formatKeyword'], values),
    ).toEqual(['formatKeyword'])
  })
  it('ignores a slot with no value', () => {
    expect(
      missingTitleSlots('Cleopatra: A Calm Story', ['topic', 'formatKeyword'], {
        ...values,
        formatKeyword: null,
      }),
    ).toEqual([])
  })
  it('matches case-insensitively', () => {
    expect(
      missingTitleSlots('cleopatra | history for sleep', ['topic', 'formatKeyword'], values),
    ).toEqual([])
  })
})
