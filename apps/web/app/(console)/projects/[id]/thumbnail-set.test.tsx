import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PublishItemModel,
  PublishRecordProp,
  ThumbnailPackageProp,
} from '@/lib/publish-review'
import { ThumbnailSet } from './thumbnail-set'

/**
 * The master's thumbnail set on the Publish card (design 2026-11-24, 7.7):
 * the packages, their buttons, the gate and the hand-off after the upload.
 */

// project-controls (for useAction) drags '../actions' in, and with it
// next-auth, which cannot load under jsdom. Same mock every screen test uses.
vi.mock('../actions', () => ({ approveGate: vi.fn(), stopProject: vi.fn() }))

const generateThumbnailSet = vi.fn()
const regenerateThumbnailPicture = vi.fn()
const saveThumbnailPackage = vi.fn()
const makeDefaultThumbnail = vi.fn()
const removeThumbnailPackageAction = vi.fn()
const approveThumbnailSet = vi.fn()
vi.mock('./thumbnail-actions', () => ({
  generateThumbnailSet: (...args: unknown[]) => generateThumbnailSet(...args),
  regenerateThumbnailPicture: (...args: unknown[]) => regenerateThumbnailPicture(...args),
  saveThumbnailPackage: (...args: unknown[]) => saveThumbnailPackage(...args),
  makeDefaultThumbnail: (...args: unknown[]) => makeDefaultThumbnail(...args),
  removeThumbnailPackageAction: (...args: unknown[]) => removeThumbnailPackageAction(...args),
  approveThumbnailSet: (...args: unknown[]) => approveThumbnailSet(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const PROJECT = '01J0000000000000000000000A'

beforeEach(() => {
  vi.clearAllMocks()
  for (const action of [
    generateThumbnailSet,
    regenerateThumbnailPicture,
    saveThumbnailPackage,
    makeDefaultThumbnail,
    removeThumbnailPackageAction,
    approveThumbnailSet,
  ]) {
    action.mockResolvedValue({ ok: true })
  }
})

afterEach(() => {
  vi.useRealTimers()
})

function pack(over: Partial<ThumbnailPackageProp> = {}): ThumbnailPackageProp {
  return {
    id: '01HQ00000000000000000000K1',
    position: 0,
    source: 'generated',
    state: 'ready',
    idea: 'person',
    angle: 'The man who signed the accounts',
    title: 'Wirecard: The Man Who Signed Off',
    headline: 'HE SIGNED',
    textSide: 'left',
    depicts: [],
    warnings: [],
    error: null,
    approved: false,
    url: 'https://r2.example/a.jpg',
    result: null,
    watchTimeShare: null,
    slotMisses: [],
    inFlight: false,
    ...over,
  }
}

function record(over: Partial<PublishRecordProp> = {}): PublishRecordProp {
  return {
    id: '01HQ00000000000000000000P1',
    status: 'draft',
    publishAtIso: null,
    youtubeVideoId: null,
    errorMessage: null,
    title: null,
    titleOptions: [],
    titleScores: {},
    titleScoreNote: '',
    titleSlotMisses: {},
    descriptionBody: null,
    bodyScriptVersion: null,
    bodyStale: false,
    chapterGlosses: {},
    hashtags: [],
    tags: [],
    searchTags: [],
    channelTags: [],
    channelTagsDropped: [],
    thumbs: [],
    packages: [pack()],
    thumbnailSetNote: '',
    testStartedAtIso: null,
    testEndedAtIso: null,
    ...over,
  }
}

function item(over: Partial<PublishItemModel> = {}): PublishItemModel {
  return {
    targetType: 'master',
    targetId: PROJECT,
    label: 'Wirecard: The 1.9 Billion Euro Lie',
    shortKind: null,
    durationMs: 900_000,
    notReadyReason: null,
    syntheticLikenesses: [],
    cohesion: null,
    thumbnailSetCostUsd: 0.45,
    studioUrl: null,
    styleReferencesLeftOut: null,
    relatedLinkChecked: null,
    record: record(),
    ...over,
  }
}

const three = () => [
  pack({ id: '01HQ00000000000000000000K1', position: 0, idea: 'person' }),
  pack({
    id: '01HQ00000000000000000000K2',
    position: 1,
    idea: 'figure',
    title: 'The 1.9 Billion Euro Hole',
    headline: 'NO CASH',
    url: 'https://r2.example/b.jpg',
  }),
  pack({
    id: '01HQ00000000000000000000K3',
    position: 2,
    idea: 'moment',
    title: 'The Day Wirecard Died',
    headline: 'IT ENDED',
    url: 'https://r2.example/c.jpg',
  }),
]

describe('ThumbnailSet', () => {
  it('shows the cost on the generate button', () => {
    render(<ThumbnailSet item={item({ thumbnailSetCostUsd: 0.45 })} busy={false} />)
    expect(screen.getByRole('button', { name: 'Generate a set · about $0.45' })).toBeEnabled()
  })

  it('says only "Generate a set" when no cost is known', () => {
    render(<ThumbnailSet item={item({ thumbnailSetCostUsd: null })} busy={false} />)
    expect(screen.getByRole('button', { name: 'Generate a set' })).toBeInTheDocument()
  })

  it('asks for a set when Generate is pressed', async () => {
    const user = userEvent.setup()
    render(<ThumbnailSet item={item()} busy={false} />)
    await user.click(screen.getByRole('button', { name: /Generate a set/ }))
    expect(generateThumbnailSet).toHaveBeenCalledWith('master', PROJECT)
  })

  it('offers Generate on a master that has no record yet', async () => {
    const user = userEvent.setup()
    render(<ThumbnailSet item={item({ record: null, thumbnailSetCostUsd: 0.45 })} busy={false} />)
    const generate = screen.getByRole('button', { name: 'Generate a set · about $0.45' })
    expect(generate).toBeEnabled()
    await user.click(generate)
    expect(generateThumbnailSet).toHaveBeenCalledWith('master', PROJECT)
  })

  it('shows each package with its idea, promise, title and headline', () => {
    render(<ThumbnailSet item={item({ record: record({ packages: three() }) })} busy={false} />)
    expect(screen.getByText('Idea: Person')).toBeInTheDocument()
    expect(screen.getByText('Idea: Figure')).toBeInTheDocument()
    expect(screen.getAllByText('Promises: The man who signed the accounts')).toHaveLength(3)
    const titles = screen.getAllByRole('textbox', { name: 'Title' })
    expect(titles.map((field) => (field as HTMLInputElement).value)).toEqual([
      'Wirecard: The Man Who Signed Off',
      'The 1.9 Billion Euro Hole',
      'The Day Wirecard Died',
    ])
    const headlines = screen.getAllByRole('textbox', { name: 'Headline' })
    expect(headlines.map((field) => (field as HTMLInputElement).value)).toEqual([
      'HE SIGNED',
      'NO CASH',
      'IT ENDED',
    ])
    expect(titles[0]).toHaveAttribute('maxlength', '100')
    expect(headlines[0]).toHaveAttribute('maxlength', '60')
  })

  it('shows the picture large and the title beneath it at 320 and 168 px on dark and light', () => {
    render(<ThumbnailSet item={item()} busy={false} />)
    expect(screen.getByRole('img', { name: 'Thumbnail 1' })).toHaveAttribute(
      'src',
      'https://r2.example/a.jpg',
    )
    for (const tone of ['dark', 'light']) {
      const ground = screen.getByTestId(`preview-${tone}`)
      const widths = [...ground.querySelectorAll('img')].map((img) => img.getAttribute('width'))
      expect(widths).toEqual(['320', '168'])
      expect(within(ground).getAllByText('Wirecard: The Man Who Signed Off')).toHaveLength(2)
    }
  })

  it('shows a placeholder tile and no previews when a package has no image URL', () => {
    render(
      <ThumbnailSet
        item={item({ record: record({ packages: [pack({ url: null })] }) })}
        busy={false}
      />,
    )
    expect(screen.getByText('PNG')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-dark')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows who a package depicts', () => {
    render(
      <ThumbnailSet
        item={item({ record: record({ packages: [pack({ depicts: ['Adam Neumann'] })] }) })}
        busy={false}
      />,
    )
    expect(screen.getByText('Shows: Adam Neumann')).toBeInTheDocument()
  })

  it('shows a warning and still allows approval', () => {
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [
              pack({
                warnings: ['The headline is 5 words.'],
                slotMisses: ['formatKeyword'],
              }),
            ],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByText('The headline is 5 words.')).toBeInTheDocument()
    expect(screen.getByText('Missing: format keyword')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve this set' })).toBeEnabled()
  })

  it('shows a failed package’s reason and a regenerate button', async () => {
    const user = userEvent.setup()
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [pack({ state: 'failed', error: 'The image model returned no picture.' })],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByText('The image model returned no picture.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Regenerate picture' }))
    expect(regenerateThumbnailPicture).toHaveBeenCalledWith('01HQ00000000000000000000K1')
  })

  it('says a stalled run did not finish, offers a regenerate and does not poll', () => {
    vi.useFakeTimers()
    render(
      <ThumbnailSet
        item={item({
          record: record({ packages: [pack({ state: 'painting', inFlight: false, url: null })] }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByText('This did not finish.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate picture' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Generate a set/ })).toBeEnabled()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('disables generate and approve while a set is being made, and refreshes every 3 seconds', () => {
    vi.useFakeTimers()
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [
              pack({ id: '01HQ00000000000000000000K1' }),
              pack({
                id: '01HQ00000000000000000000K2',
                position: 1,
                state: 'painting',
                inFlight: true,
                url: null,
              }),
            ],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByRole('button', { name: /Generate a set/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve this set' })).toBeDisabled()
    expect(refresh).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('names the title approval will replace', () => {
    const { rerender } = render(
      <ThumbnailSet item={item({ record: record({ title: 'An older title' }) })} busy={false} />,
    )
    expect(screen.getByText('This replaces the saved title "An older title".')).toBeInTheDocument()

    rerender(<ThumbnailSet item={item({ record: record({ title: null }) })} busy={false} />)
    expect(screen.queryByText(/This replaces the saved title/)).not.toBeInTheDocument()

    rerender(
      <ThumbnailSet
        item={item({ record: record({ title: 'Wirecard: The Man Who Signed Off' }) })}
        busy={false}
      />,
    )
    expect(screen.queryByText(/This replaces the saved title/)).not.toBeInTheDocument()
  })

  it('only the first package lacks a Make default button', () => {
    render(<ThumbnailSet item={item({ record: record({ packages: three() }) })} busy={false} />)
    const cards = screen.getAllByRole('article')
    expect(within(cards[0]!).getByText('Default')).toBeInTheDocument()
    expect(within(cards[0]!).queryByRole('button', { name: 'Make default' })).toBeNull()
    expect(within(cards[1]!).getByRole('button', { name: 'Make default' })).toBeInTheDocument()
    expect(within(cards[2]!).getByRole('button', { name: 'Make default' })).toBeInTheDocument()
    expect(screen.getAllByText('Default')).toHaveLength(1)
  })

  it('labels the text button with the side it moves the headline to', async () => {
    const user = userEvent.setup()
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [
              pack({ id: '01HQ00000000000000000000K1', textSide: 'left' }),
              pack({ id: '01HQ00000000000000000000K2', position: 1, textSide: 'right' }),
            ],
          }),
        })}
        busy={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Text right' }))
    expect(saveThumbnailPackage).toHaveBeenCalledWith('01HQ00000000000000000000K1', {
      textSide: 'right',
    })
    await user.click(screen.getByRole('button', { name: 'Text left' }))
    expect(saveThumbnailPackage).toHaveBeenLastCalledWith('01HQ00000000000000000000K2', {
      textSide: 'left',
    })
  })

  it('refuses a fourth: generate is disabled with the reason when three are approved', () => {
    render(
      <ThumbnailSet
        item={item({
          record: record({ packages: three().map((p) => ({ ...p, approved: true })) }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByRole('button', { name: /Generate a set/ })).toBeDisabled()
    expect(
      screen.getByText('Three thumbnails are already approved. Remove one to generate more.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve this set' })).not.toBeInTheDocument()
  })

  it('shows the last run’s sentence under the generate button', () => {
    render(
      <ThumbnailSet
        item={item({ record: record({ thumbnailSetNote: 'Planned 2 of 3. Figure: no claim.' }) })}
        busy={false}
      />,
    )
    expect(screen.getByText('Planned 2 of 3. Figure: no claim.')).toBeInTheDocument()
  })

  it('says when style references were left out', () => {
    render(
      <ThumbnailSet item={item({ styleReferencesLeftOut: 'Gemini 3 Pro Image' })} busy={false} />,
    )
    expect(
      screen.getByText('Reference thumbnails were left out: Gemini 3 Pro Image takes none.'),
    ).toBeInTheDocument()
  })

  describe('editing', () => {
    it('saves only the changed fields, by a button, never on blur', async () => {
      const user = userEvent.setup()
      render(<ThumbnailSet item={item()} busy={false} />)
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

      const headline = screen.getByRole('textbox', { name: 'Headline' })
      await user.clear(headline)
      await user.type(headline, 'HE KNEW')
      await user.tab()
      expect(saveThumbnailPackage).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'Save changes' }))
      expect(saveThumbnailPackage).toHaveBeenCalledWith('01HQ00000000000000000000K1', {
        headline: 'HE KNEW',
      })
    })

    it('a refresh does not overwrite a title being typed', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<ThumbnailSet item={item()} busy={false} />)
      const title = screen.getByRole('textbox', { name: 'Title' })
      await user.type(title, ' (typed)')

      // A refresh brings the same package again.
      rerender(<ThumbnailSet item={item()} busy={false} />)
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Wirecard: The Man Who Signed Off (typed)',
      )

      // Even when the saved title changed underneath, a dirty field keeps its text.
      rerender(
        <ThumbnailSet
          item={item({ record: record({ packages: [pack({ title: 'Saved elsewhere' })] }) })}
          busy={false}
        />,
      )
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Wirecard: The Man Who Signed Off (typed)',
      )
    })

    it('a trailing space alone does not make a field dirty', async () => {
      const user = userEvent.setup()
      render(<ThumbnailSet item={item()} busy={false} />)
      await user.type(screen.getByRole('textbox', { name: 'Title' }), ' ')
      await user.type(screen.getByRole('textbox', { name: 'Headline' }), ' ')
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    })

    it('after a save the field shows the trimmed text and Save changes is gone', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<ThumbnailSet item={item()} busy={false} />)
      await user.type(screen.getByRole('textbox', { name: 'Title' }), ' and more ')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))
      expect(saveThumbnailPackage).toHaveBeenCalledWith('01HQ00000000000000000000K1', {
        title: 'Wirecard: The Man Who Signed Off and more',
      })

      // The refresh after the save brings the trimmed text as the saved one.
      rerender(
        <ThumbnailSet
          item={item({
            record: record({
              packages: [pack({ title: 'Wirecard: The Man Who Signed Off and more' })],
            }),
          })}
          busy={false}
        />,
      )
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Wirecard: The Man Who Signed Off and more',
      )
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    })

    it('follows the saved title when the field was not touched', () => {
      const { rerender } = render(<ThumbnailSet item={item()} busy={false} />)
      rerender(
        <ThumbnailSet
          item={item({ record: record({ packages: [pack({ title: 'Saved elsewhere' })] }) })}
          busy={false}
        />,
      )
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Saved elsewhere')
    })
  })

  describe('an uploaded package', () => {
    const uploaded = () =>
      pack({
        source: 'uploaded',
        idea: null,
        angle: '',
        title: '',
        headline: '',
        approved: true,
      })

    it('has a title and an idea choice, no headline, regenerate or text button', async () => {
      const user = userEvent.setup()
      render(
        <ThumbnailSet item={item({ record: record({ packages: [uploaded()] }) })} busy={false} />,
      )
      expect(screen.queryByRole('textbox', { name: 'Headline' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Regenerate picture' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Text (left|right)$/ })).not.toBeInTheDocument()

      const idea = screen.getByRole('combobox', { name: 'Idea' })
      expect(
        within(idea)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['None', 'Person', 'Figure', 'Object', 'Moment', 'Contrast'])
      await user.selectOptions(idea, 'contrast')
      await user.type(screen.getByRole('textbox', { name: 'Title' }), 'A test title')
      await user.click(screen.getByRole('button', { name: 'Save changes' }))
      expect(saveThumbnailPackage).toHaveBeenCalledWith('01HQ00000000000000000000K1', {
        title: 'A test title',
        idea: 'contrast',
      })
    })
  })

  describe('after the upload', () => {
    const uploadedRecord = (status: PublishRecordProp['status'], packages = three()) =>
      record({
        status,
        youtubeVideoId: 'abc123',
        packages: packages.map((p) => ({ ...p, approved: true })),
      })

    it('shows the hand-off with a download and a copy per other variant', async () => {
      const user = userEvent.setup()
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      render(
        <ThumbnailSet
          item={item({
            record: uploadedRecord('scheduled'),
            studioUrl: 'https://studio.youtube.com/video/abc123/edit',
          })}
          busy={false}
        />,
      )
      expect(screen.getByText('Test & Compare in Studio')).toBeInTheDocument()
      expect(
        screen.getByText('Variant 1 is on the video. Start a test with the other two:'),
      ).toBeInTheDocument()

      const downloads = screen.getAllByRole('link', { name: 'Download thumbnail' })
      expect(downloads.map((link) => link.getAttribute('href'))).toEqual([
        'https://r2.example/b.jpg',
        'https://r2.example/c.jpg',
      ])
      expect(downloads[0]).toHaveAttribute('download')

      const copies = screen.getAllByRole('button', { name: 'Copy title' })
      expect(copies).toHaveLength(2)
      await user.click(copies[1]!)
      expect(writeText).toHaveBeenCalledWith('The Day Wirecard Died')
      expect(toast).toHaveBeenCalledWith({ title: 'Title copied' })

      const studio = screen.getByRole('link', { name: 'Open this video in Studio' })
      expect(studio).toHaveAttribute('href', 'https://studio.youtube.com/video/abc123/edit')
      expect(studio).toHaveAttribute('target', '_blank')
      expect(screen.queryByRole('button', { name: /started the test/i })).not.toBeInTheDocument()
    })

    it('freezes the packages: no generate, approve or edit buttons', () => {
      render(<ThumbnailSet item={item({ record: uploadedRecord('live') })} busy={false} />)
      expect(screen.queryByRole('button', { name: /Generate a set/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Make default' })).not.toBeInTheDocument()
    })

    it('shows no hand-off before the upload, or with fewer than two approved', () => {
      const { rerender } = render(
        <ThumbnailSet item={item({ record: uploadedRecord('draft') })} busy={false} />,
      )
      expect(screen.queryByText('Test & Compare in Studio')).not.toBeInTheDocument()
      rerender(
        <ThumbnailSet
          item={item({ record: uploadedRecord('scheduled', [pack()]) })}
          busy={false}
        />,
      )
      expect(screen.queryByText('Test & Compare in Studio')).not.toBeInTheDocument()
    })
  })

  it('approves the set', async () => {
    const user = userEvent.setup()
    render(<ThumbnailSet item={item()} busy={false} />)
    await user.click(screen.getByRole('button', { name: 'Approve this set' }))
    expect(approveThumbnailSet).toHaveBeenCalledWith('master', PROJECT)
  })

  it('does not offer to approve a set with nothing ready and unapproved', () => {
    render(
      <ThumbnailSet
        item={item({ record: record({ packages: [pack({ approved: true })] }) })}
        busy={false}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Approve this set' })).not.toBeInTheDocument()
  })
})
