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

  static CHANNEL_CLOSED (msg = 'Channel closed') {
    return new BridgingRelayError(msg, 'CHANNEL_CLOSED', BridgingRelayError.CHANNEL_CLOSED)
  }
}
