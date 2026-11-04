function handler(event) {
  var request = event.request;
  if (request.uri === '/docs' || request.uri === '/docs/') {
    request.uri = '/docs.html';
  } else if (request.uri === '/docs/health' || request.uri === '/docs/health/' ||
      request.uri === '/docs/api' || request.uri === '/docs/api/') {
    var section = request.uri === '/docs/api' || request.uri === '/docs/api/' ? 'api' : 'health';
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: '/docs#' + section },
        'cache-control': { value: 'no-store, max-age=0' },
      },
    };
  } else if (request.uri === '/docs/health.md') {
    request.uri = '/health.md';
  } else if (request.uri === '/docs/api.md') {
    request.uri = '/api.md';
  }
  return request;
}
