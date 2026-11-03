function handler(event) {
  var request = event.request;
  if (request.uri === '/docs' || request.uri === '/docs/' ||
      request.uri === '/docs/api' || request.uri === '/docs/api/') {
    request.uri = '/docs.html';
  } else if (request.uri === '/docs/health' || request.uri === '/docs/health/') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: '/docs#health' },
        'cache-control': { value: 'no-store, max-age=0' },
      },
    };
  } else if (request.uri === '/docs/health.md') {
    request.uri = '/health.md';
  }
  return request;
}
