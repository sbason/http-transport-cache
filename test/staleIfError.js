'use strict';

const assert = require('assert');
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const bluebird = require('bluebird');
const nock = require('nock');

const httpTransport = require('@bbc/http-transport');
const toError = require('@bbc/http-transport-to-error');

const cache = require('../');
const events = require('../lib/cache').events;

const VERSION = require('../package').version;
const api = nock('http://www.example.com');

const defaultHeaders = {
  'cache-control': 'max-age=60,stale-if-error=7200'
};

const defaultResponse = {
  body: 'I am a string!',
  url: 'http://www.example.com/',
  statusCode: 200,
  elapsedTime: 40,
  headers: defaultHeaders
};

const bodySegment = {
  segment: `http-transport:${VERSION}:stale`,
  id: 'http://www.example.com/'
};

nock.disableNetConnect();

function createCache() {
  const cache = new Catbox.Client(new Memory());
  bluebird.promisifyAll(cache);

  return cache;
}

function requestWithCache(catbox) {
  return httpTransport
    .createClient()
    .use(cache.staleIfError(catbox))
    .use(toError())
    .get('http://www.example.com/')
    .asResponse();
}

describe('Stale-If-Error', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('sets the cache up ready for use', () => {
    const catbox = createCache();

    cache.staleIfError(catbox);

    assert(catbox.isReady());
  });

  it('stores cached values for the stale-if-error value', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const expiry = Date.now() + 7200000;

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then(cached => {
        const actualExpiry = cached.ttl + cached.stored;
        const differenceInExpires = actualExpiry - expiry;

        assert.deepEqual(cached.item.body, defaultResponse.body);
        assert(differenceInExpires < 1000);
      });
  });

  it('does not store if no cache-control', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse);

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then(cached => assert(!cached));
  });

  it('does not store if stale-if-error=0', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, {
      headers: {
        'cache-control': 'stale-if-error=0'
      }
    });

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then(cached => assert(!cached));
  });

  it('stores even if no max-age', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, {
      headers: {
        'cache-control': 'stale-if-error=7200'
      }
    });

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then(cached => assert(!cached));
  });

  it('returns cached response if available when error response is returned', () => {
    const cachedResponse = {
      body: 'http-transport',
      headers: defaultHeaders,
      elapsedTime: 40,
      url: 'http://www.example.com/',
      statusCode: 200
    };
    const cache = createCache();

    api.get('/').reply(500, defaultResponse.body, {});

    return cache
      .startAsync()
      .then(() => cache.setAsync(bodySegment, cachedResponse, 7200))
      .then(() => requestWithCache(cache))
      .then(res => {
        assert.equal(res.body, cachedResponse.body);
        assert.deepEqual(res.headers, cachedResponse.headers);
        assert.equal(res.elapsedTime, cachedResponse.elapsedTime);
        assert.equal(res.url, cachedResponse.url);
        assert.equal(res.statusCode, cachedResponse.statusCode);

        return cache.drop(bodySegment);
      });
  });

  it('returns the original error if nothing in cache', () => {
    const cache = createCache();
    api.get('/').reply(500, defaultResponse, {});

    return requestWithCache(cache)
      .then(() => assert(false, 'Promise should have failed'))
      .catch(err => {
        assert.equal(err.message, 'Received HTTP code 500 for GET http://www.example.com/');
      });
  });

  it('emits a stale cache event when returning stale', () => {
    let cacheStale = false;
    events.on('cache.stale', () => {
      cacheStale = true;
    });

    const cachedResponse = {
      body: 'http-transport',
      headers: defaultHeaders,
      elapsedTime: 40,
      url: 'http://www.example.com/',
      statusCode: 200
    };
    const cache = createCache();

    api.get('/').reply(500, defaultResponse.body, {});

    return cache
      .startAsync()
      .then(() => cache.setAsync(bodySegment, cachedResponse, 7200))
      .then(() => requestWithCache(cache))
      .then(() => {
        assert.ok(cacheStale);
      });
  });
});
