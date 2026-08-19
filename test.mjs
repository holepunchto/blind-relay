import test from 'brittle'
import UDX from 'udx-native'
import { once } from 'bare-events'

import relay from './index.js'
import { withSocket, withServer, withClient, withRawClient } from './test/helpers.js'

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

test('self-claim does not poison a pending pair', async (t) => {
  const udx = new UDX()
  const relayStreams = []
  let id = 0

  const server = withServer(t, (opts) => {
    const stream = udx.createStream(++id, opts)
    relayStreams.push(stream)
    return stream
  })
  const peerA = withRawClient(t, server)
  const peerB = withRawClient(t, server)
  const token = relay.token()
  const probeA = relay.token()
  const probeB = relay.token()

  peerA.pair.send({ isInitiator: true, token, id: 5001, seq: 0 })
  peerA.pair.send({ isInitiator: false, token, id: 5002, seq: 0 })
  peerA.pair.send({ isInitiator: true, token: probeA, id: 5003, seq: 0 })
  await waitFor(() => server._pairing.has(probeA.toString('hex')))

  t.is(relayStreams.length, 0, 'self-claim allocated no relay streams')

  peerB.pair.send({ isInitiator: false, token, id: 5004, seq: 0 })
  peerB.pair.send({ isInitiator: true, token: probeB, id: 5005, seq: 0 })
  await waitFor(() => server._pairing.has(probeB.toString('hex')))

  t.is(relayStreams.length, 2, 'another session completed the pending pair')

  const closedA = once(peerA.session, 'close')
  const closedB = once(peerB.session, 'close')
  peerA.stream.destroy()
  peerB.stream.destroy()
  await Promise.all([closedA, closedB])

  t.is(
    relayStreams.filter((stream) => !stream.destroyed).length,
    0,
    'all relay streams were reclaimed'
  )
  destroyAll(relayStreams)
})

test('active token reuse does not replace relay links', async (t) => {
  const udx = new UDX()
  const relayStreams = []
  let id = 0

  const createStream = (opts) => udx.createStream(++id, opts)
  const server = withServer(t, (opts) => {
    const stream = createStream(opts)
    relayStreams.push(stream)
    return stream
  })
  const peerA = withClient(t, server, { withSession: true })
  const peerB = withClient(t, server, { withSession: true })
  const token = relay.token()

  const firstA = peerA.client.pair(true, token, createStream())
  const firstB = peerB.client.pair(false, token, createStream())
  await Promise.all([once(firstA, 'data'), once(firstB, 'data')])

  const retryA = peerA.client.pair(true, token, createStream())
  const retryB = peerB.client.pair(false, token, createStream())
  const openedA = once(retryA, 'open')
  const openedB = once(retryB, 'open')
  retryA.on('data', noop)
  retryB.on('data', noop)
  await Promise.all([openedA, openedB])

  const probeToken = relay.token()
  const probeA = peerA.client.pair(true, probeToken, createStream())
  const probeB = peerB.client.pair(false, probeToken, createStream())
  await Promise.all([once(probeA, 'data'), once(probeB, 'data')])

  t.is(relayStreams.length, 4, 'active token was not paired again')

  retryA.destroy()
  retryB.destroy()

  const closedA = once(peerA.session, 'close')
  const closedB = once(peerB.session, 'close')
  await Promise.all([peerA.client.end(), peerB.client.end(), closedA, closedB])

  t.is(
    relayStreams.filter((stream) => !stream.destroyed).length,
    0,
    'all relay streams were reclaimed'
  )
  destroyAll(relayStreams)
})

