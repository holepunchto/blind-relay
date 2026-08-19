const { Duplex } = require('streamx')
const Protomux = require('protomux')
const relay = require('..')

exports.withSocket = function withSocket(t, udx) {
  const socket = udx.createSocket()
  socket.bind()
  t.teardown(() => socket.close(), { order: 3 })
  return socket
}

exports.withServer = function withServer(t, createStream) {
  const server = new relay.Server({ createStream })
  t.teardown(() => server.close(), { order: 2 })
  return server
}

exports.withClient = function withClient(t, server, opts = {}) {
  const { onerror = (err) => t.fail(err), withSession = false } = opts

  const serverStream = new Duplex({
    write(data, cb) {
      clientStream.push(data)
      cb(null)
    }
  })

  const clientStream = new Duplex({
    write(data, cb) {
      serverStream.push(data)
      cb(null)
    }
  })

  const session = server.accept(serverStream)
  session.on('error', onerror)

  const client = new relay.Client(clientStream)
  t.teardown(() => client.end(), { order: 1 })
  return withSession ? { client, session } : client
}

exports.withRawClient = function withRawClient(t, server) {
  const serverStream = new Duplex({
    write(data, cb) {
      clientStream.push(data)
      cb(null)
    },
    destroy(cb) {
      clientStream.destroy()
      cb(null)
    }
  })

  const clientStream = new Duplex({
    write(data, cb) {
      serverStream.push(data)
      cb(null)
    },
    destroy(cb) {
      serverStream.destroy()
      cb(null)
    }
  })

  const session = server.accept(serverStream)
  session.on('error', (err) => t.fail(err))

  const channel = Protomux.from(clientStream).createChannel({ protocol: 'blind-relay' })
  const pair = channel.addMessage({ encoding: relay.messages.pair, onmessage: noop })

  channel.open()
  t.teardown(() => clientStream.destroy(), { order: 1 })

  return { session, pair, stream: clientStream }
}

function noop() {}
