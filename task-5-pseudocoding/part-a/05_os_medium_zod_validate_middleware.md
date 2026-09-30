# Part A2: Open-Source Function (Medium) — Zod Validation Middleware

- **Source Pattern:** Standard Zod validation pipeline (`zod` v3.x)
- **Function:** `validateRequest(schema: AnyZodObject)`
- **Methodology:** Read directly from source without AI on first pass, wrote strict pseudocode, then compared against AI explanation.

---

## 1. Pseudocode Specification

```text
FUNCTION validateRequest
INPUTS:
  schema: Zod schema object specifying required shapes for body, query, and params
OUTPUT:
  middlewareFunction: Express middleware function (req, res, next)
SIDE EFFECTS:
  - MUTATES req.body, req.query, or req.params by assigning parsed, stripped, and type-coerced data
FAILS WHEN:
  - Input payload violates any Zod validation rule (types, bounds, regex, required fields)

1. RETURN an inner middleware function taking req, res, next:
     a. CONSTRUCT targetObject from incoming request:
          SET body = req.body
          SET query = req.query
          SET params = req.params
     b. CALL schema.safeParseAsync passing targetObject
     c. IF parsing succeeds (result.success is true)
          // Strip unknown properties and assign coerced types
          IF schema specifies body rules
            OVERWRITE req.body with result.data.body
          END IF
          IF schema specifies query rules
            OVERWRITE req.query with result.data.query
          END IF
          IF schema specifies params rules
            OVERWRITE req.params with result.data.params
          END IF
          CALL next() to continue request lifecycle
          RETURN
        OTHERWISE
          // Parsing failed with one or more validation issues
          INITIALIZE formattedErrors array
          FOR EACH issue in result.error.issues
            EXTRACT fieldPath by joining issue.path with dot separator
            APPEND to formattedErrors:
              field = fieldPath
              code = issue.code
              message = issue.message
          END FOR
          CONSTRUCT errorResponse:
            error.code = "VALIDATION_ERROR"
            error.message = "The request payload failed schema validation"
            error.details = formattedErrors
          SEND HTTP 422 Unprocessable Entity response with errorResponse JSON
          RETURN
        END IF
```

---

## 2. Comparison with AI Explanation

### Where My Understanding Differed from AI:
- **AI Initial Claim:** The AI claimed that `safeParse` throws an exception that must be caught inside a `try/catch` block.
- **Source Code Truth:** `safeParse` / `safeParseAsync` in Zod was deliberately designed to **never throw exceptions**. It returns a discriminated union:
  `{ success: true, data: T } | { success: false, error: ZodError }`.
  Using `try/catch` around `safeParse` is redundant boilerplate because `result.success` is a type guard boolean. My manual reading captured the return union pattern accurately.
