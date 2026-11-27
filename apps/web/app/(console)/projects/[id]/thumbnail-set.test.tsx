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
const recomposeThumbnail = vi.fn()
const saveThumbnailPackage = vi.fn()
const makeDefaultThumbnail = vi.fn()
const removeThumbnailPackageAction = vi.fn()
const approveThumbnailSet = vi.fn()
const changeThumbnailPicture = vi.fn()
const switchThumbnailPicture = vi.fn()
const markTestStarted = vi.fn()
const recordTestResult = vi.fn()
vi.mock('./thumbnail-actions', () => ({
  markTestStarted: (...args: unknown[]) => markTestStarted(...args),
  recordTestResult: (...args: unknown[]) => recordTestResult(...args),
  generateThumbnailSet: (...args: unknown[]) => generateThumbnailSet(...args),
  regenerateThumbnailPicture: (...args: unknown[]) => regenerateThumbnailPicture(...args),
  recomposeThumbnail: (...args: unknown[]) => recomposeThumbnail(...args),
  saveThumbnailPackage: (...args: unknown[]) => saveThumbnailPackage(...args),
  makeDefaultThumbnail: (...args: unknown[]) => makeDefaultThumbnail(...args),
  removeThumbnailPackageAction: (...args: unknown[]) => removeThumbnailPackageAction(...args),
  approveThumbnailSet: (...args: unknown[]) => approveThumbnailSet(...args),
  changeThumbnailPicture: (...args: unknown[]) => changeThumbnailPicture(...args),
  switchThumbnailPicture: (...args: unknown[]) => switchThumbnailPicture(...args),
}))

