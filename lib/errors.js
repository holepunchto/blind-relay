module.exports = class BridgingRelayError extends Error {
  constructor (msg, code, fn = BridgingRelayError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name () {
    return 'BridgingRelayError'
  }

  static DUPLICATE_CHANNEL (msg = 'duplicate channel') {
    return new BridgingRelayError(msg, 'DUPLICATE_CHANNEL', BridgingRelayError.DUPLICATE_CHANNEL)
  }

  static CHANNEL_CLOSED (msg = 'Channel closed') {
    return new BridgingRelayError(msg, 'CHANNEL_CLOSED', BridgingRelayError.CHANNEL_CLOSED)
  }

  static CHANNEL_DESTROYED (msg = 'channel destroyed') {
    return new BridgingRelayError(msg, 'CHANNEL_DESTROYED', BridgingRelayError.CHANNEL_DESTROYED)
  }
}
