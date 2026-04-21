import test from 'brittle'
import UDX from 'udx-native'
import { once } from 'bare-events'

import relay from './index.js'
import { withSocket, withServer, withClient } from './test/helpers.js'

test('basic', (t) => {
  t.plan(8)

  const udx = new UDX()
  const socket = withSocket(t, udx)

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  {
    const client = withClient(t, server)
    const stream = createStream()

    client.on('pair', (...args) => t.alike(args, [true, token, stream, 4]))

    const request = client.pair(true, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', (remoteId) => {
        t.pass(`paired with ${remoteId}`)

        request.stream
          .on('error', () => {})
          .on('close', () => t.pass('stream closed'))
          .on('data', (data) => t.alike(data.toString(), 'initiatee'))
          .connect(socket, remoteId, socket.address().port)

        request.stream.end('initiator')
      })
  }

  {
    const client = withClient(t, server)
    const stream = createStream()

    client.on('pair', (...args) => t.alike(args, [false, token, stream, 3]))

    const request = client.pair(false, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', (remoteId) => {
        t.pass(`paired with ${remoteId}`)

        request.stream
          .on('error', () => {})
          .on('close', () => t.pass('stream closed'))
          .on('data', (data) => t.alike(data.toString(), 'initiator'))
          .connect(socket, remoteId, socket.address().port)

        request.stream.end('initiatee')
      })
  }
})

test('both peers can unpair after pairing', (t) => {
  t.plan(2)

  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  {
    const client = withClient(t, server)
    const stream = createStream()

    const request = client.pair(true, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', () => t.pass('paired'))
      .on('close', () => client.unpair(token))
  }

  {
    const client = withClient(t, server)
    const stream = createStream()

    const request = client.pair(false, token, stream)

    request
      .on('error', (err) => t.fail(err))
      .on('data', () => t.pass('paired'))
      .on('close', () => client.unpair(token))
  }
})

test('one-sided unpair closes both active relay streams', { timeout: 5000 }, async (t) => {
  t.plan(2)

  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  const clientA = withClient(t, server)
  const clientB = withClient(t, server)
  const [sessionA, sessionB] = Array.from(server.sessions)

  const requestA = clientA.pair(true, token, createStream())
  const requestB = clientB.pair(false, token, createStream())

  const [pairA, pairB] = await Promise.all([
    once(sessionA, 'pair'),
    once(sessionB, 'pair'),
    once(requestA, 'data'),
    once(requestB, 'data')
  ])

  t.pass('pair became active')

  const relayStreamA = pairA[2]
  const relayStreamB = pairB[2]

  const closedA = onceClose(relayStreamA)
  const closedB = onceClose(relayStreamB)

  relayStreamA.on('error', noop)
  relayStreamB.on('error', noop)

  // One unpair() must tear down both halves of an active pair.
  clientA.unpair(token)

  await Promise.all([closedA, closedB])

  t.pass('unpair closed both active relay streams')
})

function onceClose(stream) {
  // bare-events.once('close') rejects on a prior error, but here we only care that shutdown completes.
  return new Promise((resolve) => stream.once('close', resolve))
}

function noop() {}
