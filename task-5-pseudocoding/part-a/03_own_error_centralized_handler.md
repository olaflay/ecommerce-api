# Part A1: Own Error Function — `errorHandler` Middleware

## 1. Pseudocode Specification

```text
FUNCTION errorHandler
INPUTS:
  err: Error object thrown anywhere in request execution
  req: HTTP Request object with path, method, headers
  res: HTTP Response object to emit status and payload
  next: Express next middleware function
OUTPUT:
  HTTP response sent to client with honest status code and JSON error envelope
SIDE EFFECTS:
  - WRITES error log to server console with correlation ID and stack trace
  - SENDS HTTP response over network
FAILS WHEN:
  - Response headers have already been sent to client (delegates to next(err))

1. IF response headers have already been sent to client
     CALL next passing err (delegate to underlying HTTP engine)
     RETURN
   END IF
2. EXTRACT correlationId from request header "x-correlation-id"
   IF correlationId is missing
     GENERATE a new random UUID and assign to correlationId
   END IF
3. ATTACH "X-Correlation-Id" header with correlationId value to outgoing response
4. IF err is an instance of AppError (known domain error)
     SET statusCode to err.statusCode
     SET errorCode to err.errorCode
     SET errorMessage to err.message
     SET errorDetails to err.details (if present)
   OTHERWISE IF err is a ZodError (request validation failure)
     SET statusCode to 422 Unprocessable Entity
     SET errorCode to "VALIDATION_ERROR"
     FORMAT validation issues into field-level errorDetails array
     SET errorMessage to "Validation failed for request parameters"
   OTHERWISE IF err is a Prisma known request error (e.g. unique constraint code P2002)
     SET statusCode to 409 Conflict
     SET errorCode to "CONFLICT"
     SET errorMessage to "A resource with these attributes already exists"
   OTHERWISE
     // Unhandled unexpected runtime exception or database crash
     SET statusCode to 500 Internal Server Error
     SET errorCode to "INTERNAL_SERVER_ERROR"
     SET errorMessage to "An unexpected internal server error occurred"
     // CRITICAL SECURITY RULE: Never leak internal error message or stack trace to client
     SET errorDetails to null
   END IF
5. WRITE structured error log to server console:
     LOG timestamp, correlationId, request method, request path, statusCode, errorCode, err.message, err.stack
6. CONSTRUCT client response envelope:
     BUILD JSON object with top-level "error" key containing code, message, correlationId, and details
7. SEND HTTP response with statusCode and error JSON payload
```

---

## 2. Hand-Trace Verification (3 Test Inputs)

### Input 1 (Normal Case: Known Domain 404 Error):
- `err`: `new NotFoundError("Product with ID 'xyz' not found")`
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 1–3 | Headers not sent. Correlation ID generated. Header set. | Proceed |
  | 4 | Identified as `AppError`. `statusCode = 404`, `errorCode = "NOT_FOUND"`. | Status: 404 |
  | 5 | Logged to console with stack trace and correlation ID. | Logged |
  | 6–7 | Response sent: `{ error: { code: "NOT_FOUND", message: "Product with ID 'xyz' not found", correlationId } }`. | **HTTP 404 Not Found** |
- **Real Code Execution Result:** `tests/app.test.ts`: Returned 404 with honest JSON envelope and correlation ID. **Match: YES**.

### Input 2 (Edge Case: Sensitive Internal Exception / Secret Leak):
- `err`: `new Error("SensitiveDatabaseConnectionCredentialsLeakHere")`
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 4 | Not AppError, not Zod. Enters fallback `else`. | Caught by security guard |
  | 4 | `statusCode = 500`, `errorCode = "INTERNAL_SERVER_ERROR"`, message sanitized to generic string. | Sanitized |
  | 5 | Full raw message and stack logged internally to console only. | Audit trace preserved |
  | 6–7 | Client receives generic message. Zero stack trace in response. | **HTTP 500 Internal Server Error** |
- **Real Code Execution Result:** `tests/app.test.ts` line 49: Client received `{ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }`. Response body was strictly sanitized. **Match: YES**.

### Input 3 (Validation Case: Zod Missing Required Field):
- `err`: ZodError for missing `customerId`
- **Hand Trace Table:**
  | Step | Variable State | Output / Result |
  |---|---|---|
  | 4 | Matches `ZodError`. `statusCode = 422`, `errorCode = "VALIDATION_ERROR"`. | Status: 422 |
  | 6–7 | Formatted details: `[{ field: "customerId", message: "Required" }]`. | **HTTP 422 Unprocessable Entity** |
- **Real Code Execution Result:** `tests/orders.test.ts` line 68: Returned 422 with field-level error breakdown. **Match: YES**.