test('active token cannot create another pending pair', async (t) => {
  const udx = new UDX()
  let id = 0

  const createStream = (opts) => udx.createStream(++id, opts)
  const server = withServer(t, createStream)
  const peerA = withClient(t, server)
  const peerB = withClient(t, server)
  const peerC = withClient(t, server)
  const token = relay.token()

  const firstA = peerA.pair(true, token, createStream())
  const firstB = peerB.pair(false, token, createStream())
  await Promise.all([once(firstA, 'data'), once(firstB, 'data')])

  const retryC = peerC.pair(true, token, createStream())
  const openedC = once(retryC, 'open')
  retryC.on('data', noop)
  await openedC

  const probeToken = relay.token()
  const probeC = peerC.pair(true, probeToken, createStream())
  const probeError = new Promise((resolve) => probeC.once('error', resolve))
  probeC.on('data', noop)
  await waitFor(() => server._pairing.has(probeToken.toString('hex')))

  t.is(
    server._pairing.has(token.toString('hex')),
    false,
    'active token was not accepted as pending'
  )

  peerC.unpair(probeToken)
  const err = await probeError
  t.is(err.code, 'PAIRING_CANCELLED', 'probe request was cancelled as expected')
  await waitFor(() => !server._pairing.has(probeToken.toString('hex')))
  retryC.destroy()

  const cancelled = server.stats.pairings.cancelled
  peerA.unpair(token)
  await waitFor(() => server.stats.pairings.cancelled === cancelled + 1)

  t.is(server.stats.pairings.active, 0, 'unpair removed the active pair')
})

test('token can be reused after unpairing', async (t) => {
  const udx = new UDX()
  let id = 0

  const createStream = (opts) => udx.createStream(++id, opts)
  const server = withServer(t, createStream)
  const peerA = withClient(t, server)
  const peerB = withClient(t, server)
  const token = relay.token()

  const firstA = peerA.pair(true, token, createStream())
  const firstB = peerB.pair(false, token, createStream())
  await Promise.all([once(firstA, 'data'), once(firstB, 'data')])
  await waitFor(() => [...peerA.requests].length === 0 && [...peerB.requests].length === 0)

  peerA.unpair(token)
  await waitFor(() => server.stats.pairings.active === 0)

  const secondA = peerA.pair(true, token, createStream())
  const secondB = peerB.pair(false, token, createStream())
  await Promise.all([once(secondA, 'data'), once(secondB, 'data')])

  t.is(server.stats.pairings.matched, 2)
})

test('stats: session lifecycle', async (t) => {
  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const { client, session } = withClient(t, server, { withSession: true })
  const onopen = once(session, 'open')
  const onclose = once(session, 'close')

  if (server.stats.sessions.opened === 0) await onopen

  t.is(server.stats.sessions.accepted, 1)
  t.is(server.stats.sessions.opened, 1)
  t.is(server.stats.sessions.active, 1)
  t.is(server.stats.sessions.closed, 0)

  await client.end()
  await onclose

  t.is(server.stats.sessions.active, 0)
  t.is(server.stats.sessions.closed, 1)
})

test('stats: matched pairings and relayed streams', async (t) => {
  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  const clientA = withClient(t, server)
  const clientB = withClient(t, server)
  const streamA = createStream()
  const streamB = createStream()

  const requestA = clientA.pair(true, token, streamA)
  const requestB = clientB.pair(false, token, streamB)

  await Promise.all([once(requestA, 'data'), once(requestB, 'data')])

  t.alike(server.stats.pairings, {
    requested: 2,
    matched: 1,
    cancelled: 0,
    pending: 0,
    active: 1
  })

  t.alike(server.stats.streams, {
    opened: 2,
    closed: 0,
    errors: 0,
    active: 2
  })

  await Promise.all([clientA.end(), clientB.end()])
  await waitFor(() => server.stats.streams.closed === 2)

  t.is(server.stats.pairings.active, 0)
  t.is(server.stats.streams.active, 0)
})

test('stats: cancelled pending pairings', async (t) => {
  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()
  const client = withClient(t, server)
  const request = client.pair(true, token, createStream())

  request.on('data', noop)
  request.on('error', noop)

  await waitFor(() => server.stats.pairings.requested === 1)

  t.alike(server.stats.pairings, {
    requested: 1,
    matched: 0,
    cancelled: 0,
    pending: 1,
    active: 0
  })

  client.unpair(token)

  await waitFor(() => server.stats.pairings.cancelled === 1)

  t.alike(server.stats.pairings, {
    requested: 1,
    matched: 0,
    cancelled: 1,
    pending: 0,
    active: 0
  })
})