const addWinnerToReferences = vi.fn()
vi.mock('@/app/(console)/c/[slug]/settings/thumbnail-reference-actions', () => ({
  addWinnerToReferences: (...args: unknown[]) => addWinnerToReferences(...args),
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
    recomposeThumbnail,
    saveThumbnailPackage,
    makeDefaultThumbnail,
    removeThumbnailPackageAction,
    approveThumbnailSet,
    changeThumbnailPicture,
    switchThumbnailPicture,
    markTestStarted,
    recordTestResult,
    addWinnerToReferences,
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
    hasImage: true,
    hasPicture: true,
    hasPrevious: false,
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
    planning: false,
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

  it("shows the previews on YouTube's dark and light page colours", () => {
    render(<ThumbnailSet item={item()} busy={false} />)
    expect(screen.getByTestId('preview-dark')).toHaveStyle({ backgroundColor: '#0f0f0f' })
    expect(screen.getByTestId('preview-light')).toHaveStyle({ backgroundColor: '#ffffff' })
    expect(screen.getByTestId('preview-dark').parentElement).toHaveClass('overflow-x-auto')
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
            packages: [
              pack({
                state: 'failed',
                error: 'The image model returned no picture.',
                hasPicture: false,
              }),
            ],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByText('The image model returned no picture.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Regenerate picture' }))
    expect(regenerateThumbnailPicture).toHaveBeenCalledWith('01HQ00000000000000000000K1')
  })

  it('shows that the set is being planned and keeps Generate disabled', () => {
    vi.useFakeTimers()
    render(
      <ThumbnailSet
        item={item({ record: record({ planning: true, packages: [] }) })}
        busy={false}
      />,
    )
    expect(screen.getByText('Planning the set.')).toBeInTheDocument()
    expect(screen.queryByText('No thumbnails stored yet.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Generate a set/ })).toBeDisabled()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('disables Approve while the set is being planned', () => {
    render(<ThumbnailSet item={item({ record: record({ planning: true }) })} busy={false} />)
    expect(screen.getByRole('button', { name: 'Approve this set' })).toBeDisabled()
  })

  it('offers a free Compose again when a picture is stored', async () => {
    const user = userEvent.setup()
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [pack({ state: 'failed', error: 'Compose failed.', hasPicture: true })],
          }),
        })}
        busy={false}
      />,
    )
    expect(
      screen.getByText('Compose again is free. Regenerate picture and Change picture wait for it.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Compose again' }))
    expect(recomposeThumbnail).toHaveBeenCalledWith('01HQ00000000000000000000K1')
    expect(regenerateThumbnailPicture).not.toHaveBeenCalled()
  })

  it('offers Compose again for a run that died after the picture was stored', () => {
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [pack({ state: 'painting', inFlight: false, url: null, hasPicture: true })],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByRole('button', { name: 'Compose again' })).toBeEnabled()
  })

  it('offers only Regenerate when there is no picture', () => {
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [pack({ state: 'failed', error: 'No picture.', hasPicture: false })],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByRole('button', { name: 'Regenerate picture' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compose again' })).toBeNull()
    expect(screen.queryByText(/Compose again is free/)).toBeNull()
  })

  it('does not offer Compose again on a ready package', () => {
    render(<ThumbnailSet item={item()} busy={false} />)
    expect(screen.queryByRole('button', { name: 'Compose again' })).toBeNull()
  })

  it('says a stalled run did not finish, offers a regenerate and does not poll', () => {
    vi.useFakeTimers()
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [pack({ state: 'painting', inFlight: false, url: null, hasPicture: false })],
          }),
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

  it('a failed first package is not tagged Default', () => {
    const [first, second, third] = three()
    render(
      <ThumbnailSet
        item={item({
          record: record({
            packages: [
              { ...first!, state: 'failed', hasImage: false, url: null, error: 'It failed.' },
              second!,
              third!,
            ],
          }),
        })}
        busy={false}
      />,
    )
    const cards = screen.getAllByRole('article')
    expect(within(cards[0]!).queryByText('Default')).toBeNull()
    expect(within(cards[0]!).queryByRole('button', { name: 'Make default' })).toBeNull()
    expect(within(cards[1]!).getByText('Default')).toBeInTheDocument()
    expect(within(cards[1]!).queryByRole('button', { name: 'Make default' })).toBeNull()
    expect(within(cards[2]!).getByRole('button', { name: 'Make default' })).toBeInTheDocument()
    expect(screen.getAllByText('Default')).toHaveLength(1)
  })

  it('the replaces note names the title that will go up', () => {
    const [first, second] = three()
    render(
      <ThumbnailSet
        item={item({
          record: record({
            title: 'An older title',
            packages: [{ ...first!, state: 'failed', hasImage: false, url: null }, second!],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByText('This replaces the saved title "An older title".')).toBeInTheDocument()
  })

  it('the replaces note is judged on the package that will go up, not on position 0', () => {
    const [first, second] = three()
    // The saved title is the failed first package's: Approve will put the second one up.
    const { rerender } = render(
      <ThumbnailSet
        item={item({
          record: record({
            title: first!.title,
            packages: [{ ...first!, state: 'failed', hasImage: false, url: null }, second!],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.getByText(/This replaces the saved title/)).toBeInTheDocument()
    // The saved title is already the one that will go up: nothing is replaced.
    rerender(
      <ThumbnailSet
        item={item({
          record: record({
            title: second!.title,
            packages: [{ ...first!, state: 'failed', hasImage: false, url: null }, second!],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.queryByText(/This replaces the saved title/)).not.toBeInTheDocument()
  })

  it('no replaces note when the default is already approved', () => {
    const [first, second, third] = three()
    // Approve changes nothing when the package that goes up is already the default.
    render(
      <ThumbnailSet
        item={item({
          record: record({
            title: 'A hand-edited title',
            packages: [{ ...first!, approved: true }, second!, third!],
          }),
        })}
        busy={false}
      />,
    )
    expect(screen.queryByText(/This replaces the saved title/)).not.toBeInTheDocument()
  })

  it('on an uploaded record the Default tag is on the approved package', () => {
    const [first, second] = three()
    render(
      <ThumbnailSet
        item={item({
          record: record({
            status: 'scheduled',
            packages: [first!, { ...second!, approved: true }],
          }),
        })}
        busy={false}
      />,
    )
    const cards = screen.getAllByRole('article')
    expect(within(cards[0]!).queryByText('Default')).toBeNull()
    expect(within(cards[1]!).getByText('Default')).toBeInTheDocument()
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

  describe('a change of picture', () => {
    const one = (over: Partial<ThumbnailPackageProp> = {}, rec: Partial<PublishRecordProp> = {}) =>
      item({ record: record({ packages: [pack(over)], ...rec }) })
    const ID = '01HQ00000000000000000000K1'
    const HINT = 'Change picture buys a new image. Back to previous picture is free.'

    it('a generated package with a picture offers a change', async () => {
      const user = userEvent.setup()
      render(<ThumbnailSet item={one()} busy={false} />)
      const field = screen.getByRole('textbox', { name: 'Change the picture' })
      expect(field).toHaveAttribute('maxlength', '300')
      expect(screen.getByText(HINT)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Change picture' })).toBeDisabled()
      await user.type(field, 'darker sky')
      const button = screen.getByRole('button', { name: 'Change picture' })
      expect(button).toBeEnabled()
      await user.click(button)
      expect(changeThumbnailPicture).toHaveBeenCalledWith(ID, 'darker sky')
    })

    it('a note of spaces alone does not enable the change', async () => {
      const user = userEvent.setup()
      render(<ThumbnailSet item={one()} busy={false} />)
      await user.type(screen.getByRole('textbox', { name: 'Change the picture' }), '   ')
      expect(screen.getByRole('button', { name: 'Change picture' })).toBeDisabled()
    })

    it('the note empties when the change is requested', async () => {
      const user = userEvent.setup()
      render(<ThumbnailSet item={one()} busy={false} />)
      const field = screen.getByRole('textbox', { name: 'Change the picture' })
      await user.type(field, 'darker sky')
      await user.click(screen.getByRole('button', { name: 'Change picture' }))
      await vi.waitFor(() => expect(field).toHaveValue(''))
      expect(toast).toHaveBeenCalledWith({ title: 'Changing the picture' })
    })

    it('the note stays when the change is refused', async () => {
      const user = userEvent.setup()
      changeThumbnailPicture.mockResolvedValue({ ok: false, error: 'No budget left.' })
      render(<ThumbnailSet item={one()} busy={false} />)
      const field = screen.getByRole('textbox', { name: 'Change the picture' })
      await user.type(field, 'darker sky')
      await user.click(screen.getByRole('button', { name: 'Change picture' }))
      await vi.waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ description: 'No budget left.', variant: 'error' }),
        ),
      )
      expect(field).toHaveValue('darker sky')
    })

    it('has no change field without a stored picture', () => {
      render(<ThumbnailSet item={one({ hasPicture: false })} busy={false} />)
      expect(screen.queryByRole('textbox', { name: 'Change the picture' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Change picture' })).toBeNull()
      expect(screen.queryByText(HINT)).toBeNull()
    })

    it('back to previous shows only with a previous picture', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<ThumbnailSet item={one()} busy={false} />)
      expect(screen.queryByRole('button', { name: 'Back to previous picture' })).toBeNull()
      rerender(<ThumbnailSet item={one({ hasPrevious: true })} busy={false} />)
      await user.click(screen.getByRole('button', { name: 'Back to previous picture' }))
      expect(switchThumbnailPicture).toHaveBeenCalledWith(ID)
      expect(toast).toHaveBeenCalledWith({ title: 'Putting the previous picture back' })
    })

    it('a painted change that did not compose offers both ways out', () => {
      render(
        <ThumbnailSet
          item={one({
            state: 'failed',
            error: 'Compose failed.',
            hasPicture: true,
            hasPrevious: true,
          })}
          busy={false}
        />,
      )
      expect(screen.getByRole('button', { name: 'Compose again' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Back to previous picture' })).toBeInTheDocument()
    })

    it('a package that needs composing holds the change and the repaint back', async () => {
      const user = userEvent.setup()
      render(
        <ThumbnailSet
          item={one({
            state: 'failed',
            error: 'Compose failed.',
            hasPicture: true,
            hasPrevious: true,
          })}
          busy={false}
        />,
      )
      await user.type(screen.getByRole('textbox', { name: 'Change the picture' }), 'darker sky')
      expect(screen.getByRole('button', { name: 'Change picture' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Regenerate picture' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Compose again' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Back to previous picture' })).toBeEnabled()
      expect(
        screen.getByText('Compose again is free. Regenerate picture and Change picture wait for it.'),
      ).toBeInTheDocument()
    })

    it('an uploaded thumbnail has no change field', () => {
      render(
        <ThumbnailSet
          item={one({ source: 'uploaded', idea: null, hasPrevious: true })}
          busy={false}
        />,
      )
      expect(screen.queryByRole('textbox', { name: 'Change the picture' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Change picture' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Back to previous picture' })).toBeNull()
    })

    it('a closed record has no change field', () => {
      render(
        <ThumbnailSet
          item={one({ approved: true, hasPrevious: true }, { status: 'scheduled' })}
          busy={false}
        />,
      )
      expect(screen.queryByRole('textbox', { name: 'Change the picture' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Change picture' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Back to previous picture' })).toBeNull()
    })

    it('the change waits while the package is being made', () => {
      render(<ThumbnailSet item={one({ inFlight: true, hasPrevious: true })} busy={false} />)
      expect(screen.getByRole('textbox', { name: 'Change the picture' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Change picture' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Back to previous picture' })).toBeDisabled()
    })
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
      expect(screen.queryByRole('button', { name: /started the test/i })).toBeInTheDocument()
    })

    it('says the test waits for the video to be public', () => {
      const { rerender } = render(
        <ThumbnailSet item={item({ record: uploadedRecord('uploaded') })} busy={false} />,
      )
      const line = 'YouTube tests only a public video. Start the test once this one is public.'
      const started = screen.getByRole('button', { name: 'I have started the test' })
      expect(screen.getByText(line)).toBeInTheDocument()
      expect(
        screen.getByText(line).compareDocumentPosition(started) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      rerender(<ThumbnailSet item={item({ record: uploadedRecord('live') })} busy={false} />)
      expect(screen.queryByText(line)).not.toBeInTheDocument()
    })

    describe('the test', () => {
      const started = (over: Partial<PublishRecordProp> = {}) =>
        item({
          record: {
            ...uploadedRecord('live'),
            testStartedAtIso: '2026-11-20T10:00:00.000Z',
            ...over,
          },
        })

      it('offers the result buttons only after the test started', async () => {
        const user = userEvent.setup()
        const { rerender } = render(
          <ThumbnailSet item={item({ record: uploadedRecord('live') })} busy={false} />,
        )
        expect(screen.queryByText('How did the test end?')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: '2 won' })).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'I have started the test' }))
        expect(markTestStarted).toHaveBeenCalledWith('master', PROJECT)

        rerender(<ThumbnailSet item={started()} busy={false} />)
        expect(screen.getByText('How did the test end?')).toBeInTheDocument()
        for (const name of ['1 won', '2 won', '3 won', 'Performed the same', 'Inconclusive']) {
          expect(screen.getByRole('button', { name })).toBeInTheDocument()
        }
        expect(screen.queryByRole('button', { name: 'I have started the test' })).toBeNull()
        expect(screen.getAllByLabelText(/^Watch time share/)).toHaveLength(3)
      })

      it('says once that a running test blocks title and thumbnail changes', () => {
        render(<ThumbnailSet item={started()} busy={false} />)
        expect(screen.getAllByText(/A Test & Compare is running on this video\./)).toHaveLength(1)
      })

      it('sends the shares typed with the pressed result button', async () => {
        const user = userEvent.setup()
        render(<ThumbnailSet item={started()} busy={false} />)
        await user.type(screen.getByLabelText('Watch time share, variant 1'), '40')
        await user.type(screen.getByLabelText('Watch time share, variant 2'), '60')
        await user.click(screen.getByRole('button', { name: '2 won' }))
        expect(recordTestResult).toHaveBeenCalledWith('master', PROJECT, {
          outcome: { winner: '01HQ00000000000000000000K2' },
          shares: { '01HQ00000000000000000000K1': 40, '01HQ00000000000000000000K2': 60 },
        })
      })

      it('sends no shares when none were typed', async () => {
        const user = userEvent.setup()
        render(<ThumbnailSet item={started()} busy={false} />)
        await user.click(screen.getByRole('button', { name: 'Performed the same' }))
        expect(recordTestResult).toHaveBeenCalledWith('master', PROJECT, {
          outcome: 'same',
          shares: {},
        })
      })

      it('shows the recorded result in words with the shares, and a Change the result button', async () => {
        const user = userEvent.setup()
        const ended = started({
          testEndedAtIso: '2026-11-24T10:00:00.000Z',
          packages: uploadedRecord('live').packages.map((p, at) => ({
            ...p,
            result: at === 1 ? ('won' as const) : ('lost' as const),
            watchTimeShare: at === 2 ? null : at === 1 ? 60 : 40,
          })),
        })
        render(<ThumbnailSet item={ended} busy={false} />)
        expect(screen.getByText('Variant 2 won.')).toBeInTheDocument()
        expect(screen.getByText(/Variant 1: 40%/)).toBeInTheDocument()
        expect(screen.getByText(/Variant 2: 60%/)).toBeInTheDocument()
        expect(screen.queryByText(/A Test & Compare is running/)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: '2 won' })).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Change the result' }))
        expect(screen.getByRole('button', { name: '2 won' })).toBeInTheDocument()
      })

      it('puts the recorded result back when Keep the recorded result is pressed', async () => {
        const user = userEvent.setup()
        const ended = started({
          testEndedAtIso: '2026-11-24T10:00:00.000Z',
          packages: uploadedRecord('live').packages.map((p, at) => ({
            ...p,
            result: at === 1 ? ('won' as const) : ('lost' as const),
          })),
        })
        render(<ThumbnailSet item={ended} busy={false} />)
        await user.click(screen.getByRole('button', { name: 'Change the result' }))
        expect(screen.queryByText('Variant 2 won.')).not.toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Keep the recorded result' }))
        expect(screen.getByText('Variant 2 won.')).toBeInTheDocument()
        expect(recordTestResult).not.toHaveBeenCalled()
      })

      it('a result from an earlier video is not shown once the stamps are cleared', () => {
        const earlier = item({
          record: {
            ...uploadedRecord('scheduled'),
            testStartedAtIso: null,
            testEndedAtIso: null,
            packages: uploadedRecord('scheduled').packages.map((p, at) => ({
              ...p,
              result: at === 1 ? ('won' as const) : ('lost' as const),
            })),
          },
        })
        render(<ThumbnailSet item={earlier} busy={false} />)
        expect(screen.getByRole('button', { name: 'I have started the test' })).toBeInTheDocument()
        expect(screen.queryByText(/^Variant \d+ won\./)).not.toBeInTheDocument()
      })

      it('offers Add to references on the winner only, once the result is recorded', async () => {
        const user = userEvent.setup()
        const ended = started({
          testEndedAtIso: '2026-11-24T10:00:00.000Z',
          packages: uploadedRecord('live').packages.map((p, at) => ({
            ...p,
            result: at === 1 ? ('won' as const) : ('lost' as const),
          })),
        })
        const winnerId = ended.record!.packages[1]!.id
        render(<ThumbnailSet item={ended} busy={false} />)

        const button = screen.getByRole('button', { name: 'Add to references' })
        expect(screen.getAllByRole('button', { name: 'Add to references' })).toHaveLength(1)
        await user.click(button)
        expect(addWinnerToReferences).toHaveBeenCalledWith(winnerId)
        await vi.waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Added to references' }))
      })

      it('says why when the winner cannot be added', async () => {
        const user = userEvent.setup()
        addWinnerToReferences.mockResolvedValue({
          ok: false,
          error: 'Six reference thumbnails at most. Remove one first.',
        })
        const ended = started({
          testEndedAtIso: '2026-11-24T10:00:00.000Z',
          packages: uploadedRecord('live').packages.map((p, at) => ({
            ...p,
            result: at === 1 ? ('won' as const) : ('lost' as const),
          })),
        })
        render(<ThumbnailSet item={ended} busy={false} />)
        await user.click(screen.getByRole('button', { name: 'Add to references' }))
        await vi.waitFor(() =>
          expect(toast).toHaveBeenCalledWith(
            expect.objectContaining({
              description: 'Six reference thumbnails at most. Remove one first.',
              variant: 'error',
            }),
          ),
        )
      })

      it('offers no Add to references without a recorded end, or when nobody won', () => {
        const noEnd = started({
          packages: uploadedRecord('live').packages.map((p, at) => ({
            ...p,
            result: at === 1 ? ('won' as const) : ('lost' as const),
          })),
        })
        const { rerender } = render(<ThumbnailSet item={noEnd} busy={false} />)
        expect(screen.queryByRole('button', { name: 'Add to references' })).not.toBeInTheDocument()
        rerender(
          <ThumbnailSet
            item={started({
              testEndedAtIso: '2026-11-24T10:00:00.000Z',
              packages: uploadedRecord('live').packages.map((p) => ({ ...p, result: 'same' })),
            })}
            busy={false}
          />,
        )
        expect(screen.queryByRole('button', { name: 'Add to references' })).not.toBeInTheDocument()
      })

      it('words a same and an inconclusive result without a winner', () => {
        const base = (result: 'same' | 'inconclusive') =>
          started({
            testEndedAtIso: '2026-11-24T10:00:00.000Z',
            packages: uploadedRecord('live').packages.map((p) => ({ ...p, result })),
          })
        const { rerender } = render(
          <ThumbnailSet item={item({ record: base('same').record })} busy={false} />,
        )
        expect(screen.getByText('The variants performed the same.')).toBeInTheDocument()
        rerender(<ThumbnailSet item={item({ record: base('inconclusive').record })} busy={false} />)
        expect(screen.getByText('The test was inconclusive.')).toBeInTheDocument()
      })
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
