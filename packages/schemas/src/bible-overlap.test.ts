import { describe, expect, test } from 'vitest'
import { overlapWords, tooCloseTo } from './bible-overlap'

describe('tooCloseTo', () => {
  test('an eight-word run is too close, seven is not', () => {
    const src = [
      { label: 'v1', text: 'Nobody at the bank asked where the money had gone that year' },
    ]
    expect(tooCloseTo('so nobody at the bank asked where the money went', src)).toEqual({
      source: 'v1',
      run: 'nobody at the bank asked where the money',
    })
    expect(tooCloseTo('nobody at the bank asked where the cash', src)).toBeNull()
  })

  test('punctuation and case do not hide a copy', () => {
    expect(
      tooCloseTo('NOBODY, at the bank — asked where the “money” had', [
        { label: 'v', text: "nobody at the bank asked where the 'money' had" },
      ]),
    ).not.toBeNull()
  })

  test('words are normalised the same way on both sides', () => {
    expect(overlapWords('It’s “Fine”, isn’t it?')).toEqual(["it's", 'fine', "isn't", 'it'])
  })

  test('a run found in an ignore text is not flagged, a different run still is', () => {
    const src = [
      {
        label: 'v',
        text: 'keep this craft sentence exactly word for word. Then a quite different eight word run follows',
      },
    ]
    const ignore = ['the craft sentence: keep this craft sentence exactly word for word']
    const craft = 'keep this craft sentence exactly word for word'
    expect(tooCloseTo(craft, src)).not.toBeNull()
    expect(tooCloseTo(craft, src, 8, ignore)).toBeNull()
    expect(tooCloseTo('then a quite different eight word run follows', src, 8, ignore)).toEqual({
      source: 'v',
      run: 'then a quite different eight word run follows',
    })
  })

  test('craft words count towards no run, even a run that runs on past them', () => {
    const src = [
      { label: 'v', text: 'keep this craft sentence exactly word for word so then more' },
    ]
    const ignore = ['keep this craft sentence exactly word for word']
    expect(tooCloseTo('keep this craft sentence exactly word for word so then', src)).not.toBeNull()
    expect(
      tooCloseTo('keep this craft sentence exactly word for word so then', src, 8, ignore),
    ).toBeNull()
  })
})
