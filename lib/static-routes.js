function handler(event) {
  var request = event.request;
  if (request.uri === '/docs' || request.uri === '/docs/' ||
      request.uri === '/docs/api' || request.uri === '/docs/api/') {
    request.uri = '/docs.html';
  }
  return request;
}
