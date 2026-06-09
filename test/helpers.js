const { Duplex } = require('streamx')
const relay = require('..')
const DebuggingStream = require('debugging-stream')

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

  let serverStream = new Duplex({
    write(data, cb) {
      clientStream.push(data)
      cb(null)
    }
  })

  let clientStream = new Duplex({
    write(data, cb) {
      serverStream.push(data)
      cb(null)
    }
  })

  if (opts.debugging) {
    serverStream = new DebuggingStream(serverStream, opts.debugging)
    clientStream = new DebuggingStream(clientStream, opts.debugging)
  }
  const session = server.accept(serverStream)
  session.on('error', onerror)

  const client = new relay.Client(clientStream)
  t.teardown(() => client.end(), { order: 1 })
  return withSession ? { client, session } : client
}
