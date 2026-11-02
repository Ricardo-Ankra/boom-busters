import { EMPTY_BIBLE } from '@boom-busters/schemas'
import type { ChannelView } from './channel-tab'

/** A channel as the settings form receives it, for the tests that render the whole form. */
export const FIXTURE_CHANNEL_VIEW: ChannelView = {
  id: '01J00000000000000000000001',
  slug: 'first',
  name: 'First',
  handle: null,
  bible: EMPTY_BIBLE,
  archived: false,
}

/** The saved bible version behind the fixture channel, for the Bible tab. */
export const FIXTURE_CURRENT_VERSION = {
  id: '01J00000000000000000000009',
  version: 1,
  bible: EMPTY_BIBLE,
}
