const EventEmitter = require('events')
const Protomux = require('protomux')
const { Readable } = require('streamx')
const sodium = require('sodium-universal')
const b4a = require('b4a')
const c = require('compact-encoding')
const bitfield = require('compact-encoding-bitfield')
const bits = require('bits-to-bytes')
const errors = require('./lib/errors')

exports.Server = class BridgingRelayServer {
  constructor (opts = {}) {
    const {
      createStream
    } = opts

    this._createStream = createStream
    this._pairs = new Map()
    this._sessions = new Set()
  }

  get sessions () {
    return this._sessions[Symbol.iterator]()
  }

  accept (stream, opts) {
    const session = new BridgingRelaySession(this, stream, opts)

    this._sessions.add(session)

    stream.on('close', () => session.destroy())

    return session
  }

  close () {
    for (const session of this._sessions) {
      session.destroy()
    }

    this._sessions.clear()
  }
}

class BridgingRelaySession extends EventEmitter {
  constructor (server, stream, opts = {}) {
    super()

    const {
      id,
      handshake,
      handshakeEncoding
    } = opts

    this._server = server
    this._mux = Protomux.from(stream)

    this._channel = this._mux.createChannel({
      protocol: 'protomux-bridging-relay',
      id,
      handshake: handshake ? handshakeEncoding || c.raw : null,
      onopen: this._onopen.bind(this),
      onclose: this._onclose.bind(this),
      ondestroy: this._ondestroy.bind(this)
    })

    this._pair = this._channel.addMessage({
      encoding: m.pair,
      onmessage: this._onpair.bind(this)
    })

    this._error = null
    this._streams = new Set()

    this._channel.open(handshake)
  }

  _onopen () {
    this.emit('open')
  }

  _onclose () {
    const err = this._error || errors.CHANNEL_CLOSED()

    for (const stream of this._streams) {
      stream.destroy(err)
    }

    this._streams.clear()

    this._server._sessions.delete(this)

    this.emit('close')
  }

  _ondestroy () {
    this.emit('destroy')
  }

  _onpair ({ isInitiator, token, id: remoteId }) {
    const keyString = token.toString('hex')

    let pair = this._server._pairs.get(keyString)

    if (pair === undefined) {
      pair = new BridgingRelaySessionPair()
      this._server._pairs.set(keyString, pair)
    }

    pair.sessions[+isInitiator] = {
      session: this,
      isInitiator,
      remoteId,
      stream: null
    }

    if (pair.paired) {
      this._server._pairs.delete(keyString)

      for (const session of pair.sessions) {
        const remoteId = session.remoteId

        session.stream = this._server._createStream({
          firewall (socket, port, host) {
            this.connect(socket, remoteId, port, host)
            return false
          }
        })
      }

      for (const { isInitiator, session, stream } of pair.sessions) {
        stream.relayTo(pair.remote(isInitiator).stream)

        session._streams.add(stream)

        stream
          .on('error', () => { /* TODO */ })
          .on('close', () => session._streams.delete(stream))

        session._pair.send({
          isInitiator,
          token,
          id: stream.id,
          seq: 0
        })
      }
    }
  }

  destroy (err) {
    this._error = err || errors.CHANNEL_DESTROYED()
    this._channel.close()
  }
}

class BridgingRelaySessionPair {
  constructor () {
    this.sessions = [null, null]
  }

  get paired () {
    return this.sessions[0] !== null && this.sessions[1] !== null
  }

  remote (isInitiator) {
    return this.sessions[isInitiator ? 0 : 1]
  }
}

exports.Client = class BridgingRelayClient extends EventEmitter {
  static _clients = new WeakMap()

  static from (stream, opts) {
    let client = this._clients.get(stream)
    if (client) return client
    client = new this(stream, opts)
    this._clients.set(stream, client)
    return client
  }

  constructor (stream, opts = {}) {
    super()

    const {
      id,
      handshake,
      handshakeEncoding
    } = opts

    this._mux = Protomux.from(stream)

    this._channel = this._mux.createChannel({
      protocol: 'protomux-bridging-relay',
      id,
      handshake: handshake ? handshakeEncoding || c.raw : null,
      onopen: this._onopen.bind(this),
      onclose: this._onclose.bind(this),
      ondestroy: this._ondestroy.bind(this)
    })

    this._pair = this._channel.addMessage({
      encoding: m.pair,
      onmessage: this._onpair.bind(this)
    })

    this._error = null
    this._requests = new Map()

    this._channel.open(handshake)
  }

  get stream () {
    return this._mux.stream
  }

  get requests () {
    return this._requests.values()
  }

  _onopen () {
    this.emit('open')
  }

  _onclose () {
    const err = this._error || errors.CHANNEL_CLOSED()

    for (const request of this._requests.values()) {
      request.destroy(err)
    }

    this._requests.clear()

    this.constructor._clients.delete(this.stream)
  }

  _ondestroy () {
    this.emit('destroy')
  }

  _onpair ({ isInitiator, token, id: remoteId }) {
    const keyString = token.toString('hex')

    const request = this._requests.get(keyString)

    if (request === undefined || request.isInitiator !== isInitiator) return

    request.push(remoteId)
    request.push(null)
  }

  pair (isInitiator, token, stream) {
    const keyString = token.toString('hex')

    const request = new BridgingRelayRequest(this, isInitiator, token, stream)

    this._requests.set(keyString, request)

    request.on('close', () => this._requests.delete(keyString))

    return request
  }

  destroy (err) {
    this._error = err || errors.CHANNEL_DESTROYED()
    this._channel.close()
  }
}

class BridgingRelayRequest extends Readable {
  constructor (client, isInitiator, token, stream) {
    super()

    this.client = client
    this.isInitiator = isInitiator
    this.token = token
    this.stream = stream
  }

  _open (cb) {
    this.client._pair.send({
      isInitiator: this.isInitiator,
      token: this.token,
      id: this.stream.id,
      seq: 0
    })

    cb(null)
  }
}

exports.token = function token (buf = b4a.allocUnsafe(32)) {
  sodium.randombytes_buf(buf)
  return buf
}

const m = exports.messages = {}

const flags = bitfield(7)

m.pair = {
  preencode (state, m) {
    flags.preencode(state)
    c.fixed32.preencode(state, m.token)
    c.uint.preencode(state, m.id)
    c.uint.preencode(state, m.seq)
  },
  encode (state, m) {
    flags.encode(state, bits.of(m.isInitiator))
    c.fixed32.encode(state, m.token)
    c.uint.encode(state, m.id)
    c.uint.encode(state, m.seq)
  },
  decode (state) {
    const [isInitiator] = bits.iterator(flags.decode(state))

    return {
      isInitiator,
      token: c.fixed32.decode(state),
      id: c.uint.decode(state),
      seq: c.uint.decode(state)
    }
  }
}
