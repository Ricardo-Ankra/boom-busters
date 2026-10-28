/**
 * One plain sentence per `?youtube=<outcome>` the connect and callback routes
 * send the browser back with: what happened, and what to do about it.
 */
export const YOUTUBE_OUTCOMES: Record<string, { good: boolean; text: string }> = {
  connected: { good: true, text: 'YouTube is connected to this channel.' },
  declined: {
    good: false,
    text: 'You cancelled on the Google screen, so nothing was connected. Press Connect YouTube to try again.',
  },
  'state-mismatch': {
    good: false,
    text: 'The Google sign-in could not be matched to this session, so nothing was stored. Press Connect YouTube to start again.',
  },
  'exchange-failed': {
    good: false,
    text: 'Google refused the sign-in code, so nothing was stored. Press Connect YouTube to try again.',
  },
  'no-refresh-token': {
    good: false,
    text: 'Google did not hand over a long-lived grant, so nothing was stored. Press Connect YouTube and approve every permission.',
  },
  'no-channel': {
    good: false,
    text: 'That Google account has no YouTube channel, or Google could not confirm it. Choose an account that owns a YouTube channel and connect again.',
  },
  'channel-changed': {
    good: false,
    text: 'That account is a different YouTube channel from the one connected here. The earlier connection was kept and now needs attention. Disconnect it first if you want to switch accounts.',
  },
  'channel-taken': {
    good: false,
    text: 'That YouTube channel is already connected to another channel in this console. Choose a different account.',
  },
  archived: {
    good: false,
    text: 'This channel is archived, so YouTube cannot be connected to it. Open a live channel to connect an account.',
  },
  'missing-client': {
    good: false,
    text: 'The YouTube client id and secret are not set in the environment. Add them, then connect again.',
  },
  error: {
    good: false,
    text: 'Something went wrong while connecting YouTube. Try again, and check the server log if it repeats.',
  },
}
