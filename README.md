# Launcher

Launcher is a module-based backend runtime built with native Node.js ESM. The idea is to run multiple independent backend handlers behind a single HTTP server, with Launcher taking care of routing requests to the right module and returning the result.

## Core idea

Most backend applications have a lot of infrastructure surrounding the actual business logic: routing, request handling, deployment, monitoring, and server management.

Launcher starts by keeping that infrastructure in one place and treating the application logic as modules.

A module implements a particular piece of functionality. Launcher receives a request, determines which module should handle it, invokes that module, and sends its result back to the client.

```text
                    HTTP Request
                         |
                         v
                  +-------------+
                  |   Launcher  |
                  | HTTP Server |
                  +-------------+
                         |
                         v
                  +-------------+
                  |   Resolver  |
                  +-------------+
                         |
                  Resolve module
                         |
                         v
                  +-------------+
                  |   Module    |
                  |   Handler   |
                  +-------------+
                         |
                         v
                  HTTP Response
```

The important distinction is that Launcher owns the execution infrastructure, while modules contain the application-specific logic. This separation is what makes the runtime useful as the foundation for a hosted service.

## Repository structure

### `launcher.mjs`

The main entry point of the application. It starts the HTTP server and coordinates incoming requests with the rest of the runtime.

### `resolve.mjs`

Responsible for resolving incoming requests to the appropriate module.

Keeping resolution separate from the HTTP server makes it easier to evolve routing and module lookup without mixing all of that logic into the server entry point.

### `pages.mjs`

Contains page-related logic used by the current implementation. This is separate from the core request-resolution responsibilities.

### `modules/`

Contains the module implementations used by the runtime.

Modules follow a defined structure rather than being arbitrary standalone servers. The runtime can therefore dispatch requests to them through a common interface.

The exact module contract is important: changes to how modules export handlers or return responses can affect every module that depends on it.

## How request handling works

At a high level, request processing follows this sequence:

1. The HTTP server receives a request.
2. The request URL is passed through the resolution logic.
3. The resolver determines which module corresponds to the requested route.
4. The relevant module handler processes the request.
5. The module returns a result.
6. Launcher translates that result into an HTTP response.

The module is responsible for its application logic. Launcher is responsible for making the module accessible through the server.

### Why this approach?

A conventional approach would be to create a separate server for every small backend service. That introduces duplicated server setup, configuration, deployment, and maintenance.

Launcher aims to avoid that duplication by providing a shared runtime and a consistent module interface.

It also creates a natural path toward hosting modules for multiple users without requiring each user to deploy and maintain an entire server application.

## The module execution model

Each module implements functionality that can be invoked through a request.

A simplified example of the intended handler style is:

```js
export default {
  async server(request) {
    return {
      status: 200,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: "Hello from Module"
      })
    };
  }
};
```

A common module interface makes it possible for Launcher to dispatch different functions without requiring each one to implement its own HTTP server.

It also gives us a place to define consistent behavior for errors, request bodies, response headers, streaming, and execution limits.

Any changes to this interface should be treated as runtime-level changes rather than isolated module changes.

## Design principles

**Keep the core small.** Prefer native Node.js functionality where it is sufficient. Additional dependencies should solve a concrete problem rather than introduce another layer of abstraction.

**Keep module logic independent.** The runtime should not need to understand the internal behavior of every module. It should only need a defined interface through which to invoke it.

**Keep routing explicit.** A request should resolve to a known module or deployment. Module selection should not depend on unrestricted filesystem access.

**Keep platform services outside application logic.** Authentication for management operations, quotas, billing, and analytics belong to the platform, not to individual handlers.

**Treat uploaded code as untrusted.** Hosting other people's modules introduces security requirements that do not exist when running only trusted local code.

**Preserve compatibility.** The module interface is a central contract. Changes to it should be deliberate and tested against existing modules.

---

Launcher is being built around a simple premise: **write the backend logic as modules; let the runtime handle execution; and build the hosting platform around that contract.**

The goal is to preserve a lightweight core while making it possible to deploy, expose, and manage backend functionality through a single platform.
