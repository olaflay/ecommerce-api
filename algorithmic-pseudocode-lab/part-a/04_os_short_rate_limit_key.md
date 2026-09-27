# Part A2: Open-Source Function (Short) — `express-rate-limit` Key Generator

- **Source Library:** `express-rate-limit` (v7.x)
- **Function:** `defaultKeyGenerator(req: Request): string`
- **Methodology:** Read directly from source code without AI assistance on first pass, wrote strict pseudocode, then compared against AI explanation.

---

## 1. Pseudocode Specification

```text
FUNCTION defaultKeyGenerator
INPUTS:
  req: Express HTTP Request object containing socket, headers, and app configuration
OUTPUT:
  clientIdentifier: String representing unique client identifier (typically client IP address)
SIDE EFFECTS:
  NONE
FAILS WHEN:
  - req.ip is undefined and underlying socket remoteAddress is unavailable (returns undefined or empty string)

1. CHECK if req.ip is defined and non-empty
2. IF req.ip exists
     ASSIGN clientIdentifier = req.ip
   OTHERWISE
     // Fallback when trust proxy is not configured or in raw TCP socket environments
     CHECK if req.socket and req.socket.remoteAddress exist
     IF req.socket.remoteAddress exists
       ASSIGN clientIdentifier = req.socket.remoteAddress
     OTHERWISE
       ASSIGN clientIdentifier = ""
     END IF
   END IF
3. RETURN clientIdentifier
```

---

## 2. Comparison with AI Explanation

### Where My Understanding Differed from AI:
- **AI Initial Claim:** The AI claimed that `defaultKeyGenerator` automatically strips the port from IPv6 addresses and hashes the IP with SHA-256 for privacy.
- **Source Code Truth:** Reading `node_modules/express-rate-limit/dist/index.mjs` directly reveals the function does **no hashing at all**. It literally evaluates:
  ```js
  const defaultKeyGenerator = (request) => request.ip ?? request.socket?.remoteAddress ?? ''
  ```
  The AI hallucinated a privacy-hashing feature that exists only in custom user-supplied key generators or in alternative libraries like `@koa/ratelimit`. My manual reading of the code was accurate; the AI was wrong.
