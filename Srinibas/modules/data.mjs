export default {
  async server(req) {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    };
  }
};