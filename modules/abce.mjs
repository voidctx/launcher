export default {
  async server(req) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: `Hello from /abcd!`
    };
  }
};
