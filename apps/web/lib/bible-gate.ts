/**
 * The refusal every gated action and disabled button shares: a channel whose
 * bible is incomplete cannot suggest cases or start a project. No server
 * imports, so client components print the same words the actions return.
 */
export const BIBLE_INCOMPLETE_MESSAGE = 'Complete the channel bible in Settings first'

/**
 * The runner's refusal for a project frozen to an incomplete bible version.
 * Completing the bible in Settings saves a newer version, which the project
 * does not follow on its own, so the words name the button that moves it.
 */
export const FROZEN_BIBLE_INCOMPLETE_MESSAGE =
  'This project uses a channel bible version that is incomplete. Complete the bible in Settings, then press Use the latest bible on the project page'
