import type { GraphicPayload } from '@boom-busters/schemas'
import { FIXTURE_IMAGE_SKYLINE } from './media'

/**
 * A composed graphic (decision 268, Plan B): a title, a counting figure with
 * its underline sweep, a logo, a rule and a two-bar comparison, one of each
 * element kind the vocabulary offers. The title and the figure share a column and are
 * both centred, so the golden also pins a figure aligned off its box's left edge.
 */
export const GRAPHIC_SCENE: GraphicPayload = {
  kind: 'graphic',
  scene: {
    elements: [
      {
        kind: 'text',
        id: 't1',
        cell: { col: 0, row: 0, colSpan: 7, rowSpan: 2 },
        content: 'Raised in a single round',
        role: 'title',
        color: 'textSecondary',
        align: 'center',
        enter: { kind: 'fade', atMs: 0 },
      },
      {
        kind: 'figure',
        align: 'center',
        id: 'f1',
        cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
        value: '$4bn',
        label: 'valuation, 2022',
        claimRef: '01HQ00000000000000000000AA',
        color: 'accent',
        enter: { kind: 'count', atMs: 300 },
        emphasis: 'underline',
      },
      {
        kind: 'logo',
        id: 'l1',
        cell: { col: 8, row: 1, colSpan: 4, rowSpan: 4 },
        entity: 'Stability AI',
        assetId: '01HQ00000000000000000000M1',
        enter: { kind: 'rise', atMs: 500 },
      },
      {
        kind: 'shape',
        id: 's1',
        cell: { col: 0, row: 7, colSpan: 12, rowSpan: 1 },
        form: 'rule',
        color: 'textSecondary',
        opacity: 0.4,
        enter: { kind: 'wipe', atMs: 700 },
      },
      {
        kind: 'bars',
        id: 'b1',
        cell: { col: 0, row: 8, colSpan: 12, rowSpan: 2 },
        color: 'collapse',
        highlightIndex: 1,
        enter: { kind: 'fade', atMs: 900 },
        items: [
          { label: 'raised', value: 4, display: '$4bn', claimRef: '01HQ00000000000000000000AA' },
          {
            label: 'burned',
            value: 3.9,
            display: '$3.9bn',
            claimRef: '01HQ00000000000000000000AB',
          },
        ],
      },
    ],
  },
  logos: {
    l1: {
      r2Key: 'boom-busters/logos/fixture.png',
      url: FIXTURE_IMAGE_SKYLINE,
      width: 1200,
      height: 400,
    },
  },
  claimIds: ['01HQ00000000000000000000AA', '01HQ00000000000000000000AB'],
}

/** The staged fixture's slot: 9 s, 270 frames at 30 fps. */
export const GRAPHIC_STAGED_DURATION_MS = 9000

/**
 * A graphic built in steps (decision 290), one of each new motion: a title
 * that leaves and a second that takes its cell, bars that grow one at a time
 * and rescale, a colour shift and a camera push. At 1.5 s the first bar fills
 * the width alone; at 4 s the second has grown and the first is a quarter; at
 * 8.5 s the second title is up, the bars are red and the camera is in.
 */
export const GRAPHIC_STAGED_SCENE: GraphicPayload = {
  kind: 'graphic',
  scene: {
    elements: [
      {
        kind: 'text',
        id: 't1',
        cell: { col: 1, row: 2, colSpan: 10, rowSpan: 1 },
        content: 'Valuation, on paper',
        role: 'title',
        color: 'textSecondary',
        align: 'center',
        enter: { kind: 'fade', atMs: 0 },
        exit: { kind: 'fade', atMs: 4000 },
      },
      {
        kind: 'text',
        id: 't2',
        cell: { col: 1, row: 2, colSpan: 10, rowSpan: 1 },
        content: 'Four times in six months',
        role: 'title',
        color: 'textPrimary',
        align: 'center',
        enter: { kind: 'rise', atMs: 4500 },
      },
      {
        kind: 'bars',
        id: 'b1',
        cell: { col: 1, row: 3, colSpan: 10, rowSpan: 5 },
        color: 'series0',
        highlightIndex: 1,
        enter: { kind: 'wipe', atMs: 300 },
        emphasis: { kind: 'color', atMs: 5500, to: 'collapse' },
        items: [
          { label: 'Oct 2022', value: 1, display: '$1bn', claimRef: '01HQ00000000000000000000AA' },
          {
            label: 'Sought, 2023',
            value: 4,
            display: '$4bn',
            claimRef: '01HQ00000000000000000000AB',
            atMs: 2000,
          },
        ],
      },
    ],
    camera: [{ atMs: 6000, focus: 'b1', zoom: 1.25 }],
  },
  logos: {},
  claimIds: ['01HQ00000000000000000000AA', '01HQ00000000000000000000AB'],
}
