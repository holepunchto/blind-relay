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

  static DUPLICATE_CHANNEL (msg = 'Duplicate channel') {
    return new BridgingRelayError(msg, 'DUPLICATE_CHANNEL', BridgingRelayError.DUPLICATE_CHANNEL)
  }

  static CHANNEL_CLOSED (msg = 'Channel closed') {
    return new BridgingRelayError(msg, 'CHANNEL_CLOSED', BridgingRelayError.CHANNEL_CLOSED)
  }

  static CHANNEL_DESTROYED (msg = 'Channel destroyed') {
    return new BridgingRelayError(msg, 'CHANNEL_DESTROYED', BridgingRelayError.CHANNEL_DESTROYED)
  }

  static PAIRING_CANCELLED (msg = 'Pairing cancelled') {
    return new BridgingRelayError(msg, 'PAIRING_CANCELLED', BridgingRelayError.PAIRING_CANCELLED)
  }
}