test('stats: session close cancels pending pairings', async (t) => {
  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()
  const { client, session } = withClient(t, server, { withSession: true })
  const request = client.pair(true, token, createStream())

  request.on('data', noop)
  request.on('error', noop)

  await waitFor(() => server.stats.pairings.pending === 1)

  const closed = once(session, 'close')
  client.destroy()
  await closed

  t.alike(server.stats.pairings, {
    requested: 1,
    matched: 0,
    cancelled: 1,
    pending: 0,
    active: 0
  })
})

test('stats: cancelled active pairings', async (t) => {
  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  const clientA = withClient(t, server)
  const clientB = withClient(t, server)
  const streamA = createStream()
  const streamB = createStream()

  const requestA = clientA.pair(true, token, streamA)
  const requestB = clientB.pair(false, token, streamB)

  await Promise.all([once(requestA, 'data'), once(requestB, 'data')])

  t.alike(server.stats.pairings, {
    requested: 2,
    matched: 1,
    cancelled: 0,
    pending: 0,
    active: 1
  })

  t.alike(server.stats.streams, {
    opened: 2,
    closed: 0,
    errors: 0,
    active: 2
  })

  clientA.unpair(token)

  await waitFor(() => server.stats.pairings.cancelled === 1)
  await waitFor(() => server.stats.streams.closed === 2)

  t.is(server.stats.pairings.cancelled, 1)
  t.is(server.stats.pairings.active, 0)
  t.is(server.stats.streams.active, 0)
})

test('stats: active relay stream close updates gauges', async (t) => {
  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()

  const { client: clientA, session: sessionA } = withClient(t, server, {
    withSession: true
  })
  const clientB = withClient(t, server)
  const streamA = createStream()
  const streamB = createStream()

  const pairedOnServer = once(sessionA, 'pair')
  const requestA = clientA.pair(true, token, streamA)
  const requestB = clientB.pair(false, token, streamB)

  const [, , serverPair] = await Promise.all([
    once(requestA, 'data'),
    once(requestB, 'data'),
    pairedOnServer
  ])
  const [, , relayStream] = serverPair

  t.is(server.stats.pairings.active, 1)
  t.is(server.stats.streams.active, 2)

  relayStream.on('error', noop)
  relayStream.destroy()

  await waitFor(() => server.stats.streams.closed === 1)

  t.is(server.stats.streams.active, 1)
  t.is(server.stats.pairings.active, 1)
})

test('stats: stream errors', async (t) => {
  const udx = new UDX()

  let id = 0
  const createStream = (opts) => udx.createStream(++id, opts)

  const server = withServer(t, createStream)
  const token = relay.token()
  const sessionErrors = []

  const { client: clientA, session: sessionA } = withClient(t, server, {
    onerror: (err) => {
      sessionErrors.push(err)
    },
    withSession: true
  })
  const { client: clientB } = withClient(t, server, { withSession: true })
  const streamA = createStream()
  const streamB = createStream()

  const pairedOnServer = once(sessionA, 'pair')
  const requestA = clientA.pair(true, token, streamA)
  const requestB = clientB.pair(false, token, streamB)

  await Promise.all([once(requestA, 'data'), once(requestB, 'data')])

  const [, , relayStream] = await pairedOnServer
  const err = new Error('boom')

  relayStream.emit('error', err)

  await waitFor(() => server.stats.streams.errors === 1)

  t.is(server.stats.streams.errors, 1)
  t.is(sessionErrors.length, 1)
  t.is(sessionErrors[0], err)
})

async function waitFor(check, { timeout = 1000, interval = 10 } = {}) {
  const started = Date.now()

  while (Date.now() - started < timeout) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  throw new Error('Timed out waiting for condition')
}

function onceClose(stream) {
  // bare-events.once('close') rejects on a prior error, but here we only care that shutdown completes.
  return new Promise((resolve) => stream.once('close', resolve))
}

function destroyAll(streams) {
  for (const stream of streams) {
    if (!stream.destroyed) stream.on('error', noop).destroy()
  }
}

function noop() {}
