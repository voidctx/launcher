// sample-services/hello-service.js
module.exports = {
  name: 'hello-service',
  handle: (req, res, meta) => {
    return {
      service: 'hello-service',
      message: 'Hello from microservice running on the single-port Launcher gateway!',
      timestamp: new Date().toISOString(),
      memoryResidentMb: meta.memoryMb,
      requestNum: meta.requestCount
    };
  }
};
