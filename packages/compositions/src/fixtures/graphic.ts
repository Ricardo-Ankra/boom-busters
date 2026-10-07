import type { GraphicPayload } from '@boom-busters/schemas'
import { FIXTURE_IMAGE_SKYLINE } from './media'

/**
 * A composed graphic (decision 268, Plan B): a title, a counting figure with
 * its underline sweep, a logo, a rule and a two-bar comparison, one of each
 * element kind the vocabulary offers.
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
        align: 'start',
        enter: { kind: 'fade', atMs: 0 },
      },
      {
        kind: 'figure',
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
